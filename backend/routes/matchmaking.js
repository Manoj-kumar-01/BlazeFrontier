const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// ═══════════════════════════════════════════════════════════════════
//  MATCHMAKING ENGINE v2.1 — Race-condition hardened queue system
//  
//  Concurrency protections:
//  ├─ Atomic accept lock (processingLocks Set) prevents 2 users
//  │  from accepting the same request simultaneously
//  ├─ Timer-vs-accept guard: timer checks lock before applying cooldown
//  ├─ Per-user request lock: prevents double-request spam
//  ├─ Match room TTL: auto-cleanup after 30 min
//  └─ Stale queue cleanup: periodic sweep every 60s
//
//  Production note: For multi-server, replace with Redis + Redlock.
// ═══════════════════════════════════════════════════════════════════

// ─── CORE DATA STRUCTURES ───────────────────────────────────────

const requestQueue = new Map();       // requestId => request entry
const activeMatches = new Map();      // matchId => match room
const userActiveRequest = new Map();  // userId => requestId

// ─── CONCURRENCY LOCKS ─────────────────────────────────────────

const processingLocks = new Set();    // Set of requestIds currently being processed (accept in-flight)
const userRequestLocks = new Set();   // Set of userIds currently creating a request

let requestCounter = 0;

// ─── MATCH ROOM TTL (30 min auto-cleanup) ───────────────────────

const MATCH_ROOM_TTL = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
    const now = Date.now();
    for (const [matchId, match] of activeMatches) {
        if (now - match.createdAt > MATCH_ROOM_TTL) {
            activeMatches.delete(matchId);
        }
    }
}, 60 * 1000).unref(); // Check every 60 seconds

// ─── STALE QUEUE CLEANUP (expired requests that timer missed) ───

setInterval(() => {
    const now = Date.now();
    for (const [requestId, entry] of requestQueue) {
        // If request expired more than 5 seconds ago and timer didn't clean it
        if (new Date(entry.expiresAt).getTime() + 5000 < now) {
            removeRequest(requestId);
        }
    }
}, 15 * 1000).unref(); // Check every 15 seconds

// ─── HELPER FUNCTIONS ───────────────────────────────────────────

function generateRequestId() {
    requestCounter++;
    return `req_${Date.now()}_${requestCounter}`;
}

function emit(req, event, data, targetUserId = null) {
    const io = req.app.get('io');
    if (!io) return;
    if (targetUserId) {
        io.to(targetUserId).emit(event, data);
    } else {
        io.emit(event, data);
    }
}

function broadcastQueueUpdate(req) {
    const queueSnapshot = getQueueSnapshot();
    emit(req, 'mm:queue_updated', { queue: queueSnapshot, serverTime: new Date().toISOString() });
}

function getQueueSnapshot() {
    const now = new Date();
    const entries = [];
    for (const [id, entry] of requestQueue) {
        // Only include non-expired, non-locked requests
        if (new Date(entry.expiresAt) > now && !processingLocks.has(id)) {
            entries.push({
                id: entry.id,
                requesterId: entry.requesterId,
                requesterBlz: entry.requesterBlz,
                requesterName: entry.requesterName,
                expiresAt: entry.expiresAt,
                createdAt: entry.createdAt
            });
        }
    }
    return entries;
}

function resetDailyIfNeeded(user) {
    const today = new Date().toDateString();
    const lastReset = user.matchmakingLastReset ? new Date(user.matchmakingLastReset).toDateString() : null;
    if (lastReset !== today) {
        user.matchmakingDailyCount = 0;
        user.matchmakingLastReset = new Date();
    }
}

/**
 * Remove a request from the queue and clean up all references.
 * Returns the removed entry (or null if not found).
 */
function removeRequest(requestId) {
    const entry = requestQueue.get(requestId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    requestQueue.delete(requestId);
    processingLocks.delete(requestId);
    if (userActiveRequest.get(entry.requesterId) === requestId) {
        userActiveRequest.delete(entry.requesterId);
    }
    return entry;
}

/**
 * Atomically try to acquire a lock on a request for accept processing.
 * Returns true if lock acquired, false if already locked (another accept in progress).
 */
function tryLockRequest(requestId) {
    if (processingLocks.has(requestId)) return false;
    processingLocks.add(requestId);
    return true;
}

function unlockRequest(requestId) {
    processingLocks.delete(requestId);
}

/**
 * Check if a user is currently in an active match room.
 */
function isUserInActiveMatch(userId) {
    for (const [, match] of activeMatches) {
        if (match.player1Id === userId || match.player2Id === userId) {
            return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────
//  GET /api/matchmaking/status
//  Returns user-specific state + full queue snapshot for sync.
// ─────────────────────────────────────────────────────────────
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).select('matchmakingBlockedUntil matchmakingDailyCount matchmakingLastReset blazeCoins');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        resetDailyIfNeeded(user);
        await user.save();

        const myRequestId = userActiveRequest.get(userId) || null;
        const myRequest = myRequestId ? requestQueue.get(myRequestId) : null;

        // Validate my request is still alive
        const myRequestValid = myRequest && new Date(myRequest.expiresAt) > new Date();

        // Check if user is in an active match
        let activeMatch = null;
        for (const [matchId, match] of activeMatches) {
            if (match.player1Id === userId || match.player2Id === userId) {
                const opponentId = match.player1Id === userId ? match.player2Id : match.player1Id;
                const oppUser = await User.findById(opponentId);
                activeMatch = {
                    matchId: matchId,
                    opponent: oppUser ? oppUser.playerId : 'Unknown',
                    opponentName: oppUser ? (oppUser.inGameName || oppUser.username) : 'Unknown'
                };
                break;
            }
        }

        const status = {
            blockedUntil: user.matchmakingBlockedUntil || null,
            dailyCount: user.matchmakingDailyCount || 0,
            blazeCoins: user.blazeCoins || 0,
            myRequest: myRequestValid ? {
                id: myRequest.id,
                expiresAt: myRequest.expiresAt,
                createdAt: myRequest.createdAt
            } : null,
            activeMatch: activeMatch,
            queue: getQueueSnapshot(),
            serverTime: new Date()
        };

        res.json(status);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/request
//  Add a new squad search to the request queue.
//  Protected: per-user lock prevents double-request on rapid clicks.
// ─────────────────────────────────────────────────────────────
router.post('/request', authMiddleware, async (req, res) => {
    const userId = req.user.id;

    // ── Per-user request lock (prevents double-click spam) ──
    if (userRequestLocks.has(userId)) {
        return res.status(429).json({ msg: 'Request already in progress. Please wait.' });
    }
    userRequestLocks.add(userId);

    try {
        // 1. Check if user is already in an active match
        if (isUserInActiveMatch(userId)) {
            return res.status(409).json({ msg: 'You are already in an active match. Leave the current match first.' });
        }

        // 2. Check if user already has an active request
        const existingRequestId = userActiveRequest.get(userId);
        if (existingRequestId && requestQueue.has(existingRequestId)) {
            const existing = requestQueue.get(existingRequestId);
            if (new Date(existing.expiresAt) > new Date()) {
                return res.status(409).json({ msg: 'You already have an active request in the queue.' });
            }
            // Expired but not cleaned up yet — clean it now
            removeRequest(existingRequestId);
        }

        // 2. Load and validate user
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // 3. Check cooldown block
        if (user.matchmakingBlockedUntil && new Date() < user.matchmakingBlockedUntil) {
            const remainingMs = new Date(user.matchmakingBlockedUntil) - new Date();
            const remainingMins = Math.ceil(remainingMs / 60000);
            return res.status(403).json({
                msg: `Cooldown active. You can search again in ${remainingMins} minute(s).`,
                blockedUntil: user.matchmakingBlockedUntil
            });
        }

        // 4. Check daily limit
        resetDailyIfNeeded(user);
        if (user.matchmakingDailyCount >= 5) {
            return res.status(403).json({ msg: 'Daily limit reached. You have used all 5 searches for today.' });
        }

        // 5. Check BlazeCoins
        if (user.blazeCoins < 20) {
            return res.status(400).json({ msg: 'You need at least 20 BlazeCoins to search for a squad.' });
        }

        // 6. All checks passed — create the request entry
        const requestId = generateRequestId();
        const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

        const timer = setTimeout(async () => {
            // ── Timer-vs-accept guard ──
            // If this request is currently being accepted, don't interfere
            if (processingLocks.has(requestId)) return;

            // Check if request still exists (might have been cancelled or accepted already)
            if (!requestQueue.has(requestId)) return;

            removeRequest(requestId);

            // Apply 10-minute cooldown
            try {
                const u = await User.findById(userId);
                if (u) {
                    u.matchmakingBlockedUntil = new Date(Date.now() + 10 * 60 * 1000);
                    await u.save();
                }
            } catch (e) {
                console.error('Error setting cooldown on timeout:', e);
            }

            // Notify requester only
            emit(req, 'mm:search_expired', {
                requestId,
                msg: 'No one accepted your request. 10-minute cooldown applied.',
                blockedUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString()
            }, userId);

            // Broadcast updated queue to everyone
            broadcastQueueUpdate(req);
        }, 60000);

        const entry = {
            id: requestId,
            requesterId: userId,
            requesterBlz: user.playerId,
            requesterName: user.inGameName || user.username,
            expiresAt,
            createdAt: new Date().toISOString(),
            timer
        };

        requestQueue.set(requestId, entry);
        userActiveRequest.set(userId, requestId);

        // Increment daily count
        user.matchmakingDailyCount = (user.matchmakingDailyCount || 0) + 1;
        await user.save();

        // Notify the requester
        emit(req, 'mm:my_request_created', {
            requestId,
            expiresAt,
            serverTime: new Date().toISOString()
        }, userId);

        // Broadcast updated queue to everyone
        broadcastQueueUpdate(req);

        // Send Web Push Notification to all subscribed users (except the requester)
        try {
            console.log(`[Push Debug] Finding subscriptions EXCEPT for userId: ${userId}`);
            const subscriptions = await PushSubscription.find({ userId: { $ne: userId } });
            console.log(`[Push Debug] Found ${subscriptions.length} subscriptions to send to.`);
            const payload = JSON.stringify({
                title: 'BlazeFrontier',
                body: `You have been invited for a Squad Match by ${user.inGameName || user.username}!`
            });
            subscriptions.forEach(sub => {
                console.log(`[Push Debug] Sending to endpoint: ${sub.endpoint.substring(0, 30)}...`);
                webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload).then(result => {
                    console.log(`[Push Debug] Success! Status: ${result.statusCode}`);
                }).catch(err => {
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        console.log(`[Push Debug] Endpoint expired, deleting: ${sub.endpoint.substring(0, 30)}...`);
                        PushSubscription.deleteOne({ endpoint: sub.endpoint }).exec();
                    } else {
                        console.error('[WebPush Error] Failed to send to endpoint:', sub.endpoint, err);
                    }
                });
            });
        } catch (pushErr) {
            console.error('Push broadcast error:', pushErr);
        }

        res.json({ msg: 'Search started.', requestId, expiresAt, serverTime: new Date() });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    } finally {
        // ── Always release the per-user lock ──
        userRequestLocks.delete(userId);
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/cancel
//  Cancel own active request from the queue.
// ─────────────────────────────────────────────────────────────
router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const requestId = userActiveRequest.get(userId);

        if (!requestId || !requestQueue.has(requestId)) {
            // Clean up stale mapping
            userActiveRequest.delete(userId);
            return res.status(400).json({ msg: 'No active request to cancel.' });
        }

        // Can't cancel if it's currently being accepted by someone
        if (processingLocks.has(requestId)) {
            return res.status(409).json({ msg: 'Your request is currently being processed. Cannot cancel.' });
        }

        removeRequest(requestId);

        emit(req, 'mm:my_request_cancelled', { requestId }, userId);
        broadcastQueueUpdate(req);

        res.json({ msg: 'Request cancelled.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/accept/:requestId
//  Accept a specific request from the queue.
//
//  RACE CONDITION PROTECTION:
//  1. Atomic lock via processingLocks Set
//  2. Double-check request exists AFTER acquiring lock
//  3. Lock released in finally{} block (even on errors)
//  4. Timer guard: timer won't interfere while lock is held
// ─────────────────────────────────────────────────────────────
router.post('/accept/:requestId', authMiddleware, async (req, res) => {
    const acceptorId = req.user.id;
    const requestId = req.params.requestId;

    // ── Step 1: Atomic lock acquisition ──
    if (!tryLockRequest(requestId)) {
        return res.status(409).json({ msg: 'Someone else is already accepting this request.' });
    }

    try {
        // ── Step 2: Double-check request still exists (after lock) ──
        const entry = requestQueue.get(requestId);
        if (!entry) {
            return res.status(400).json({ msg: 'This request is no longer available.' });
        }

        // ── Step 3: Check if request has expired ──
        if (new Date(entry.expiresAt) <= new Date()) {
            removeRequest(requestId);
            broadcastQueueUpdate(req);
            return res.status(400).json({ msg: 'This request has expired.' });
        }

        // ── Step 4: Can't accept own request ──
        if (entry.requesterId === acceptorId) {
            return res.status(400).json({ msg: 'You cannot accept your own request.' });
        }

        const requesterId = entry.requesterId;

        // ── Step 5: Validate acceptor ──
        const acceptor = await User.findById(acceptorId);
        if (!acceptor) return res.status(404).json({ msg: 'User not found.' });

        // Check if acceptor is already in a match
        if (isUserInActiveMatch(acceptorId)) {
            return res.status(409).json({ msg: 'You are already in an active match.' });
        }

        if (acceptor.matchmakingBlockedUntil && new Date() < acceptor.matchmakingBlockedUntil) {
            const remainingMins = Math.ceil((new Date(acceptor.matchmakingBlockedUntil) - new Date()) / 60000);
            return res.status(403).json({ msg: `You have a cooldown active. Wait ${remainingMins} minute(s).` });
        }

        resetDailyIfNeeded(acceptor);
        if (acceptor.matchmakingDailyCount >= 5) {
            return res.status(403).json({ msg: 'Daily limit reached. You have used all 5 searches for today.' });
        }

        // ── Step 6: Validate requester (they might have been banned/modified since) ──
        const requester = await User.findById(requesterId);
        if (!requester) {
            removeRequest(requestId);
            broadcastQueueUpdate(req);
            return res.status(400).json({ msg: 'Requester account no longer exists.' });
        }

        if (requester.blazeCoins < 20) {
            removeRequest(requestId);
            broadcastQueueUpdate(req);
            return res.status(400).json({ msg: 'Match failed — requester does not have enough BlazeCoins.' });
        }

        // ══════════════════════════════════════════════════════════
        //  ALL CHECKS PASSED — Execute the match atomically
        // ══════════════════════════════════════════════════════════

        // Remove from queue (also clears the expiry timer)
        removeRequest(requestId);

        // Also remove acceptor's own request if they had one pending
        const acceptorRequestId = userActiveRequest.get(acceptorId);
        if (acceptorRequestId && requestQueue.has(acceptorRequestId)) {
            removeRequest(acceptorRequestId);
            emit(req, 'mm:my_request_cancelled', {
                requestId: acceptorRequestId,
                reason: 'You accepted another request.'
            }, acceptorId);
        }

        // Deduct coins + apply 30-minute cooldown to both
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);

        requester.blazeCoins -= 20;
        requester.matchmakingBlockedUntil = cooldownUntil;
        if (!requester.directives) requester.directives = {};
        if (!requester.directives.squadDeployment) requester.directives.squadDeployment = { completed: false, claimed: false };
        requester.directives.squadDeployment.completed = true;
        await requester.save();

        acceptor.matchmakingBlockedUntil = cooldownUntil;
        acceptor.matchmakingDailyCount = (acceptor.matchmakingDailyCount || 0) + 1;
        if (!acceptor.directives) acceptor.directives = {};
        if (!acceptor.directives.squadDeployment) acceptor.directives.squadDeployment = { completed: false, claimed: false };
        acceptor.directives.squadDeployment.completed = true;
        await acceptor.save();

        // Create match room with creation timestamp for TTL
        const matchId = 'room_' + Date.now();
        activeMatches.set(matchId, {
            player1Id: requesterId,
            player2Id: acceptorId,
            msgCount: { [requesterId]: 0, [acceptorId]: 0 },
            createdAt: Date.now()
        });

        // Notify both players — targeted, session-scoped
        emit(req, 'mm:match_formed', {
            matchId,
            opponent: acceptor.playerId,
            opponentName: acceptor.inGameName || acceptor.username,
            cooldownUntil: cooldownUntil.toISOString()
        }, requesterId);

        emit(req, 'mm:match_formed', {
            matchId,
            opponent: requester.playerId,
            opponentName: requester.inGameName || requester.username,
            cooldownUntil: cooldownUntil.toISOString()
        }, acceptorId);

        // Broadcast updated queue to everyone else
        broadcastQueueUpdate(req);

        res.json({ msg: 'Match accepted!' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    } finally {
        // ── ALWAYS release the lock, even on error ──
        unlockRequest(requestId);
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/chat/:matchId
//  Send a predefined message or room credentials.
//  Predefined messages are limited to 3 per player per match.
// ─────────────────────────────────────────────────────────────
router.post('/chat/:matchId', authMiddleware, (req, res) => {
    try {
        const userId = req.user.id;
        const matchId = req.params.matchId;
        const { type, message, roomId, password } = req.body;

        const match = activeMatches.get(matchId);
        if (!match) return res.status(404).json({ msg: 'Match room not found or expired.' });

        if (match.player1Id !== userId && match.player2Id !== userId) {
            return res.status(403).json({ msg: 'Not authorized for this room.' });
        }

        const targetId = match.player1Id === userId ? match.player2Id : match.player1Id;

        if (type === 'predefined') {
            const allowed = ['Who will create the room?', 'I will create the room', 'You create the room', 'Credentials Sent', 'Joined!'];
            if (!allowed.includes(message)) return res.status(400).json({ msg: 'Invalid message.' });

            const count = (match.msgCount[userId]) || 0;
            if (count >= 8) {
                return res.status(429).json({ msg: 'Message limit reached. Max 8 quick messages per match.' });
            }
            match.msgCount[userId] = count + 1;
            const remaining = 8 - match.msgCount[userId];

            emit(req, 'mm:chat_message', { sender: userId, type: 'text', message }, targetId);
            emit(req, 'mm:chat_message', { sender: userId, type: 'text', message, remaining }, userId);

        } else if (type === 'credentials') {
            const numRegex = /^\d{1,10}$/;
            if (!numRegex.test(roomId) || !numRegex.test(password)) {
                return res.status(400).json({ msg: 'Room ID and Password must be numbers (max 10 digits).' });
            }

            const credMsg = `Room ID: ${roomId} | Pass: ${password}`;
            emit(req, 'mm:chat_message', { sender: userId, type: 'credentials', message: credMsg }, targetId);
            emit(req, 'mm:chat_message', { sender: userId, type: 'credentials', message: credMsg }, userId);
        }

        res.json({ msg: 'Message sent' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/leave/:matchId
//  Leave/close the match room.
// ─────────────────────────────────────────────────────────────
router.post('/leave/:matchId', authMiddleware, (req, res) => {
    const matchId = req.params.matchId;
    if (activeMatches.has(matchId)) {
        const match = activeMatches.get(matchId);
        const targetId = match.player1Id === req.user.id ? match.player2Id : match.player1Id;
        emit(req, 'mm:chat_ended', { msg: 'Opponent has left the room.' }, targetId);
        activeMatches.delete(matchId);
    }
    res.json({ msg: 'Left room' });
});

module.exports = router;

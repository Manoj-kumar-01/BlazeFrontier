const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');

// ═══════════════════════════════════════════════════════════════════
//  MATCHMAKING ENGINE — Single-server in-memory state
//  Production note: For multi-server, replace with Redis pub/sub.
// ═══════════════════════════════════════════════════════════════════

// Only ONE active search allowed globally at a time.
// { requesterId, requesterBlz, expiresAt, timer }
let activeSearch = null;

// Active match rooms. matchId => { player1Id, player2Id, msgCount }
const activeMatches = new Map();

/**
 * Emit a Socket.IO event. If targetUserId is provided, emit only to that user's room.
 * Otherwise broadcast to all connected clients.
 */
function emit(req, event, data, targetUserId = null) {
    const io = req.app.get('io');
    if (!io) return;
    if (targetUserId) {
        io.to(targetUserId).emit(event, data);
    } else {
        io.emit(event, data);
    }
}

/**
 * Check if today is a new day compared to the user's last reset.
 * If so, reset their daily matchmaking count.
 */
function resetDailyIfNeeded(user) {
    const today = new Date().toDateString();
    const lastReset = user.matchmakingLastReset ? new Date(user.matchmakingLastReset).toDateString() : null;
    if (lastReset !== today) {
        user.matchmakingDailyCount = 0;
        user.matchmakingLastReset = new Date();
    }
}

/**
 * Clean up any active search: clear the timer, broadcast clear, reset state.
 */
function clearActiveSearch(req) {
    if (!activeSearch) return;
    clearTimeout(activeSearch.timer);
    emit(req, 'mm:search_cleared', {});
    activeSearch = null;
}

// ─────────────────────────────────────────────────────────────
//  GET /api/matchmaking/status
//  Returns the current global matchmaking state so newly loaded
//  pages can sync instantly (no stale UI).
// ─────────────────────────────────────────────────────────────
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).select('matchmakingBlockedUntil matchmakingDailyCount matchmakingLastReset blazeCoins');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        resetDailyIfNeeded(user);
        await user.save();

        // Build response
        const status = {
            // User's own state
            blockedUntil: user.matchmakingBlockedUntil || null,
            dailyCount: user.matchmakingDailyCount || 0,
            blazeCoins: user.blazeCoins || 0,

            // Global search state
            isSearchActive: !!activeSearch,
            search: activeSearch ? {
                requesterId: activeSearch.requesterId,
                requesterBlz: activeSearch.requesterBlz,
                expiresAt: activeSearch.expiresAt,
                isMySearch: activeSearch.requesterId === userId
            } : null
        };

        res.json(status);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/request
//  Start a new squad search. Only one search at a time globally.
// ─────────────────────────────────────────────────────────────
router.post('/request', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Only one global search at a time
        if (activeSearch) {
            return res.status(409).json({ msg: 'Another player is currently searching. Please wait.' });
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

        // 4. Check daily limit (auto-reset if new day)
        resetDailyIfNeeded(user);
        if (user.matchmakingDailyCount >= 3) {
            return res.status(403).json({ msg: 'Daily limit reached. You have used all 3 searches for today.' });
        }

        // 5. Check BlazeCoins
        if (user.blazeCoins < 20) {
            return res.status(400).json({ msg: 'You need at least 20 BlazeCoins to search for a squad.' });
        }

        // 6. All checks passed — create the search
        const expiresAt = new Date(Date.now() + 30 * 1000).toISOString(); // 30 seconds

        const timer = setTimeout(async () => {
            // Search expired — nobody accepted
            if (activeSearch && activeSearch.requesterId === userId) {
                activeSearch = null;

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

                // Notify requester
                emit(req, 'mm:search_expired', {
                    msg: 'No one accepted your request. 10-minute cooldown applied.',
                    blockedUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString()
                }, userId);

                // Notify everyone else
                emit(req, 'mm:search_cleared', {});
            }
        }, 30000);

        activeSearch = {
            requesterId: userId,
            requesterBlz: user.playerId,
            expiresAt,
            timer
        };

        // Increment daily count
        user.matchmakingDailyCount = (user.matchmakingDailyCount || 0) + 1;
        await user.save();

        // Broadcast to ALL connected clients
        emit(req, 'mm:search_started', {
            requesterId: userId,
            requesterBlz: user.playerId,
            expiresAt
        });

        res.json({ msg: 'Search started.', expiresAt });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/matchmaking/accept
//  Accept the current active search.
// ─────────────────────────────────────────────────────────────
router.post('/accept', authMiddleware, async (req, res) => {
    try {
        const acceptorId = req.user.id;

        // 1. Is there an active search?
        if (!activeSearch) {
            return res.status(400).json({ msg: 'No active search to accept.' });
        }

        // 2. Can't accept own search
        if (activeSearch.requesterId === acceptorId) {
            return res.status(400).json({ msg: 'You cannot accept your own request.' });
        }

        const requesterId = activeSearch.requesterId;

        // 3. Validate acceptor
        const acceptor = await User.findById(acceptorId);
        if (!acceptor) return res.status(404).json({ msg: 'User not found.' });

        if (acceptor.matchmakingBlockedUntil && new Date() < acceptor.matchmakingBlockedUntil) {
            const remainingMins = Math.ceil((new Date(acceptor.matchmakingBlockedUntil) - new Date()) / 60000);
            return res.status(403).json({ msg: `You have a cooldown active. Wait ${remainingMins} minute(s).` });
        }

        resetDailyIfNeeded(acceptor);
        if (acceptor.matchmakingDailyCount >= 3) {
            return res.status(403).json({ msg: 'Daily limit reached. You have used all 3 searches for today.' });
        }

        // 4. Validate requester
        const requester = await User.findById(requesterId);
        if (!requester || requester.blazeCoins < 20) {
            clearActiveSearch(req);
            return res.status(400).json({ msg: 'Match failed — requester does not have enough BlazeCoins.' });
        }

        // 5. All checks passed — clear the search, form the match
        clearTimeout(activeSearch.timer);
        activeSearch = null;

        // Deduct coins + apply 30-minute cooldown to both
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);

        requester.blazeCoins -= 20;
        requester.matchmakingBlockedUntil = cooldownUntil;
        await requester.save();

        acceptor.matchmakingBlockedUntil = cooldownUntil;
        acceptor.matchmakingDailyCount = (acceptor.matchmakingDailyCount || 0) + 1;
        await acceptor.save();

        // Create match room
        const matchId = 'room_' + Date.now();
        activeMatches.set(matchId, {
            player1Id: requesterId,
            player2Id: acceptorId,
            msgCount: { [requesterId]: 0, [acceptorId]: 0 }
        });

        // Notify everyone the search is over
        emit(req, 'mm:search_cleared', {});

        // Notify both players — match formed
        emit(req, 'mm:match_formed', {
            matchId,
            opponent: acceptor.playerId,
            cooldownUntil: cooldownUntil.toISOString()
        }, requesterId);

        emit(req, 'mm:match_formed', {
            matchId,
            opponent: requester.playerId,
            cooldownUntil: cooldownUntil.toISOString()
        }, acceptorId);

        res.json({ msg: 'Match accepted!' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
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

            // Enforce 3-message limit
            const count = (match.msgCount[userId]) || 0;
            if (count >= 3) {
                return res.status(429).json({ msg: 'Message limit reached. Max 3 quick messages per match.' });
            }
            match.msgCount[userId] = count + 1;
            const remaining = 3 - match.msgCount[userId];

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

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');

// Global In-Memory State for Matchmaking
// Note: In a true multi-server production environment, Redis pub/sub would be used here.
let activeRequests = new Map(); // requestId => { requesterId, requesterBlz, timer }
let activeMatches = new Map();  // matchId => { player1Id, player2Id }

// Helper to broadcast using Socket.IO
function broadcast(req, event, data, targetUserId = null) {
    const io = req.app.get('io');
    if (!io) return;
    if (targetUserId) {
        io.to(targetUserId).emit(event, data);
    } else {
        io.emit(event, data);
    }
}

// @route   POST /api/matchmaking/request
// @desc    Broadcast a squad match request to all users
router.post('/request', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Check if user is blocked
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        // Check if user is blocked (from a recent match)
        if (user.matchmakingBlockedUntil && new Date() < user.matchmakingBlockedUntil) {
            const remainingMins = Math.ceil((new Date(user.matchmakingBlockedUntil) - new Date()) / 60000);
            return res.status(403).json({ msg: `You recently played a match. You can play again in ${remainingMins} minutes.` });
        }
        
        // Check Daily Limit (Reset logic is handled primarily in /profile, but we ensure limit here)
        // If they bypass frontend
        if ((user.matchmakingDailyCount || 0) >= 3) {
            // Check if it's a new day to reset locally just in case
            if (!user.matchmakingLastReset || new Date(user.matchmakingLastReset).toDateString() !== new Date().toDateString()) {
                user.matchmakingDailyCount = 0;
                user.matchmakingLastReset = new Date();
            } else {
                return res.status(403).json({ msg: `Daily Limit Reached. You have used your 3 requests for today. Come back tomorrow!` });
            }
        }
        

        // 2. Check if user has enough BlazeCoins
        if (user.blazeCoins < 20) {
            return res.status(400).json({ msg: 'You need at least 20 BlazeCoins to search for a squad.' });
        }

        // 3. Check if a request is already active
        if (activeRequests.has(userId)) {
            return res.status(400).json({ msg: 'You already have an active request.' });
        }

        // 3. Prevent multiple global requests
        if (activeRequests.size > 0) {
            return res.status(400).json({ msg: 'Another player is currently searching for a squad. Please wait.' });
        }

        const requesterBlz = user.playerId; // e.g. Blz-12345
        const requestId = userId; // Use userId as the requestId for simplicity

        // 4. Create the request and the 30-second timer
        const timer = setTimeout(async () => {
            // If the timer expires, the request was not accepted.
            if (activeRequests.has(requestId)) {
                activeRequests.delete(requestId);
                
                // Block the user for 10 minutes since no one accepted
                try {
                    const requesterUser = await User.findById(userId);
                    if (requesterUser) {
                        requesterUser.matchmakingBlockedUntil = new Date(Date.now() + 10 * 60 * 1000);
                        await requesterUser.save();
                    }
                } catch (e) {
                    console.error("Error blocking user on timeout", e);
                }

                // Notify the requester that it expired
                broadcast(req, 'request_expired', { msg: 'No one accepted. You must wait 10 minutes before requesting again.' }, userId);
                
                // Tell everyone else the request is gone
                broadcast(req, 'request_cleared', { requestId });
            }
        }, 30000); // 30 seconds

        activeRequests.set(requestId, { requesterId: userId, requesterBlz, timer });

        // Increment daily count for the requester
        user.matchmakingDailyCount = (user.matchmakingDailyCount || 0) + 1;
        await user.save();

        // 5. Broadcast to ALL connected clients (frontend filters its own)
        broadcast(req, 'incoming_request', { requestId, requesterBlz, requesterId: userId });

        res.json({ msg: 'Request sent. Waiting for 30 seconds...' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/matchmaking/accept/:requestId
// @desc    Accept a squad match request
router.post('/accept/:requestId', authMiddleware, async (req, res) => {
    try {
        const acceptorId = req.user.id;
        const requestId = req.params.requestId;

        // Cannot accept own request
        if (acceptorId === requestId) {
            return res.status(400).json({ msg: 'You cannot accept your own request.' });
        }

        const request = activeRequests.get(requestId);
        if (!request) {
            return res.status(400).json({ msg: 'This request has expired or already been accepted.' });
        }

        // 1. Clear the timer!
        clearTimeout(request.timer);
        activeRequests.delete(requestId);

        // 2. Deduct 20 Blaze Coins from the requester
        const requester = await User.findById(request.requesterId);
        if (requester.blazeCoins < 20) {
            // Technically, we should check this BEFORE they request, but we enforce it here
            broadcast(req, 'request_expired', { msg: 'Match failed. You do not have enough BlazeCoins.' }, request.requesterId);
            broadcast(req, 'request_cleared', { requestId });
            return res.status(400).json({ msg: 'The requester does not have enough BlazeCoins.' });
        }
        
        const acceptor = await User.findById(acceptorId);
        if (acceptor.matchmakingBlockedUntil && new Date() < acceptor.matchmakingBlockedUntil) {
            const remainingMins = Math.ceil((new Date(acceptor.matchmakingBlockedUntil) - new Date()) / 60000);
            return res.status(403).json({ msg: `You recently played a match. You can play again in ${remainingMins} minutes.` });
        }

        if ((acceptor.matchmakingDailyCount || 0) >= 3) {
            if (!acceptor.matchmakingLastReset || new Date(acceptor.matchmakingLastReset).toDateString() !== new Date().toDateString()) {
                acceptor.matchmakingDailyCount = 0;
                acceptor.matchmakingLastReset = new Date();
            } else {
                return res.status(403).json({ msg: `Daily Limit Reached. You have used your 3 requests for today.` });
            }
        }

        // Apply 30-minute block to both players
        const blockTime = new Date(Date.now() + 30 * 60 * 1000); // +30 mins
        
        requester.blazeCoins -= 20;
        requester.matchmakingBlockedUntil = blockTime;
        await requester.save();

        acceptor.matchmakingBlockedUntil = blockTime;
        acceptor.matchmakingDailyCount = (acceptor.matchmakingDailyCount || 0) + 1;
        await acceptor.save();

        // 3. Create the match room (msgCount tracks predefined messages per player, max 3)
        const matchId = 'room_' + Date.now();
        activeMatches.set(matchId, {
            player1Id: request.requesterId,
            player2Id: acceptorId,
            msgCount: { [request.requesterId]: 0, [acceptorId]: 0 }
        });

        // 4. Notify everyone else to clear the popup
        broadcast(req, 'request_cleared', { requestId });

        // 5. Notify the two players that the match is formed
        const matchData1 = { matchId, opponent: acceptor.playerId, role: 'requester' };
        const matchData2 = { matchId, opponent: requester.playerId, role: 'acceptor' };
        
        broadcast(req, 'match_formed', matchData1, request.requesterId);
        broadcast(req, 'match_formed', matchData2, acceptorId);

        res.json({ msg: 'Match accepted!' });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/matchmaking/chat/:matchId
// @desc    Send a predefined message or credentials
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
            // Ensure message is one of the allowed predefined ones
            const allowed = ['Who will create the room?', 'I will create the room', 'You create the room', 'Credentials Sent', 'Joined!'];
            if (!allowed.includes(message)) return res.status(400).json({ msg: 'Invalid message.' });

            // Enforce 3-message limit per player per match
            const playerMsgCount = (match.msgCount && match.msgCount[userId]) || 0;
            if (playerMsgCount >= 3) {
                return res.status(429).json({ msg: 'Message limit reached. You can only send 3 quick messages per match.' });
            }
            // Increment count
            if (!match.msgCount) match.msgCount = {};
            match.msgCount[userId] = playerMsgCount + 1;

            // Notify sender of remaining count so frontend can update
            const remaining = 3 - match.msgCount[userId];
            
            broadcast(req, 'chat_message', { sender: userId, type: 'text', message }, targetId);
            broadcast(req, 'chat_message', { sender: userId, type: 'text', message, remaining }, userId); // echo back to sender with remaining count

        } else if (type === 'credentials') {
            // Validate 10-digit numbers for ID and Pass
            const numRegex = /^\d{1,10}$/;
            if (!numRegex.test(roomId) || !numRegex.test(password)) {
                return res.status(400).json({ msg: 'Room ID and Password must be numbers up to 10 digits only.' });
            }

            const credMsg = `Room ID: ${roomId} | Pass: ${password}`;
            broadcast(req, 'chat_message', { sender: userId, type: 'credentials', message: credMsg }, targetId);
            broadcast(req, 'chat_message', { sender: userId, type: 'credentials', message: credMsg }, userId);
        }

        res.json({ msg: 'Message sent' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/matchmaking/leave/:matchId
// @desc    Leave/Close the room
router.post('/leave/:matchId', authMiddleware, (req, res) => {
    const matchId = req.params.matchId;
    if (activeMatches.has(matchId)) {
        const match = activeMatches.get(matchId);
        const targetId = match.player1Id === req.user.id ? match.player2Id : match.player1Id;
        broadcast(req, 'chat_ended', { msg: 'Opponent has left the room.' }, targetId);
        activeMatches.delete(matchId);
    }
    res.json({ msg: 'Left room' });
});

module.exports = router;

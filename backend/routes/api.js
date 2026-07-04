const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tournament = require('../models/Tournament');
const Clip = require('../models/Clip');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { cacheMiddleware } = require('../middleware/cache');

// Simple in-memory cache for stats to reduce DB load
let statsCache = {
    data: null,
    lastFetched: 0
};
global.clearApiStatsCache = () => {
    statsCache.data = null;
    statsCache.lastFetched = 0;
};
const CACHE_DURATION_MS = 10000; // 10 seconds cache

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../../public/uploads/user_clips');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, 'userclip-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit for raw videos to be trimmed
});

// Middleware to verify JWT token
const authMiddleware = require('../middleware/auth');

// @route   POST /api/clips/submit
// @desc    Submit a Top Clip (max 10s via frontend validation)
router.post('/clips/submit', authMiddleware, upload.single('clip'), async (req, res) => {
    try {
        const { playerId, title, game, startTime, endTime } = req.body;
        if (!playerId || !title || !game || !req.file) {
            return res.status(400).json({ msg: 'Please provide playerId, title, game, and a video clip.' });
        }

        const ClipSubmission = require('../models/ClipSubmission');
        
        const startOfWeek = new Date();
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

        // Limit to 1 submission per week
        const existingSubmission = await ClipSubmission.findOne({
            userId: req.user.id,
            createdAt: { $gte: startOfWeek }
        });

        if (existingSubmission) {
            return res.status(400).json({ msg: 'You have already submitted a clip this week. Voting starts on Saturday!' });
        }
        
        let finalVideoUrl = '/public/uploads/user_clips/' + req.file.filename;

        // 1. Save submission immediately using original video URL
        const newSubmission = new ClipSubmission({
            userId: req.user.id,
            playerId: playerId,
            title: title,
            game: game,
            videoUrl: finalVideoUrl,
            status: 'Pending'
        });

        await newSubmission.save();

        // 2. Start async background processing if trimming is requested
        if (startTime !== undefined && endTime !== undefined) {
            const start = parseFloat(startTime);
            const duration = parseFloat(endTime) - start;

            if (duration > 0 && duration <= 10.5) {
                // Run in background without awaiting
                setImmediate(async () => {
                    const fs = require('fs');
                    const path = require('path');
                    const ffmpeg = require('fluent-ffmpeg');
                    const ffmpegStatic = require('ffmpeg-static');
                    ffmpeg.setFfmpegPath(ffmpegStatic);
                    
                    const originalPath = req.file.path;
                    const trimmedFilename = 'trimmed-' + req.file.filename;
                    const trimmedPath = path.join(path.dirname(originalPath), trimmedFilename);

                    try {
                        await new Promise((resolve, reject) => {
                            ffmpeg(originalPath)
                                .setStartTime(start)
                                .setDuration(duration)
                                .output(trimmedPath)
                                .on('end', () => resolve())
                                .on('error', (err) => reject(err))
                                .run();
                        });

                        // Delete original file safely
                        try { fs.unlinkSync(originalPath); } catch (e) { console.error('Failed to delete original', e); }

                        // Update DB with the new trimmed URL
                        newSubmission.videoUrl = '/public/uploads/user_clips/' + trimmedFilename;
                        await newSubmission.save();
                    } catch (trimErr) {
                        console.error('Background trimming error, keeping original file:', trimErr);
                    }
                });
            }
        }

        const agenda = require('../utils/queue');
        agenda.now('send-inapp-notification', {
            userId: req.user.id,
            title: 'Clip Submitted!',
            message: `Your clip "${title}" has been successfully submitted for review. Check back on Saturday to see if you made the Top 3!`,
            type: 'success'
        });

        res.json({ msg: 'Clip submitted successfully! Under review.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/clip-submissions/me/this-week
// @desc    Check if current user has submitted a clip this week
router.get('/clip-submissions/me/this-week', authMiddleware, async (req, res) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const startOfWeek = new Date();
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

        const existingSubmission = await ClipSubmission.findOne({
            userId: req.user.id,
            createdAt: { $gte: startOfWeek }
        });

        res.json({ hasSubmitted: !!existingSubmission });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/game/:gameId/clips
// @desc    Get top clips for a specific game
router.get('/game/:gameId/clips', cacheMiddleware(300), async (req, res) => {
    try {
        const Clip = require('../models/Clip');
        const clips = await Clip.find({ game: req.params.gameId }).sort({ createdAt: -1 }).limit(3).lean();
        res.json(clips);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/tournaments/confirm-play
// @desc    Handle user clicking YES or NO for "Have you played 2 games?"
router.post('/tournaments/confirm-play', authMiddleware, async (req, res) => {
    try {
        const { regId, played } = req.body;
        if (!regId) return res.status(400).json({ msg: 'Registration ID required' });

        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const agenda = require('../utils/queue');

        const reg = await Registration.findOne({ _id: regId, userId: req.user.id });
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        if (played === 'yes') {
            reg.status = 'Awaiting Verification';
            await reg.save();
            res.json({ msg: 'Status updated to Awaiting Verification' });
        } else {
            // User clicked NO (match didn't happen)
            const user = await User.findById(req.user.id);
            const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
            
            reg.status = 'Missed';
            await reg.save();
            
            // Queue Notification
            agenda.now('send-inapp-notification', {
                userId: req.user.id,
                title: 'Match Slot Concluded',
                message: `We're deeply sorry, but our organizers were unavailable during your ${formatMode} time slot. Your registration has been erased, giving you a fresh start to register again.`,
                type: 'info'
            });

            // Queue Email
            if (user && user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'We Apologize - Organizer Unavailable - Blaze Frontier',
                    html: `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                            <div style="padding: 30px; text-align: left;">
                                <h2 style="color: #ff4e00; margin-top: 0;">We're Sorry.</h2>
                                <p style="font-size: 1.1rem; color: #333;">Hello <strong>${user.inGameName || user.username}</strong>,</p>
                                <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">
                                    It appears our organizers were unfortunately unavailable during your scheduled <strong>${formatMode}</strong> match time.
                                </p>
                                <div style="background-color: #e5f0ff; padding: 15px; border-left: 4px solid #0056b3; margin: 20px 0;">
                                    <p style="margin: 0; color: #004085;"><strong>Fresh Start:</strong> Your previous registration has been completely erased from the system without any penalties. You are free to register for a new tournament slot immediately.</p>
                                </div>
                                <p style="font-size: 1.1rem; color: #333;">We sincerely apologize for the inconvenience and hope to see you on the battlefield soon.</p>
                            </div>
                            <div style="background-color: #111; padding: 15px; text-align: center;">
                                <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- THE BLAZE FRONTIER COMMAND -</p>
                            </div>
                        </div>
                    `
                });
            }

            res.json({ msg: 'Registration erased successfully. You may register again.' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/tournaments/:id/register
// @desc    Register a player for a specific tournament
router.post('/tournaments/:id/register', authMiddleware, async (req, res) => {
    try {
        const discord = req.body.discord || 'N/A';
        const timeSlot = req.body.timeSlot || 'N/A';

        const User = require('../models/User');
        const Registration = require('../models/Registration');
        const Tournament = require('../models/Tournament');

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.status(404).json({ msg: 'Tournament not found' });

        if (tournament.status !== 'UPCOMING' && tournament.status !== 'ACTIVE') {
            return res.status(400).json({ msg: 'Registration is closed for this tournament.' });
        }

        const existing = await Registration.findOne({ 
            userId: user._id, 
            tournamentId: tournament._id,
            status: { $nin: ['Missed', 'Rejected'] }
        });
        
        if (existing) {
            return res.status(400).json({ msg: 'You have already registered for this tournament.' });
        }

        const maxReg = await Registration.findOne().sort({ matchId: -1 });
        const nextMatchId = maxReg && maxReg.matchId ? maxReg.matchId + 1 : 1;

        const newReg = new Registration({
            userId: user._id,
            tournamentId: tournament._id,
            format: 'Tournament',
            mode: tournament.name,
            discord: discord,
            startDate: new Date().toLocaleDateString(),
            timeSlot: timeSlot,
            matchId: nextMatchId,
            status: 'Pending'
        });

        await newReg.save();
        res.json({ msg: `Successfully registered for ${tournament.name}` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/tournaments/:id/participants
// @desc    Get the list of participants (Blaze IDs) for a published tournament
router.get('/tournaments/:id/participants', authMiddleware, async (req, res) => {
    try {
        const Tournament = require('../models/Tournament');
        const Registration = require('../models/Registration');

        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.status(404).json({ msg: 'Tournament not found' });

        if (!tournament.isListPublished) {
            return res.status(403).json({ msg: 'The participant list is not published yet.' });
        }

        const registrations = await Registration.find({ 
            tournamentId: tournament._id, 
            status: { $nin: ['Missed', 'Rejected'] }
        }).populate('userId', 'username').lean();

        // Only return Blaze IDs
        const participants = registrations.map(reg => reg.userId ? reg.userId.username : 'Unknown');

        res.json(participants);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/season/register
// @desc    Register for a Season Match (Requires Genuine + 2 Series)
router.post('/season/register', authMiddleware, async (req, res) => {
    try {
        const { matchName } = req.body;
        if (!matchName) return res.status(400).json({ msg: 'Match name is required' });

        const User = require('../models/User');
        const Registration = require('../models/Registration');

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        if (!user.isGenuine || !user.hasCompletedTwoSeries) {
            return res.status(403).json({ msg: 'Verification incomplete. You must be a genuine player and complete the 2-series challenge.' });
        }

        // Check if already registered
        const existing = await Registration.findOne({ userId: req.user.id, format: 'Season Match', mode: matchName });
        if (existing) {
            return res.status(400).json({ msg: 'You have already registered for this match.' });
        }

        const newReg = new Registration({
            userId: req.user.id,
            format: 'Season Match',
            mode: matchName,
            discord: user.username, // placeholder
            startDate: new Date().toLocaleDateString(),
            timeSlot: 'TBA',
            status: 'Pending'
        });

        await newReg.save();
        res.json({ msg: 'Successfully registered for ' + matchName });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/poster-data
// @desc    Get approved registrations for the poster generator
router.get('/poster-data', authMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const approvedMatches = await Registration.find({ status: 'Approved' }).populate('userId', 'inGameName username');
        res.json(approvedMatches);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/profile
// @desc    Get user profile data and dynamic global ranking
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        // Auto-claim bonuses on login/profile load
        const now = new Date();
        let updated = false;

        if (!user.firstLoginClaimed) {
            user.firstLoginClaimed = true;
            user.blazeCoins = (user.blazeCoins || 0) + 100;
            updated = true;
        }

        if (user.isGenuine && !user.trustedPlayerClaimed) {
            user.trustedPlayerClaimed = true;
            user.blazeCoins = (user.blazeCoins || 0) + 100;
            updated = true;
        }

        let canClaimDaily = false;
        if (!user.lastLoginClaimDate) {
            canClaimDaily = true;
        } else {
            const lastClaim = new Date(user.lastLoginClaimDate);
            if (lastClaim.toDateString() !== now.toDateString()) {
                canClaimDaily = true;
            }
        }

        if (canClaimDaily) {
            user.lastLoginClaimDate = now;
            user.blazeCoins = (user.blazeCoins || 0) + 10;
            updated = true;
        }

        // Reset matchmaking daily limit if it's a new day
        if (user.matchmakingLastReset) {
            const lastReset = new Date(user.matchmakingLastReset);
            if (lastReset.toDateString() !== now.toDateString()) {
                user.matchmakingDailyCount = 0;
                user.matchmakingLastReset = now;
                updated = true;
            }
        } else {
            user.matchmakingDailyCount = 0;
            user.matchmakingLastReset = now;
            updated = true;
        }

        if (updated) {
            await user.save();
            const agenda = require('../utils/queue');
            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: 'Daily Auto-Claim',
                message: 'Your daily login bonus and/or first-time bonuses have been credited to your Blaze Coins.',
                type: 'success'
            });
        }

        // Calculate global rank across the platform by totaling Blaze Points from all Matches
        const Match = require('../models/Match');
        
        // Sum BP for the current user
        const userMatches = await Match.find({ playerId: user._id, status: 'COMPLETED' });
        const userTotalBP = userMatches.reduce((acc, m) => acc + m.blazePoints, 0);

        // Aggregate to find rank (Count users with higher BP)
        const higherRankCount = await User.countDocuments({ blazeCoins: { $gt: user.blazeCoins || 0 } });
        const totalPlayers = await User.countDocuments();
        
        let percentile = 0;
        if (totalPlayers > 1) {
            percentile = Math.round((higherRankCount / totalPlayers) * 100);
        }

        res.json({
            ...user._doc,
            blazeCoins: user.blazeCoins || 0,
            matchmakingDailyCount: user.matchmakingDailyCount || 0,
            globalRankPercentile: percentile,
            rankText: `TOP ${percentile}% GLOBAL`,
            totalMatches: userMatches.length,
            tournamentsWon: userMatches.filter(m => m.placement === 1).length
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/player/:playerId
// @desc    Get public profile data of any user by their Blaze ID (playerId)
router.get('/player/:playerId', authMiddleware, async (req, res) => {
    try {
        const targetUser = await User.findOne({ playerId: req.params.playerId }).select('-password -email -phoneNumber');
        if (!targetUser) {
            return res.status(404).json({ msg: 'Player not found with this Blaze ID' });
        }

        const Match = require('../models/Match');
        const userMatches = await Match.find({ playerId: targetUser._id, status: 'COMPLETED' });
        
        res.json({
            username: targetUser.username,
            inGameName: targetUser.inGameName,
            gameUid: targetUser.gameUid,
            location: targetUser.location,
            profilePic: targetUser.profilePic,
            playerId: targetUser.playerId,
            isGenuine: targetUser.isGenuine,
            isSetupComplete: targetUser.isSetupComplete,
            role: targetUser.role || 'player',
            blazeCoins: targetUser.blazeCoins || 0,
            totalMatches: userMatches.length,
            tournamentsWon: userMatches.filter(m => m.placement === 1).length
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Configure multer for profile picture uploads
const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../../public/uploads/profiles');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, 'profile-' + Date.now() + path.extname(file.originalname));
    }
});
const uploadProfile = multer({
    storage: profileStorage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

// @route   PUT /api/profile
// @desc    Update user profile (inGameName, gameUid, profilePic)
router.put('/profile', authMiddleware, uploadProfile.single('profilePic'), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const { inGameName, gameUid } = req.body;
        
        if (inGameName) user.inGameName = inGameName;
        if (gameUid) user.gameUid = gameUid;
        if (req.file) {
            user.profilePic = '/public/uploads/profiles/' + req.file.filename;
        }

        await user.save();
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Helper for testing locally without Google Auth
router.get('/test-token', async (req, res) => {
    try {
        const User = require('../models/User');
        const user = await User.findOne();
        if (!user) return res.status(404).json({ msg: 'No users found' });
        
        const payload = { id: user.id };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/user/setup
// @desc    Complete user onboarding setup
router.post('/user/setup', authMiddleware, async (req, res) => {
    try {
        const { game, location, ign, uid } = req.body;
        
        const user = await User.findById(req.user.id);
        if(!user) return res.status(404).json({ msg: 'User not found' });
        
        user.location = location;
        user.inGameName = ign;
        user.gameUid = uid;
        user.isSetupComplete = true;
        
        await user.save();
        res.json({ msg: 'Setup complete' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/user/claim-bonus
// @desc    Claim daily and first-time login bonus
router.post('/user/claim-bonus', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        const { type } = req.body;
        const now = new Date();
        let pointsAwarded = 0;
        let messages = [];

        // Check First Time Login
        if ((!type || type === 'first') && !user.firstLoginClaimed) {
            user.firstLoginClaimed = true;
            pointsAwarded += 100;
            messages.push('First time login bonus: +100 BP');
        }

        // Check Trusted Player
        if ((!type || type === 'trusted') && user.isGenuine && !user.trustedPlayerClaimed) {
            user.trustedPlayerClaimed = true;
            pointsAwarded += 100;
            messages.push('Trusted Player bonus: +100 BP');
        }

        // Check Daily Login
        let canClaimDaily = false;
        if (!user.lastLoginClaimDate) {
            canClaimDaily = true;
        } else {
            const lastClaim = new Date(user.lastLoginClaimDate);
            if (lastClaim.toDateString() !== now.toDateString()) {
                canClaimDaily = true;
            }
        }

        if ((!type || type === 'daily') && canClaimDaily) {
            user.lastLoginClaimDate = now;
            pointsAwarded += 10;
            messages.push('Daily login bonus: +10 BP');
        }

        if (pointsAwarded > 0) {
            user.blazeCoins = (user.blazeCoins || 0) + pointsAwarded;
            await user.save();
            
            const Notification = require('../models/Notification');
            await Notification.create({
                userId: user._id,
                title: 'Coins Claimed',
                message: `You successfully claimed ${pointsAwarded} Blaze Coins. (${messages.join(' | ')})`,
                type: 'success'
            });

            res.json({ msg: messages.join(' | '), pointsAwarded, totalBonus: user.blazeCoins, claimed: true });
        } else {
            res.json({ msg: 'No bonuses available right now.', pointsAwarded: 0, totalBonus: user.blazeCoins, claimed: false });
        }

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/user/notifications
// @desc    Get user notifications
router.get('/user/notifications', authMiddleware, async (req, res) => {
    try {
        const Notification = require('../models/Notification');
        const notifs = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json(notifs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/user/notifications/clear
// @desc    Clear all user notifications
router.delete('/user/notifications/clear', authMiddleware, async (req, res) => {
    try {
        const Notification = require('../models/Notification');
        await Notification.deleteMany({ userId: req.user.id });
        res.json({ msg: 'Notifications cleared' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/leaderboard
// @desc    Get top players across all games based on Blaze Points, optional region filtering
router.get('/leaderboard', cacheMiddleware(300), async (req, res) => {
    try {
        const Match = require('../models/Match');
        const User = require('../models/User');
        const regionQuery = req.query.region;

        let userIdsInRegion = null;
        
        // If region is provided, first find all users in that region
        if (regionQuery) {
            const usersInRegion = await User.find({ location: new RegExp(regionQuery, 'i') }).select('_id');
            userIdsInRegion = usersInRegion.map(u => u._id);
        }
        
        // Match stage
        const matchStage = { status: 'COMPLETED' };
        if (userIdsInRegion) {
            matchStage.playerId = { $in: userIdsInRegion };
        }

        // Aggregate to find total BP per player
        const leaderboard = await Match.aggregate([
            { $match: matchStage },
            { $group: { _id: "$playerId", totalBP: { $sum: "$blazePoints" } } },
            { $sort: { totalBP: -1 } },
            { $limit: 100 }
        ]);

        // Populate user details
        const populatedLeaderboard = await Promise.all(leaderboard.map(async (entry, index) => {
            const user = await User.findById(entry._id).select('username inGameName location').lean();
            return {
                rank: index + 1,
                id: entry._id,
                name: user ? (user.inGameName || user.username) : 'Unknown',
                region: user ? (user.location || 'Global') : 'Global',
                bp: entry.totalBP
            };
        }));

        res.json(populatedLeaderboard);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/leaderboard/showcases
// @desc    Get top 3 podium and unique showcase categories
router.get('/leaderboard/showcases', cacheMiddleware(300), async (req, res) => {
    try {
        const Match = require('../models/Match');
        const User = require('../models/User');
        let showcasesObj = {};

        // Top 3 Podium
        const top3Aggr = await Match.aggregate([
            { $match: { status: 'COMPLETED' } },
            { $group: { _id: "$playerId", totalBP: { $sum: "$blazePoints" } } },
            { $sort: { totalBP: -1 } },
            { $limit: 3 }
        ]);

        const podium = await Promise.all(top3Aggr.map(async (entry, idx) => {
            const user = await User.findById(entry._id).select('username inGameName').lean();
            return {
                rank: idx + 1,
                id: entry._id,
                name: user ? (user.inGameName || user.username) : 'Unknown',
                bp: entry.totalBP
            };
        }));

        // MVP (Most BP in a single match)
        const mvpMatch = await Match.findOne({ status: 'COMPLETED' }).sort({ blazePoints: -1 }).populate('playerId', 'username inGameName').lean();
        if (mvpMatch && mvpMatch.playerId) {
            showcasesObj.mvp = {
                title: "Most Valuable Player",
                name: mvpMatch.playerId.inGameName || mvpMatch.playerId.username,
                val: `${mvpMatch.blazePoints} BP in 1 Match`
            };
        }

        // Most Lethal (Highest total kills)
        const lethalAggr = await Match.aggregate([
            { $match: { status: 'COMPLETED' } },
            { $group: { _id: "$playerId", totalKills: { $sum: "$kills" } } },
            { $sort: { totalKills: -1 } },
            { $limit: 1 }
        ]);
        if (lethalAggr.length > 0) {
            const lethalUser = await User.findById(lethalAggr[0]._id).select('username inGameName').lean();
            showcasesObj.lethal = {
                title: "Lethal Operator",
                name: lethalUser ? (lethalUser.inGameName || lethalUser.username) : 'Unknown',
                val: `${lethalAggr[0].totalKills} Total Kills`
            };
        }

        // Survival Expert (Most 1st Place finishes)
        const survivalAggr = await Match.aggregate([
            { $match: { status: 'COMPLETED', placement: 1 } },
            { $group: { _id: "$playerId", wins: { $sum: 1 } } },
            { $sort: { wins: -1 } },
            { $limit: 1 }
        ]);
        if (survivalAggr.length > 0) {
            const survivalUser = await User.findById(survivalAggr[0]._id).select('username inGameName').lean();
            showcasesObj.survival = {
                title: "Survival Specialist",
                name: survivalUser ? (survivalUser.inGameName || survivalUser.username) : 'Unknown',
                val: `${survivalAggr[0].wins} Championships`
            };
        }

        res.json({
            podium,
            showcases: showcasesObj
        });
    } catch(err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/champion
// @desc    Get the reigning Champion across all Matches based on Blaze Points
router.get('/champion', cacheMiddleware(300), async (req, res) => {
    try {
        const Match = require('../models/Match');
        // Find the match with highest BP
        const topMatch = await Match.findOne({ status: 'COMPLETED' })
            .sort({ blazePoints: -1 })
            .populate('playerId', 'username inGameName')
            .lean();
            
        if (!topMatch) {
            return res.json({ name: 'NO CHAMPION YET', bp: 0 });
        }
        res.json({ name: topMatch.playerId.inGameName || topMatch.playerId.username, bp: topMatch.blazePoints });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/poster/:id
// @desc    Generate dynamic GIF banner for an approved match
router.get('/poster/:id', async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const match = await Registration.findById(req.params.id).populate('userId', 'inGameName username');
        if (!match) return res.status(404).send('Not found');

        const { createCanvas } = require('canvas');
        const GIFEncoder = require('gif-encoder-2');

        const width = 800;
        const height = 240;
        const encoder = new GIFEncoder(width, height);
        
        encoder.start();
        encoder.setRepeat(0); // 0 for repeat, -1 for no-repeat
        encoder.setDelay(800); // frame delay in ms
        encoder.setQuality(10); // image quality
        
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const teamA = (match.userId && match.userId.inGameName) ? match.userId.inGameName.toUpperCase() : 'UNKNOWN';
        const teamB = 'CHALLENGERS';
        const formatStr = `${match.format.toUpperCase()} ${match.mode.toUpperCase()}`;
        const dateStr = `${match.startDate} • ${match.timeSlot}`;

        // Function to draw background
        const drawBackground = () => {
            const grd = ctx.createLinearGradient(0, 0, width, height);
            grd.addColorStop(0, '#0a0a0e');
            grd.addColorStop(1, '#111116');
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, width, height);
            
            // Add grid lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.lineWidth = 1;
            for(let i=0; i<width; i+=40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke(); }
            for(let i=0; i<height; i+=40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke(); }
        };

        const drawStaticContent = () => {
            // Draw VS
            ctx.fillStyle = '#ff5722';
            ctx.font = 'italic bold 48px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('VS', width/2, height/2 + 20);

            // Draw Teams
            ctx.fillStyle = '#00bcd4';
            ctx.font = 'bold 42px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(teamA, width/2 - 60, height/2 + 15);
            
            ctx.fillStyle = '#ff3b3b';
            ctx.textAlign = 'left';
            ctx.fillText(teamB, width/2 + 60, height/2 + 15);

            // Draw Date
            ctx.fillStyle = '#e0e0e0';
            ctx.font = 'bold 16px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(dateStr, width/2, height - 25);
        };

        // Frame 1
        drawBackground();
        
        ctx.fillStyle = 'rgba(255, 87, 34, 0.1)';
        ctx.fillRect(0, 0, width, 36);
        ctx.fillStyle = '#ff5722';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`UPCOMING MATCH #${match.matchId || 'N/A'} - ${formatStr}`, width/2, 24);

        drawStaticContent();
        encoder.addFrame(ctx);

        // Frame 2
        drawBackground();

        ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'; 
        ctx.fillRect(0, 0, width, 36);
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`UPCOMING MATCH #${match.matchId || 'N/A'} - ${formatStr}`, width/2, 24);

        drawStaticContent();
        encoder.addFrame(ctx);

        encoder.finish();
        
        const buffer = encoder.out.getData();

        res.set('Content-Type', 'image/gif');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(buffer);
        
    } catch (err) {
        console.error('Poster generation error:', err);
        res.status(500).send('Error generating poster');
    }
});

// @route   GET /api/tournaments
// @desc    Get dynamic tournaments, matches, and registrations separated into Live and Upcoming
router.get('/tournaments', authMiddleware, async (req, res) => {
    try {
        const Match = require('../models/Match');
        const Registration = require('../models/Registration');
        const Tournament = require('../models/Tournament');
        
        function computeStatus(dateString) {
            const tDate = new Date(dateString);
            if (isNaN(tDate.getTime())) return 'UPCOMING';
            const now = Date.now();
            const startTime = tDate.getTime();
            const endTime = startTime + 60 * 60 * 1000; // 1 hour duration
            if (now < startTime) return 'UPCOMING';
            if (now >= startTime && now <= endTime) return 'ACTIVE';
            return 'ENDED';
        }

        const filter = {};
        if (req.query.game) filter.game = new RegExp(req.query.game, 'i');
        
        let live = [];
        let upcoming = [];
        
        const allRegs = await Registration.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
        const userTourneyRegs = new Set(allRegs.filter(r => r.format === 'Tournament' && r.status !== 'Missed' && r.status !== 'Rejected').map(r => r.tournamentId ? r.tournamentId.toString() : ''));

        // 1. Generic Open Tournaments
        const tournaments = await Tournament.find({ ...filter, status: { $ne: 'ENDED' } });
        for (let t of tournaments) {
            const correctStatus = computeStatus(t.date);
            if (t.status !== correctStatus) {
                t.status = correctStatus;
                await t.save();
            }
            
            if (t.status === 'ENDED') continue;

            const isRegistered = userTourneyRegs.has(t._id.toString());
            const now = Date.now();
            const startTime = new Date(t.date).getTime();
            
            let showCredentials = false;
            let credentials = null;
            
            if (isRegistered && !isNaN(startTime) && (now >= startTime - 20 * 60 * 1000) && t.roomId) {
                showCredentials = true;
                credentials = { roomId: t.roomId, roomPassword: t.roomPassword };
            }

            const tObj = {
                type: 'tournament',
                game: t.game.toUpperCase(),
                name: t.name,
                status: t.status,
                participants: t.participants,
                date: t.date,
                _id: t._id,
                prize: t.prize,
                canRegister: t.status === 'UPCOMING' && !isRegistered,
                isListPublished: t.isListPublished,
                showCredentials: showCredentials,
                credentials: credentials
            };
            if (t.status === 'ACTIVE') live.push(tObj);
            else if (t.status === 'UPCOMING') upcoming.push(tObj);
        }
        
        // 2. Global Approved Custom Series (Upcoming Matches for everyone)
        const regFilter = { 
            status: 'Approved',
            format: { $ne: 'Qualification Series' }
        };
        
        const approvedRegs = await Registration.find(regFilter).populate('userId', 'username inGameName').lean();
        approvedRegs.forEach(r => {
            upcoming.push({
                type: 'match',
                id: r._id,
                team: r.mode ? r.mode : (r.teamMembers && r.teamMembers.length > 0 ? 'Squad' : 'Solo'),
                slot: r.timeSlot,
                game: 'CUSTOM SERIES',
                name: `${r.format.toUpperCase()} ${r.mode.toUpperCase()}`,
                status: 'APPROVED',
                participants: r.teamMembers ? r.teamMembers.length + 1 : 1,
                date: r.startDate ? new Date(r.startDate).toLocaleDateString() : 'TBA',
                matchNumber: r.matchId || 'TBA',
                timeSlot: r.timeSlot,
                playerName: r.userId ? (r.userId.inGameName || r.userId.username) : 'Unknown',
                canRegister: false
            });
        });

        // 3. User's Personal Registration Requests (for notification dropdown)
        const requests = allRegs.map(r => {
            let isTimeCompleted = false;
            if (r.startDate && r.timeSlot && r.status !== 'Rejected') {
                const dateObj = new Date(r.startDate);
                const today = new Date();
                
                const todayMid = new Date();
                todayMid.setHours(0,0,0,0);
                
                if (dateObj < todayMid) {
                    isTimeCompleted = true;
                } else if (dateObj.toDateString() === today.toDateString()) {
                    const match = r.timeSlot.match(/-\s*(\d+):(\d+)\s*(AM|PM)/i);
                    if (match) {
                        let hour = parseInt(match[1]);
                        const minute = parseInt(match[2]);
                        const ampm = match[3].toUpperCase();
                        if (ampm === 'PM' && hour !== 12) hour += 12;
                        if (ampm === 'AM' && hour === 12) hour = 0;
                        
                        const endTime = new Date();
                        endTime.setHours(hour, minute, 0, 0);
                        
                        if (new Date() > endTime) {
                            isTimeCompleted = true;
                        }
                    }
                }
            }

            return {
                id: r._id,
                game: 'Series Request',
                format: r.format,
                mode: r.mode,
                status: r.status || 'Pending',
                date: r.startDate,
                discord: r.discord,
                matchNumber: r.matchId || 'TBA',
                timeSlot: r.timeSlot || 'TBA',
                roomId: r.roomId,
                roomPassword: r.roomPassword,
                isTimeCompleted,
                resolutionCause: r.resolutionCause
            };
        });
        
        // 3. User's Matches
        const matches = await Match.find({ playerId: req.user.id }).populate('seriesId').lean();
        
        matches.forEach(m => {
            const gameName = m.seriesId ? m.seriesId.game.toUpperCase() : 'GLOBAL';
            if (req.query.game && !gameName.match(new RegExp(req.query.game, 'i'))) return;
            
            const obj = {
                type: 'match',
                id: m._id,
                team: m.team,
                slot: m.slot,
                game: gameName,
                name: m.seriesId ? m.seriesId.name : 'Series Match',
                status: m.status,
                participants: 'Assigned',
                date: m.startTime ? new Date(m.startTime).toLocaleDateString() : 'TBA',
                canRegister: false
            };
            
            if (m.status === 'LIVE') live.push(obj);
            else if (m.status === 'SCHEDULED') upcoming.push(obj);
        });

        res.json({ live, upcoming, requests });
    } catch (err) {
        require('fs').writeFileSync('temp_error.txt', err.stack);
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/hub/:game/stats
// @desc    Get dynamic global stats for a specific game hub
router.get('/hub/:game/stats', async (req, res) => {
    try {
        const User = require('../models/User');
        const Tournament = require('../models/Tournament');
        const Series = require('../models/Series');
        
        const gameRegex = new RegExp(`^${req.params.game}$`, 'i');
        
        const io = req.app.get('io');
        const activeOperators = io ? io.engine.clientsCount : await User.countDocuments({});
        const liveMatches = await Series.countDocuments({ game: gameRegex, status: 'ONGOING' });
        const activeTournaments = await Tournament.countDocuments({ game: gameRegex, status: { $in: ['ACTIVE', 'UPCOMING'] } });
        
        res.json({
            activeOperators,
            liveMatches,
            activeTournaments
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/tournaments/verify-discord
// @desc    Verify if a user is in the official Discord Server
router.post('/tournaments/verify-discord', authMiddleware, async (req, res) => {
    try {
        const { discordName } = req.body;
        if(!discordName) return res.status(400).json({ msg: 'Discord Username is required' });

        const { verifyUserInServer } = require('../discordBot');
        const result = await verifyUserInServer(discordName);

        if (result.success) {
            res.json({ msg: result.msg });
        } else {
            res.status(404).json({ msg: result.msg });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/tournaments/slots
// @desc    Get slot availability for a specific date
router.get('/tournaments/slots', authMiddleware, async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ msg: 'Date is required' });

        const Registration = require('../models/Registration');
        const timeSlots = ['9:00 AM - 10:00 AM', '10:00 AM - 11:00 AM', '4:00 PM - 5:00 PM', '6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM'];
        
        // Find all bookings for this specific date
        const bookings = await Registration.find({ 
            startDate: date,
            status: { $in: ['Pending', 'Approved'] } 
        });
        
        const bookedSlots = bookings.map(b => b.timeSlot).filter(Boolean);
        
        const dateObj = new Date(date);
        const today = new Date();
        const isToday = dateObj.toDateString() === today.toDateString();
        
        const slotsData = timeSlots.map(slot => {
            let isPast = false;
            if (isToday) {
                const match = slot.match(/^(\d+):(\d+) (AM|PM)/);
                if (match) {
                    let hour = parseInt(match[1]);
                    const minute = parseInt(match[2]);
                    const ampm = match[3];
                    if (ampm === 'PM' && hour !== 12) hour += 12;
                    if (ampm === 'AM' && hour === 12) hour = 0;
                    
                    const slotTime = new Date();
                    slotTime.setHours(hour, minute, 0, 0);
                    
                    if (slotTime < today) {
                        isPast = true;
                    }
                }
            }

            return {
                time: slot,
                available: !bookedSlots.includes(slot) && !isPast
            };
        });
        
        const isFull = slotsData.every(s => !s.available);
        
        res.json({ slots: slotsData, isFull });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// @route   POST /api/tournaments/verify-team
// @desc    Verify if team members exist and are not already registered
router.post('/tournaments/verify-team', authMiddleware, async (req, res) => {
    try {
        const { teamMembers } = req.body;
        if (!teamMembers || !Array.isArray(teamMembers) || teamMembers.length === 0) {
            return res.status(400).json({ msg: 'Team members array is required' });
        }

        const User = require('../models/User');
        const Registration = require('../models/Registration');

        // Check if all users exist
        const users = await User.find({ playerId: { $in: teamMembers } });
        if (users.length !== teamMembers.length) {
            const foundIds = users.map(u => u.playerId);
            const missingIds = teamMembers.filter(id => !foundIds.includes(id));
            return res.status(400).json({ msg: `Invalid Blaze IDs found: ${missingIds.join(', ')}` });
        }

        // Check if any team member is already registered in an active series
        const userObjectIds = users.map(u => u._id);

        const existingRegs = await Registration.find({
            $or: [
                { userId: { $in: userObjectIds } },
                { teamMembers: { $in: teamMembers } }
            ],
            status: { $in: ['Pending', 'Approved'] }
        });

        if (existingRegs.length > 0) {
            return res.status(400).json({ msg: 'One or more team members are already registered in an active series.' });
        }

        res.json({ msg: 'Team verified successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/tournaments/register
// @desc    Register for a 2-match series
router.post('/tournaments/register', authMiddleware, async (req, res) => {
    try {
        const { format, mode, skills, discord, startDate, timeSlot, teamMembers } = req.body;
        if(!format || !mode || !discord || !startDate || !timeSlot) {
            return res.status(400).json({ msg: 'Please provide all required fields including a time slot' });
        }

        const Registration = require('../models/Registration');
        const User = require('../models/User');

        let teamArray = teamMembers || [];
        if (teamArray.length > 0) {
            const users = await User.find({ playerId: { $in: teamArray } });
            if (users.length !== teamArray.length) {
                return res.status(400).json({ msg: 'Invalid Blaze IDs in team.' });
            }
            const userObjectIds = users.map(u => u._id);
            const teamExisting = await Registration.findOne({
                $or: [
                    { userId: { $in: userObjectIds } },
                    { teamMembers: { $in: teamArray } }
                ],
                status: { $in: ['Pending', 'Approved'] }
            });
            if (teamExisting) {
                return res.status(400).json({ msg: 'One or more team members are already registered in an active series.' });
            }
        }

        // Check if user already has an active registration (Redundant if team is provided, but good for Solo)
        const activeUserReg = await Registration.findOne({
            userId: req.user.id,
            status: { $in: ['Pending', 'Approved', 'Awaiting Verification'] }
        });
        
        if(activeUserReg) {
            return res.status(400).json({ msg: 'You already have an active or pending registration request.' });
        }

        // Check if Discord ID is already registered by someone else
        const discordUsed = await Registration.findOne({
            discord: discord,
            status: { $in: ['Pending', 'Approved'] }
        });
        
        if(discordUsed) {
            return res.status(400).json({ msg: 'This Discord Name is already registered in an active series. Please try a new name to prevent fake entries.' });
        }

        // Check if slot is taken
        const existing = await Registration.findOne({
            startDate: startDate,
            timeSlot: timeSlot,
            status: { $in: ['Pending', 'Approved'] }
        });
        
        if(existing) {
            return res.status(400).json({ msg: 'This time slot is already booked. Please choose another slot.' });
        }

        const maxReg = await Registration.findOne().sort({ matchId: -1 });
        const nextMatchId = maxReg && maxReg.matchId ? maxReg.matchId + 1 : 1;

        const newReg = new Registration({
            userId: req.user.id,
            format,
            mode,
            skills: skills || 'on',
            discord,
            startDate,
            timeSlot,
            teamMembers: teamArray,
            matchId: nextMatchId
        });

        await newReg.save();
        
        const agenda = require('../utils/queue');
        agenda.now('send-inapp-notification', {
            userId: req.user.id,
            title: 'Registration Submitted',
            message: `Your registration for the ${format.toUpperCase()} ${mode.toUpperCase()} series on ${startDate} has been successfully submitted and is pending review.`,
            type: 'success'
        });

        // Also send email
        const user = await User.findById(req.user.id);
        if (user && user.email) {
            agenda.now('send-email', {
                email: user.email,
                subject: 'Registration Submitted - Blaze Frontier',
                html: `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                            <div style="padding: 30px; text-align: left;">
                                <h2 style="color: #ff4e00; margin-top: 0;">Registration Received!</h2>
                                <p style="font-size: 1.1rem; color: #333;">Hello <strong>${user.inGameName || user.username}</strong>,</p>
                                <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">Your registration for the <strong>${format.toUpperCase()} ${mode.toUpperCase()}</strong> series on <strong>${startDate}</strong> has been successfully submitted!</p>
                                <div style="background-color: #fff3e0; padding: 15px; border-left: 4px solid #ff4e00; margin: 20px 0;">
                                    <p style="margin: 0; color: #cc3e00;">Our Admin team is currently reviewing your eligibility. You will receive another email with further instructions once you are verified and approved.</p>
                                </div>
                            </div>
                            <div style="background-color: #111; padding: 15px; text-align: center;">
                                <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- The Blaze Frontier Team</p>
                            </div>
                        </div>
                    `
            });
        }

        res.json(newReg);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// @route   GET /api/game/:gameId/overview
// @desc    Get dynamic game overview stats
router.get('/game/:gameId/overview', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const gameRegex = new RegExp(gameId, 'i');
        
        const activeCommanders = await User.countDocuments();
        const liveMatches = await Series.countDocuments({ game: gameRegex, status: 'ONGOING' });
        const activeTournaments = await Tournament.countDocuments({ game: gameRegex, status: { $in: ['ACTIVE', 'UPCOMING'] } });

        res.json({
            activeCommanders: activeCommanders.toLocaleString(),
            liveMatches: liveMatches || 0,
            activeTournaments: activeTournaments || 0,
            avgMatchLength: gameId === 'freefire' ? '15.2m' : '5.2m',
            featuredStreamer: {
                name: "SargeDestroyer",
                viewers: `1.5K`,
                highlight: `💣 24 kills`
            },
            topStreamer: {
                name: "RocketKing",
                viewers: 800
            }
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/game/:gameId/leaderboard
// @desc    Get dynamic game leaderboard from User DB
router.get('/game/:gameId/leaderboard', async (req, res) => {
    try {
        const users = await User.find().sort({ blazeCoins: -1 }).limit(10);
        
        // Map to frontend expected format
        const maxBp = users.length > 0 ? users[0].blazeCoins || 1 : 1;
        const leaderboard = users.map((u, index) => {
            let initials = u.username.substring(0, 2).toUpperCase();
            if (u.username.includes('_')) {
                const parts = u.username.split('_');
                initials = (parts[0][0] + (parts[1][0] || '')).toUpperCase();
            }
            
            return {
                rank: index + 1,
                name: u.username.toUpperCase(),
                initials: initials,
                tier: u.tier,
                rp: (u.blazeCoins || 0).toLocaleString(),
                percent: Math.round(((u.blazeCoins || 0) / maxBp) * 100)
            };
        });
        
        res.json(leaderboard);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/dashboard/stats
// @desc    Get dynamic dashboard stats
router.get('/dashboard/stats', async (req, res) => {
    try {
        let payload = null;
        if (statsCache.data && (Date.now() - statsCache.lastFetched < CACHE_DURATION_MS)) {
            payload = { ...statsCache.data };
        }

        const User = require('../models/User');
        const Match = require('../models/Match');
        const News = require('../models/News');
        const Series = require('../models/Series');
        const Tournament = require('../models/Tournament');
        const PlayerOfTheDay = require('../models/PlayerOfTheDay');
        const Registration = require('../models/Registration');
        const mongoose = require('mongoose');
        
        if (!payload) {
            const activeCommanders = await User.countDocuments();
            
            const today = new Date();
            const tzOffset = today.getTimezoneOffset() * 60000;
            const localISOTime = new Date(today.getTime() - tzOffset).toISOString().split('T')[0];
            
            const todaysRegs = await Registration.find({
                startDate: localISOTime,
                status: { $in: ['Pending', 'Approved'] }
            });
            
            const uniqueSlots = new Set(todaysRegs.map(r => r.timeSlot).filter(Boolean));
            const matchesToday = `${uniqueSlots.size} / 5`;
            
            const load = Math.floor(Math.random() * (85 - 45 + 1) + 45);
            
            const activeTournaments = await Tournament.countDocuments({ status: 'ACTIVE' });
            const totalBPAgg = await Match.aggregate([{ $match: { status: 'COMPLETED' } }, { $group: { _id: null, total: { $sum: "$blazePoints" } } }]);
            const totalBP = totalBPAgg.length > 0 ? (totalBPAgg[0].total / 1000).toFixed(1) + 'K' : '0';
            
            const DailyContent = require('../models/DailyContent');
            let dailyContentRecord = await DailyContent.findOne();
            if (!dailyContentRecord) {
                dailyContentRecord = {
                    title: 'Daily Showcase',
                    youtubeLink: 'https://www.youtube.com/embed/live_stream?channel=UCYOURCHANNELID',
                    facebookLink: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Ffacebook%2Fvideos%2F10153231379946729%2F&show_text=false'
                };
            }

            const formattedSeries = [
                {
                    id: 'main-broadcast',
                    game: 'DAILY HIGHLIGHTS',
                    name: dailyContentRecord.title,
                    status: 'NEW CONTENT',
                    isLive: true,
                    color: 'var(--blaze-orange)',
                    streamUrl: '/dashboard/content',
                    youtubeLink: dailyContentRecord.youtubeLink,
                    facebookLink: dailyContentRecord.facebookLink
                }
            ];
            const upcomingMatches = [];
            
            const recentRegs = await Registration.find()
                .populate('userId', 'inGameName username')
                .sort({ createdAt: -1 })
                .limit(3);

            const recentTrusted = await User.find({ isGenuine: true })
                .sort({ createdAt: -1 })
                .limit(2);

            let dynamicNews = [];

            recentRegs.forEach(reg => {
                const playerName = reg.userId ? (reg.userId.inGameName || reg.userId.username) : 'A player';
                const action = reg.status === 'Approved' ? 'was APPROVED for' : 'REGISTERED for';
                dynamicNews.push({
                    tag: 'EVENT',
                    tagClass: 'event',
                    title: `${playerName.toUpperCase()} ${action} the ${reg.format.toUpperCase()} ${reg.mode.toUpperCase()} Qualification Series!`,
                    date: new Date(reg.createdAt).toLocaleDateString(),
                    timestamp: new Date(reg.createdAt).getTime()
                });
            });

            recentTrusted.forEach(user => {
                const playerName = user.inGameName || user.username;
                dynamicNews.push({
                    tag: 'UPDATE',
                    tagClass: 'update',
                    title: `${playerName.toUpperCase()} just became a TRUSTED PLAYER of BlazeFrontier!`,
                    date: new Date(user.createdAt).toLocaleDateString(),
                    timestamp: new Date(user.createdAt).getTime()
                });
            });

            const dbNews = await News.find().sort({ createdAt: -1 }).limit(2);
            dbNews.forEach(n => {
                dynamicNews.push({
                    tag: n.tag || 'ANNOUNCE',
                    tagClass: n.tagClass || 'announce',
                    title: n.title,
                    date: n.date || new Date(n.createdAt).toLocaleDateString(),
                    timestamp: new Date(n.createdAt).getTime() || Date.now()
                });
            });

            dynamicNews.sort((a, b) => b.timestamp - a.timestamp);
            dynamicNews = dynamicNews.slice(0, 5);

            const potdRecord = await PlayerOfTheDay.findOne({ isActive: true }).populate('userId', 'inGameName username playerId').lean();
            let potd = null;
            if (potdRecord && potdRecord.userId) {
                potd = {
                    videoUrl: potdRecord.videoUrl,
                    playerName: potdRecord.userId.inGameName || potdRecord.userId.username,
                    playerId: potdRecord.userId.playerId || 'N/A',
                    title: potdRecord.title,
                    isGenuine: potdRecord.userId.isGenuine || false
                };
            }
            
            payload = {
                serverLoad: `${load}%`,
                activeCommanders: activeCommanders.toLocaleString(),
                matchesToday: matchesToday,
                network: {
                    activeTournaments: activeTournaments || 0,
                    totalBCAwarded: totalBPAgg.length > 0 ? totalBP : '0',
                    region: 'IN-SOUTH',
                    latency: Math.floor(Math.random() * 15 + 15) + 'ms'
                },
                liveMatches: formattedSeries,
                upcomingMatches: upcomingMatches,
                news: dynamicNews,
                potd: potd
            };

            statsCache.data = payload;
            statsCache.lastFetched = Date.now();
        }

        // ALWAYS fetch top player fresh
        const topPlayers = await User.find().sort({ blazeCoins: -1 }).limit(1).lean();
        const topPlayer = topPlayers.length > 0 ? topPlayers[0] : null;
        
        payload.topCommander = topPlayer ? {
            name: (topPlayer.inGameName || topPlayer.username).toUpperCase(),
            id: topPlayer.playerId || 'N/A',
            coins: topPlayer.blazeCoins || 0
        } : null;

        res.json(payload);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/live-streams
// @desc    Get all live streams
router.get('/live-streams', async (req, res) => {
    try {
        const LiveStream = require('../models/LiveStream');
        const liveStreams = await LiveStream.find().sort({ status: -1, createdAt: -1 }); // LIVE first, then ENDED
        res.json(liveStreams);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});
// --- Voting System Routes ---

// @route   GET /api/voting-event/active
// @desc    Get the active voting event
router.get('/voting-event/active', async (req, res) => {
    try {
        const VotingEvent = require('../models/VotingEvent');
        require('../models/ClipSubmission'); // Ensure it's registered for populate
        const event = await VotingEvent.findOne()
            .sort({ _id: -1 })
            .populate({
                path: 'clips',
                select: 'title videoUrl game playerId userId author' // author might not be in ClipSubmission, let's just select what's there
            })
            .lean();
        
        if (!event) return res.status(404).json({ msg: 'No active voting event' });
        
        // Strictly enforce real-time logic: Voting ONLY on Saturday (Day 6)
        if (new Date().getDay() !== 6) {
            event.isActive = false;
        }

        res.json(event);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/voting-event/:eventId/vote
// @desc    Cast a vote and leave a comment
router.post('/voting-event/:eventId/vote', authMiddleware, async (req, res) => {
    try {
        const Vote = require('../models/Vote');
        const { clipId, comment } = req.body;
        
        const VotingEvent = require('../models/VotingEvent');
        
        const event = await VotingEvent.findById(req.params.eventId);
        if (!event) return res.status(404).json({ msg: 'Event not found' });
        if (!event.isActive) return res.status(400).json({ msg: 'Voting has ended for this event!' });

        const existingVote = await Vote.findOne({ eventId: req.params.eventId, userId: req.user.id });
        if (existingVote) {
            return res.status(400).json({ msg: 'You have already voted in this event' });
        }

        const newVote = new Vote({
            eventId: req.params.eventId,
            userId: req.user.id,
            clipId: clipId,
            comment: comment || ''
        });

        await newVote.save();
        res.json({ msg: 'Vote cast successfully' });
    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ msg: 'You have already voted in this event' });
        }
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/voting-event/:eventId/results
// @desc    Get voting results and comments
router.get('/voting-event/:eventId/results', async (req, res) => {
    try {
        const Vote = require('../models/Vote');
        const mongoose = require('mongoose');
        const eventObjectId = new mongoose.Types.ObjectId(req.params.eventId);
        
        const results = await Vote.aggregate([
            { $match: { eventId: eventObjectId } },
            { $group: { _id: "$clipId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const comments = await Vote.find({ 
            eventId: req.params.eventId, 
            comment: { $ne: '' } 
        })
        .populate('userId', 'username inGameName profilePicture')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

        res.json({ rankings: results, comments });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

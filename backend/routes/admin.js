const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Series = require('../models/Series');
const Match = require('../models/Match');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../../public/uploads/clips');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, 'potd-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Admin Middleware (Auth temporarily disabled as requested)
const adminMiddleware = async (req, res, next) => {
    next();
};

// @route   POST /api/admin/potd
// @desc    Upload new Player of the Day video
router.post('/potd', upload.single('video'), async (req, res) => {
    try {
        const PlayerOfTheDay = require('../models/PlayerOfTheDay');
        const { playerId, title, playerName } = req.body;

        if (!playerId) {
            return res.status(400).json({ msg: 'Blaze ID is required' });
        }
        if (!req.file) {
            return res.status(400).json({ msg: 'Video file is required' });
        }

        // Look up user by Blaze ID (playerId)
        const user = await User.findOne({ playerId: playerId });
        if (!user) {
            return res.status(404).json({ msg: 'User with this Blaze ID not found' });
        }

        // Deactivate old
        await PlayerOfTheDay.updateMany({}, { isActive: false });

        // Create new
        const newPotd = new PlayerOfTheDay({
            userId: user._id,
            playerName: playerName || user.inGameName || user.username,
            title: title || 'Top Clip',
            videoUrl: '/public/uploads/clips/' + req.file.filename,
            isActive: true
        });

        await newPotd.save();
        res.json({ msg: 'Player of the Day updated successfully!', potd: newPotd });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/registrations
// @desc    Get all registrations
router.get('/registrations', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const regs = await Registration.find().populate('userId', 'username inGameName email playerId gameUid').sort({ createdAt: -1 });
        res.json(regs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/registrations/:id
// @desc    Update registration status
router.put('/registrations/:id', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const sendEmail = require('../utils/sendEmail');

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        if (req.body.status === 'Approved') {
            const count = await Registration.countDocuments({ startDate: reg.startDate, status: 'Approved' });
            if (count >= 4 && reg.status !== 'Approved') {
                return res.status(400).json({ msg: 'Cannot approve. The maximum 4 slots are already filled for this date.' });
            }
        }

        const wasPending = reg.status === 'Pending';
        reg.status = req.body.status || reg.status;
        await reg.save();

        if (wasPending && reg.status === 'Approved') {
            const user = await User.findById(reg.userId);
            const agenda = require('../utils/queue');
            const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;

            // Queue in-app Notification for the user
            agenda.now('send-inapp-notification', {
                userId: reg.userId,
                title: 'Registration Approved!',
                message: `Your registration for the ${formatMode} tournament on ${reg.startDate} has been Approved. Get ready for battle!`,
                type: 'success'
            });

            if (user && user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'Tournament Registration Approved! - Blaze Frontier',
                    html: `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 20px;">
                            <div style="margin-bottom: 30px;">
                                <img src="cid:tournamentposter" alt="Tournament Poster" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                            </div>
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #333; margin-bottom: 25px;">
                                Your registration for the <strong>${formatMode}</strong> tournament on <strong>${reg.startDate}</strong> at <strong>${reg.timeSlot}</strong> has been officially confirmed.
                            </p>
                            <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px;">- THE BLAZE FRONTIER COMMAND -</p>
                        </div>
                    `,
                    attachments: [
                        {
                            filename: 'tournament_poster.png',
                            path: require('path').join(__dirname, '../../public/tournament_poster.png'),
                            cid: 'tournamentposter'
                        }
                    ]
                });
            }
        }

        res.json(reg);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/verify-player/:id
// @desc    Admin verifies a player (making them Trusted Player)
router.put('/verify-player/:id', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const sendEmail = require('../utils/sendEmail');

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        if (reg.status !== 'Awaiting Verification') {
            return res.status(400).json({ msg: 'Registration is not awaiting verification.' });
        }

        const user = await User.findById(reg.userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Make Genuine & Give 100 Coins
        user.isGenuine = true;
        user.blazePoints = (user.blazePoints || 0) + 100;
        await user.save();

        // Update registration status to Verified
        reg.status = 'Verified';
        await reg.save();

        const agenda = require('../utils/queue');

        // Notification
        agenda.now('send-inapp-notification', {
            userId: user._id,
            title: '🎉 You are now a Trusted Player!',
            message: `Your recent matches have been verified! You have been granted the Trusted Player Golden Banner and 100 BlazeCoins!`,
            type: 'success'
        });

        // Email
        if (user.email) {
            agenda.now('send-email', {
                email: user.email,
                subject: 'You are now a Trusted Player! - Blaze Frontier',
                html: `
                    <div style="font-family: sans-serif; color: #111;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <img src="cid:trusted_member_banner" alt="Trusted Member Verified" style="max-width: 100%; border-radius: 12px; display: block; margin: 0 auto;">
                        </div>
                        <p>Congratulations <strong>${user.inGameName || user.username}</strong>!</p>
                        <p>Your recent matches were verified by the admin team. You are now officially a <strong>Trusted Player</strong> in Blaze Frontier.</p>
                        <p><strong>Rewards Unlocked:</strong><br/>- Golden Trusted Player Banner<br/>- 100 BlazeCoins<br/>- Access to Elite Tournaments</p>
                        <br/>
                        <p style="color: #ff4e00;">- The Blaze Frontier Team</p>
                    </div>
                `,
                attachments: [
                    {
                        filename: 'trusted_member.jpg',
                        path: require('path').join(__dirname, '../../public/trusted_member.jpg'),
                        cid: 'trusted_member_banner'
                    }
                ]
            });
        }

        res.json({ msg: 'Player verified successfully!' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/squad-details/:id
// @desc    Get populated user details for the entire squad (captain + members)
router.get('/squad-details/:id', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const User = require('../models/User');

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        let playerIds = [...(reg.teamMembers || [])];
        const captain = await User.findById(reg.userId);
        if (captain && !playerIds.includes(captain.playerId)) {
            playerIds.unshift(captain.playerId);
        }

        const squadUsers = await User.find({ playerId: { $in: playerIds } }).select('-password -__v');

        res.json({
            matchId: reg.matchId,
            squad: squadUsers
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/verify-squad/:id
// @desc    Admin verifies the entire squad after a completed match
router.put('/verify-squad/:id', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const agenda = require('../utils/queue');

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        let playerIds = [...(reg.teamMembers || [])];
        const captain = await User.findById(reg.userId);
        if (captain && !playerIds.includes(captain.playerId)) {
            playerIds.push(captain.playerId);
        }

        const squadUsers = await User.find({ playerId: { $in: playerIds } });

        for (const user of squadUsers) {
            user.isGenuine = true;
            user.blazePoints = (user.blazePoints || 0) + 100;
            await user.save();

            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: '🎉 You are now a Trusted Player!',
                message: `Your recent matches have been verified! You have been granted the Trusted Player Golden Banner and 100 BlazeCoins!`,
                type: 'success'
            });

            if (user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'You are now a Trusted Player! - Blaze Frontier',
                    html: `
                        <div style="font-family: sans-serif; color: #111;">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <img src="cid:trusted_member_banner" alt="Trusted Member Verified" style="max-width: 100%; border-radius: 12px; display: block; margin: 0 auto;">
                            </div>
                            <p>Congratulations <strong>${user.inGameName || user.username}</strong>!</p>
                            <p>Your recent matches were verified by the admin team. You are now officially a <strong>Trusted Player</strong> in Blaze Frontier.</p>
                            <p><strong>Rewards Unlocked:</strong><br/>- Golden Trusted Player Banner<br/>- 100 BlazeCoins<br/>- Access to Elite Tournaments</p>
                            <br/>
                            <p style="color: #ff4e00;">- The Blaze Frontier Team</p>
                        </div>
                    `,
                    attachments: [
                        {
                            filename: 'trusted_member.jpg',
                            path: require('path').join(__dirname, '../../public/trusted_member.jpg'),
                            cid: 'trusted_member_banner'
                        }
                    ]
                });
            }
        }

        reg.status = 'Verified';
        reg.isCompleted = true; // Auto mark completed
        await reg.save();

        res.json({ msg: 'Squad successfully verified!' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/registrations/:id/completion
// @desc    Admin marks a match as Completed or Not Completed
router.put('/registrations/:id/completion', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        reg.isCompleted = req.body.isCompleted;
        await reg.save();

        res.json({ msg: 'Match status updated', reg });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/admin/registrations/:id
// @desc    Completely delete a registration request
router.delete('/registrations/:id', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const Notification = require('../models/Notification');
        const User = require('../models/User');
        const sendEmail = require('../utils/sendEmail');

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        const userId = reg.userId;
        const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
        const reason = req.body.reason || 'No reason provided by administration.';

        await Registration.findByIdAndDelete(req.params.id);

        const agenda = require('../utils/queue');

        // Queue notification that registration was deleted
        agenda.now('send-inapp-notification', {
            userId: userId,
            title: 'Registration Rejected & Deleted',
            message: `Your ${formatMode} registration was declined. Reason: ${reason}. You may now rectify the issue and submit a new form.`,
            type: 'error'
        });

        // Queue Email
        const user = await User.findById(userId);
        if (user && user.email) {
            agenda.now('send-email', {
                email: user.email,
                subject: 'Registration Declined - Blaze Frontier',
                html: `
                    <div style="background: linear-gradient(145deg, #2a0f0f, #4b1b1b); color: #fff; padding: 30px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border-radius: 12px; border: 1px solid rgba(222, 74, 74, 0.2); text-align: center;">
                        <h1 style="color: #ef4444; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">Registration Declined</h1>
                        <p style="font-size: 1.1rem; line-height: 1.6; color: #cbd5e1; margin-bottom: 25px;">Your registration for the <strong style="color: #fff;">${formatMode}</strong> tournament on <strong style="color: #fff;">${reg.startDate}</strong> has been declined and removed.</p>
                        <div style="margin: 25px 0; padding: 15px; background: rgba(0, 0, 0, 0.4); border-radius: 8px; border-left: 4px solid #ef4444;">
                            <p style="margin: 0; color: #fff; font-weight: bold;">Reason: ${reason}</p>
                        </div>
                        <p style="color: #cbd5e1;">You may submit a new registration after fixing the issue.</p>
                        <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.1); margin: 30px 0;">
                        <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px;">- THE BLAZE FRONTIER COMMAND -</p>
                    </div>
                `
            });
        }

        res.json({ msg: 'Registration completely removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/registrations/:id/credentials
// @desc    Admin sets Room ID and Password for a Qualification match, and notifies user
router.put('/registrations/:id/credentials', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const { roomId, roomPassword } = req.body;

        const reg = await Registration.findById(req.params.id);
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        reg.roomId = roomId;
        reg.roomPassword = roomPassword;
        await reg.save();

        const user = await User.findById(reg.userId);
        if (user) {
            const agenda = require('../utils/queue');
            const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;

            // Queue Notification
            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: 'Match Credentials Available!',
                message: `The Room ID and Password for your ${formatMode} match on ${reg.startDate} are now available in your dashboard.`,
                type: 'success'
            });

            // Queue Email
            if (user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'Your Match Credentials - Blaze Frontier',
                    html: `
                        <div style="background: #111116; color: #fff; padding: 20px; font-family: sans-serif; border-radius: 8px; border: 1px solid #00bcd4;">
                            <h2 style="color: #00bcd4; text-align: center;">Match Credentials</h2>
                            <p>Hello <strong>${user.inGameName || user.username}</strong>,</p>
                            <p>The room details for your upcoming <strong>${formatMode}</strong> match on <strong>${reg.startDate}</strong> are ready.</p>
                            <div style="background: rgba(0,0,0,0.5); padding: 15px; border-left: 4px solid #00bcd4; margin: 20px 0;">
                                <p style="margin:0; font-family: monospace; font-size: 1.2rem;"><strong>Room ID:</strong> ${roomId}</p>
                                <p style="margin:5px 0 0 0; font-family: monospace; font-size: 1.2rem;"><strong>Password:</strong> ${roomPassword}</p>
                            </div>
                            <p>Please ensure you and your squad join the room before the scheduled start time. Good luck!</p>
                            <br/>
                            <p style="color: #ff4e00;">- The Blaze Frontier Admin Team</p>
                        </div>
                    `
                });
            }
        }

        res.json({ msg: 'Credentials saved and user notified successfully!', reg });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/series
// @desc    Create a new 2-match Series
router.post('/series', adminMiddleware, async (req, res) => {
    try {
        const { name, game } = req.body;
        const series = new Series({ name, game });
        await series.save();
        res.json(series);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/news
// @desc    Broadcast a platform update
router.post('/news', adminMiddleware, async (req, res) => {
    try {
        const { title, tag, tagClass } = req.body;
        const News = require('../models/News');

        const newsItem = new News({
            title,
            tag: tag || 'UPDATE',
            tagClass: tagClass || 'tag-update',
            date: 'Just now'
        });

        await newsItem.save();
        res.json(newsItem);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/match
// @desc    Schedule a match for a user in a series
router.post('/match', adminMiddleware, async (req, res) => {
    try {
        const { seriesId, matchNumber, playerId, team, slot, startTime } = req.body;
        const match = new Match({
            seriesId, matchNumber, playerId, team, slot, startTime
        });
        await match.save();
        // Here we would trigger the email notification
        // sendMatchEmail(user.email, match);
        res.json(match);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/match/:matchId
// @desc    Get details of a match for predefined stats review
router.get('/match/:matchId', adminMiddleware, async (req, res) => {
    try {
        const match = await Match.findById(req.params.matchId)
            .populate('playerId', 'username inGameName playerId')
            .populate('seriesId', 'name game');

        if (!match) return res.status(404).json({ msg: 'Match not found' });

        res.json(match);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/match/:matchId/score
// @desc    Input stats for a completed match (30 min limit reached)
router.post('/match/:matchId/score', adminMiddleware, async (req, res) => {
    try {
        const { kills, survivalTimeMinutes, placement } = req.body;
        const match = await Match.findById(req.params.matchId);

        if (!match) return res.status(404).json({ msg: 'Match not found' });

        // BP Algorithm
        let bp = (kills * 10);
        if (placement === 1) bp += 50;
        else if (placement <= 3) bp += 30;
        else if (placement <= 10) bp += 10;

        bp += (survivalTimeMinutes * 2); // 2 BP per minute survived

        match.kills = kills;
        match.survivalTimeMinutes = survivalTimeMinutes;
        match.placement = placement;
        match.blazePoints = bp;
        match.isCompleted = true;
        match.status = 'COMPLETED';

        await match.save();
        res.json(match);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/ban/:userId
// @desc    Ban a user for cheating, move to BannedUser DB, and remove from main User DB
router.post('/ban/:userId', adminMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const BannedUser = require('../models/BannedUser');

        // 1. Create a BannedUser record
        const bannedUser = new BannedUser({
            originalUserId: user._id.toString(),
            playerId: user.playerId,
            username: user.username,
            reason: 'Flagged for Cheating/TOS Violation by Admin'
        });
        await bannedUser.save();

        // 2. Nullify all their matches
        await Match.updateMany({ playerId: user._id }, {
            status: 'COMPLETED',
            kills: 0,
            blazePoints: 0,
            placement: 100
        });

        // 3. Delete from main User database
        await User.findByIdAndDelete(req.params.userId);

        res.json({ msg: 'User moved to banned database, deleted from main database, and stats nullified' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/users
// @desc    Get all users for admin panel
router.get('/users', adminMiddleware, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/registration/match-id/:matchId
// @desc    Get registration details (Match Intel) by numeric matchId
router.get('/registration/match-id/:matchId', adminMiddleware, async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const matchId = parseInt(req.params.matchId);
        if (isNaN(matchId)) return res.status(400).json({ msg: 'Invalid Match ID format' });

        const registration = await Registration.findOne({ matchId }).populate('userId', '-password');
        if (!registration) return res.status(404).json({ msg: 'Match Registration not found' });

        // Fetch team members full profile data using their playerId or _id
        let fullTeamDetails = [];
        
        // Add operator to team list if not already there
        if (registration.userId) {
            fullTeamDetails.push(registration.userId);
        }

        if (registration.teamMembers && registration.teamMembers.length > 0) {
            const teamUsers = await User.find({ 
                $or: [
                    { playerId: { $in: registration.teamMembers } },
                    { _id: { $in: registration.teamMembers.filter(id => mongoose.isValidObjectId(id)) } }
                ]
            }).select('-password');
            
            // Add them, avoiding duplicates with the operator
            teamUsers.forEach(tu => {
                if (!fullTeamDetails.find(u => u._id.toString() === tu._id.toString())) {
                    fullTeamDetails.push(tu);
                }
            });
        }

        res.json({
            registration,
            teamDetails: fullTeamDetails
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/user/player-id/:playerId
// @desc    Get user profile details by playerId or _id for Admin View
router.get('/user/player-id/:playerId', adminMiddleware, async (req, res) => {
    try {
        const queryParam = req.params.playerId;
        const mongoose = require('mongoose');
        
        let query = { playerId: queryParam };
        if (mongoose.isValidObjectId(queryParam)) {
            query = { $or: [{ playerId: queryParam }, { _id: queryParam }] };
        }

        const user = await User.findOne(query).select('-password');
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/banned-users
// @desc    Get all banned users for admin panel
router.get('/banned-users', adminMiddleware, async (req, res) => {
    try {
        const BannedUser = require('../models/BannedUser');
        const bannedUsers = await BannedUser.find().sort({ bannedAt: -1 });
        res.json(bannedUsers);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/users/:userId/verify
// @desc    Toggle Genuine Operator status for a user
router.put('/users/:userId/verify', adminMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.isGenuine = !user.isGenuine;

        if (user.isGenuine) {
            user.trustedPlayerClaimed = true;
            user.blazeCoins = (user.blazeCoins || 0) + 100;

            const agenda = require('../utils/queue');
            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: 'You are a Trusted Player!',
                message: 'Congratulations! You are now a trusted member of Blaze Frontier and 100 BlazeCoins have been added to your wallet. You now have access to Elite Tournaments!',
                type: 'success'
            });

            if (user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'Welcome to the Trusted Players Club! - Blaze Frontier',
                    html: `
                        <div style="font-family: sans-serif; color: #111;">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <img src="cid:trusted_member_banner" alt="Trusted Member Verified" style="max-width: 100%; border-radius: 12px; display: block; margin: 0 auto;">
                            </div>
                            <p>Congratulations <strong>${user.username}</strong>!</p>
                            <p>You have been verified as a Trusted Member of Blaze Frontier. We've added a special Golden Banner to your profile and awarded you 100 BlazeCoins!</p>
                            <p>You now have full access to our Elite Tournaments tab.</p>
                            <br/>
                            <p style="color: #ff4e00;">- The Blaze Frontier Team</p>
                        </div>
                    `,
                    attachments: [
                        {
                            filename: 'trusted_member.jpg',
                            path: require('path').join(__dirname, '../../public/trusted_member.jpg'),
                            cid: 'trusted_member_banner'
                        }
                    ]
                });
            }
        }

        await user.save();

        res.json({ msg: `User is now ${user.isGenuine ? 'verified' : 'unverified'}`, isGenuine: user.isGenuine });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/player-of-the-day
// @desc    Set the Player of the Day with a video clip
router.post('/player-of-the-day', adminMiddleware, upload.single('clip'), async (req, res) => {
    try {
        const { playerId, title, playerName } = req.body;
        if (!playerId || !title || !req.file) {
            return res.status(400).json({ msg: 'Please provide playerId, title, and a video clip.' });
        }

        const user = await User.findOne({ playerId });
        if (!user) {
            return res.status(404).json({ msg: 'User with this Blaze ID not found.' });
        }

        const PlayerOfTheDay = require('../models/PlayerOfTheDay');

        // Deactivate all previous
        await PlayerOfTheDay.updateMany({}, { isActive: false });

        const newPOTD = new PlayerOfTheDay({
            userId: user._id,
            playerName: playerName || user.inGameName || user.username,
            title: title,
            videoUrl: '/public/uploads/clips/' + req.file.filename,
            isActive: true
        });

        await newPOTD.save();
        res.json(newPOTD);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/clip-submissions
// @desc    Get all pending clip submissions
router.get('/clip-submissions', adminMiddleware, async (req, res) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const submissions = await ClipSubmission.find({ status: 'Pending' }).sort({ createdAt: -1 }).populate('userId', 'username inGameName');
        res.json(submissions);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/clip-submissions/:id/approve
// @desc    Approve a clip, make it public, and award 50 BlazeCoins
router.post('/clip-submissions/:id/approve', adminMiddleware, async (req, res) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const Clip = require('../models/Clip');

        const submission = await ClipSubmission.findById(req.params.id);
        if (!submission) return res.status(404).json({ msg: 'Submission not found' });

        submission.status = 'Approved';
        await submission.save();

        // Add to public clips
        const newClip = new Clip({
            title: submission.title,
            author: submission.playerId,
            game: submission.game,
            views: '0',
            thumbnail: '/public/clip-thumb.jpg', // Placeholder
            url: submission.videoUrl
        });
        await newClip.save();

        // Award 50 BlazeCoins
        const user = await User.findById(submission.userId);
        if (user) {
            user.blazeCoins = (user.blazeCoins || 0) + 50;
            await user.save();

            // Notify user via in-app
            const agenda = require('../utils/queue');
            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: 'Top Clip Approved!',
                message: `Your clip "${submission.title}" was selected as a Top Clip! You have been awarded 50 BlazeCoins.`,
                type: 'success'
            });

            // Notify user via email
            if (user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'Your Clip was Approved! - Blaze Frontier',
                    html: `
                        <div style="font-family: sans-serif; color: #111; padding: 20px;">
                            <h2 style="color: #ff4e00;">Congratulations!</h2>
                            <p>Your clip "<strong>${submission.title}</strong>" has been approved by Command and is now featured as a Top Clip!</p>
                            <p>You have been awarded <strong>50 BlazeCoins</strong>.</p>
                            <br/>
                            <p>- The Blaze Frontier Team</p>
                        </div>
                    `
                });
            }
        }

        res.json({ msg: 'Clip approved and user rewarded' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/clip-submissions/:id/reject
// @desc    Reject a clip
router.post('/clip-submissions/:id/reject', adminMiddleware, async (req, res) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const submission = await ClipSubmission.findById(req.params.id);
        if (!submission) return res.status(404).json({ msg: 'Submission not found' });

        submission.status = 'Rejected';
        await submission.save();

        const User = require('../models/User');
        const user = await User.findById(submission.userId);
        
        if (user) {
            const agenda = require('../utils/queue');
            
            // Notify user via in-app
            agenda.now('send-inapp-notification', {
                userId: user._id,
                title: 'Clip Submission Declined',
                message: `Your clip "${submission.title}" was not selected at this time. Keep trying!`,
                type: 'error'
            });

            // Notify user via email
            if (user.email) {
                agenda.now('send-email', {
                    email: user.email,
                    subject: 'Clip Submission Update - Blaze Frontier',
                    html: `
                        <div style="font-family: sans-serif; color: #111; padding: 20px;">
                            <h2 style="color: #ef4444;">Clip Submission Update</h2>
                            <p>Thank you for submitting your clip "<strong>${submission.title}</strong>".</p>
                            <p>Unfortunately, Command has reviewed it and it was not selected to be featured at this time.</p>
                            <p>Keep grinding and submit your best plays again soon!</p>
                            <br/>
                            <p>- The Blaze Frontier Team</p>
                        </div>
                    `
                });
            }
        }

        res.json({ msg: 'Clip rejected and user notified' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/daily-content
// @desc    Get current daily content
router.get('/daily-content', adminMiddleware, async (req, res) => {
    try {
        const DailyContent = require('../models/DailyContent');
        let content = await DailyContent.findOne();
        if (!content) {
            content = await DailyContent.create({});
        }
        res.json(content);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/admin/daily-content
// @desc    Update daily content links
router.post('/daily-content', adminMiddleware, async (req, res) => {
    try {
        const { youtubeLink, facebookLink, title } = req.body;
        const DailyContent = require('../models/DailyContent');
        let content = await DailyContent.findOne();

        if (content) {
            content.youtubeLink = youtubeLink || content.youtubeLink;
            content.facebookLink = facebookLink || content.facebookLink;
            content.title = title || content.title;
            content.updatedAt = Date.now();
            await content.save();
        } else {
            content = await DailyContent.create({ youtubeLink, facebookLink, title });
        }
        res.json({ msg: 'Daily Content updated successfully', content });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const organizerAuth = require('../middleware/organizerAuth');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const User = require('../models/User');

// All routes require organizer auth
router.use(organizerAuth);

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

// --- Organizer Clip Review Routes ---

// @route   GET /api/organizer/clip-submissions
// @desc    Get pending clip submissions for the current week
router.get('/clip-submissions', async (req, res) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const now = new Date();
        const currentDay = now.getDay();
        const diffToMonday = now.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
        const startOfWeek = new Date(now.setDate(diffToMonday));
        startOfWeek.setHours(0, 0, 0, 0);

        const clips = await ClipSubmission.find({
            createdAt: { $gte: startOfWeek },
            status: 'Pending'
        }).sort({ createdAt: -1 });

        res.json(clips);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/organizer/voting-event/create
// @desc    Create a new weekly voting event with 3 selected clips
router.post('/voting-event/create', async (req, res) => {
    try {
        const VotingEvent = require('../models/VotingEvent');
        const ClipSubmission = require('../models/ClipSubmission');
        const { title, game, clipIds } = req.body;

        if (!title || !game || !clipIds || clipIds.length !== 3) {
            return res.status(400).json({ msg: 'Please provide title, game, and exactly 3 clip IDs.' });
        }

        // Deactivate all current active events
        await VotingEvent.updateMany({ isActive: true }, { isActive: false });

        const newEvent = new VotingEvent({
            title,
            game,
            isActive: true, // Will still be constrained by day-of-week in GET /api/voting-event/active
            clips: clipIds
        });

        await newEvent.save();

        // Update clip statuses to 'approved' or 'featured'
        await ClipSubmission.updateMany(
            { _id: { $in: clipIds } },
            { $set: { status: 'approved' } }
        );

        // Send Email to the Top 3 selected users
        try {
            const selectedClips = await ClipSubmission.find({ _id: { $in: clipIds } }).populate('userId', 'email username');
            const sendEmail = require('../utils/sendEmail');
            
            selectedClips.forEach(clip => {
                if (clip.userId && clip.userId.email) {
                    sendEmail({
                        email: clip.userId.email,
                        subject: 'Congratulations! Your Clip is in the Top 3! 🏆',
                        html: `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #1a1a24; color: #fff; border-radius: 8px;">
                                <h2 style="color: #ff5722;">You made it to the Top 3!</h2>
                                <p style="font-size: 1.1rem;">Hi <strong>${clip.userId.username}</strong>,</p>
                                <p style="font-size: 1.1rem; line-height: 1.6;">Your recent clip for <strong>${game}</strong> has been selected by our organizers as one of the Top 3 clips of the week!</p>
                                <p style="font-size: 1.1rem; line-height: 1.6;">Voting is now open to the community. Head over to the platform to check it out!</p>
                                <p style="font-size: 1.1rem; color: #aaa;">Good luck,<br/>The Blaze Frontier Team</p>
                               </div>`
                    });
                }
            });
        } catch (e) {
            console.error('Email notification failed:', e.message);
        }

        // Notify Discord (Offline Notification)
        try {
            const { sendAnnouncement } = require('../discordBot');
            sendAnnouncement(`🔥 **IT'S VOTING TIME!** 🔥\n\nThe Top 3 ${game} clips of the week have been selected! Head over to the platform and vote for your favorite clip now. Who will be the Player of the Week?`);
        } catch (e) {
            console.error('Discord notification failed:', e.message);
        }

        // Notify Website (Live Notification)
        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('new_notification', {
                    title: 'It\'s Voting Time!',
                    message: `The Top 3 ${game} clips are ready. Go to the arena and cast your vote!`,
                    type: 'info'
                });
            }
        } catch (e) {
            console.error('Platform notification failed:', e.message);
        }

        res.json({ msg: 'Voting event created successfully', event: newEvent });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// @route   GET /api/organizer/me
// @desc    Get current organizer profile
router.get('/me', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            console.log(`[organizer/me] User not found after middleware for id: ${req.user.id}`);
            return res.status(404).send('User not found');
        }
        res.json(user);
    } catch (err) {
        console.error(`[organizer/me] Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/stats
// @desc    Get organizer dashboard stats
router.get('/stats', async (req, res) => {
    try {
        // Perform a quick lazy evaluation of all tournaments to keep stats accurate
        const allTourneys = await Tournament.find();
        let changed = false;
        for (let t of allTourneys) {
            const correctStatus = computeStatus(t.date);
            if (t.status !== correctStatus) {
                t.status = correctStatus;
                await t.save();
                changed = true;
            }
        }

        const totalTournaments = await Tournament.countDocuments();
        const activeTournaments = await Tournament.countDocuments({ status: 'ACTIVE' });
        const completedTournaments = await Tournament.countDocuments({ status: 'ENDED' });
        const totalRegistrations = await Registration.countDocuments();
        const pendingRegistrations = await Registration.countDocuments({ status: 'Pending' });
        const approvedRegistrations = await Registration.countDocuments({ status: 'Approved' });
        const totalPlayers = await User.countDocuments({ role: 'player' });

        res.json({
            totalTournaments,
            activeTournaments,
            completedTournaments,
            totalRegistrations,
            pendingRegistrations,
            approvedRegistrations,
            totalPlayers
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/tournaments
// @desc    List all tournaments
router.get('/tournaments', async (req, res) => {
    try {
        let tournaments = await Tournament.find().sort({ createdAt: -1 });
        
        // Lazy evaluation: Update statuses dynamically based on current time
        for (let t of tournaments) {
            const correctStatus = computeStatus(t.date);
            if (t.status !== correctStatus) {
                t.status = correctStatus;
                await t.save();
            }
        }
        
        res.json(tournaments);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/organizer/tournaments
// @desc    Create a new tournament
router.post('/tournaments', async (req, res) => {
    try {
        const { name, date, participants, roomId, roomPassword, registrationEndTime } = req.body;

        if (!name || !date || !participants) {
            return res.status(400).json({ msg: 'All required fields must be provided' });
        }

        const computedStatus = computeStatus(date);

        const tournament = new Tournament({
            name,
            status: computedStatus,
            date,
            participants,
            roomId,
            roomPassword,
            registrationEndTime: registrationEndTime ? new Date(registrationEndTime) : undefined
        });

        await tournament.save();
        
        if (tournament.registrationEndTime) {
            const agenda = require('../utils/queue');
            agenda.schedule(tournament.registrationEndTime, 'publish-tournament-list', { tournamentId: tournament._id });
        }

        res.json(tournament);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/organizer/tournaments/:id
// @desc    Update a tournament
router.put('/tournaments/:id', async (req, res) => {
    try {
        const { name, date, participants, roomId, roomPassword } = req.body;
        const updateFields = {};
        if (name) updateFields.name = name;
        if (participants) updateFields.participants = participants;
        if (roomId !== undefined) updateFields.roomId = roomId;
        if (roomPassword !== undefined) updateFields.roomPassword = roomPassword;
        
        if (date) {
            updateFields.date = date;
            updateFields.status = computeStatus(date);
        }

        const tournament = await Tournament.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true }
        );

        if (!tournament) {
            return res.status(404).json({ msg: 'Tournament not found' });
        }

        res.json(tournament);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/organizer/tournaments/:id
// @desc    Delete a tournament
router.delete('/tournaments/:id', async (req, res) => {
    try {
        const tournament = await Tournament.findByIdAndDelete(req.params.id);
        if (!tournament) {
            return res.status(404).json({ msg: 'Tournament not found' });
        }
        res.json({ msg: 'Tournament deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/organizer/tournaments/:id/award
// @desc    Award Top 3 for a tournament and update Leaderboard
router.post('/tournaments/:id/award', async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.status(404).json({ msg: 'Tournament not found' });
        
        if (tournament.status === 'ENDED') {
            return res.status(400).json({ msg: 'Tournament is already ended and awarded' });
        }

        const { winner1, winner2, winner3 } = req.body;
        if (!winner1 || !winner2 || !winner3) {
            return res.status(400).json({ msg: 'Please provide all Top 3 winners' });
        }

        // Make sure all 3 winners are unique
        if (new Set([winner1, winner2, winner3]).size !== 3) {
            return res.status(400).json({ msg: 'Winners must be unique players' });
        }

        const User = require('../models/User');
        const Match = require('../models/Match');

        const awards = [
            { userId: winner1, coins: 100, points: 100, rank: 1 },
            { userId: winner2, coins: 50, points: 50, rank: 2 },
            { userId: winner3, coins: 25, points: 25, rank: 3 }
        ];

        for (const award of awards) {
            const user = await User.findById(award.userId);
            if (user) {
                user.blazeCoins = (user.blazeCoins || 0) + award.coins;
                user.blazePoints = (user.blazePoints || 0) + award.points;
                user.tourneysWon = (user.tourneysWon || 0) + (award.rank === 1 ? 1 : 0);
                await user.save();

                // Create a Match record to sync with the Leaderboard aggregation automatically
                const newMatch = new Match({
                    tournamentId: tournament._id,
                    matchNumber: 1,
                    playerId: user._id,
                    team: 'Solo',
                    slot: award.rank.toString(),
                    format: 'Tournament',
                    mode: tournament.name,
                    kills: 0,
                    survivalTimeMinutes: 0,
                    placement: award.rank,
                    blazePoints: award.points,
                    isCompleted: true,
                    status: 'COMPLETED',
                    startTime: new Date()
                });
                await newMatch.save();
            }
        }

        tournament.status = 'ENDED';
        await tournament.save();

        res.json({ msg: 'Winners awarded and tournament ended successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/organizer/tournaments/:id/publish-list
// @desc    Publish the participant list for a tournament
router.post('/tournaments/:id/publish-list', async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.status(404).json({ msg: 'Tournament not found' });

        tournament.isListPublished = true;
        await tournament.save();

        res.json({ msg: 'Participant list published successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/registrations
// @desc    List all registrations with optional status filter
router.get('/registrations', async (req, res) => {
    try {
        const filter = { format: { $ne: 'Tournament' } };
        if (req.query.status) {
            filter.status = req.query.status;
        }
        
        const registrations = await Registration.find(filter)
            .populate('userId', 'username inGameName playerId email profilePic')
            .populate('tournamentId', 'name')
            .sort({ createdAt: -1 });
        
        res.json(registrations);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/tournaments/:id/registrations
// @desc    List all registrations for a specific tournament
router.get('/tournaments/:id/registrations', async (req, res) => {
    try {
        const filter = { tournamentId: req.params.id };
        if (req.query.status) {
            filter.status = req.query.status;
        }
        
        const registrations = await Registration.find(filter)
            .populate('userId', 'username inGameName gameUid playerId email profilePic')
            .populate('tournamentId', 'name')
            .sort({ createdAt: -1 });
        
        res.json(registrations);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/organizer/registrations/:id/completion
// @desc    Organizer marks a match as Completed or Missed
router.put('/registrations/:id/completion', async (req, res) => {
    try {
        const { outcome } = req.body;
        const Registration = require('../models/Registration');
        const User = require('../models/User');
        const agenda = require('../utils/queue');
        
        const reg = await Registration.findById(req.params.id).populate('userId', 'username inGameName email');
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        if (outcome === 'Completed') {
            reg.status = 'Completed';
            const reg = await Registration.findByIdAndUpdate(
                req.params.id,
                { $set: { status: 'Completed', isCompleted: true } },
                { new: true }
            );
            if (!reg) return res.status(404).json({ msg: 'Registration not found' });
            return res.json({ msg: 'Match marked as completed', reg });
        } else if (outcome === 'Missed') {
            const reg = await Registration.findByIdAndUpdate(
                req.params.id,
                { 
                    $set: { 
                        status: 'Missed',
                        resolutionCause: req.body.reason || 'Organizer Unavailable'
                    }
                },
                { new: true }
            ).populate('userId', 'username inGameName email');

            if (!reg) return res.status(404).json({ msg: 'Registration not found' });
            const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
            
            agenda.now('send-inapp-notification', {
                userId: reg.userId._id,
                title: 'Match Missed',
                message: `We're sorry, your ${formatMode} match time concluded without being played. Reason: ${reg.resolutionCause}. You can register again!`,
                type: 'error'
            });

            if (reg.userId && reg.userId.email) {
                agenda.now('send-email', {
                    email: reg.userId.email,
                    subject: 'Match Missed - Blaze Frontier',
                    html: `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                            <div style="padding: 30px; text-align: left;">
                                <h2 style="color: #ff4e00; margin-top: 0;">Match Missed</h2>
                                <p style="font-size: 1.1rem; color: #333;">Hello <strong>${reg.userId.inGameName || reg.userId.username}</strong>,</p>
                                <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">
                                    It appears your <strong>${formatMode}</strong> match was missed.
                                </p>
                                <div style="background-color: #ffe5e5; padding: 15px; border-left: 4px solid #ef4444; margin: 20px 0;">
                                    <p style="margin: 0; color: #cc0000;"><strong>Reason:</strong> ${reg.resolutionCause}</p>
                                </div>
                                <div style="background-color: #e5f0ff; padding: 15px; border-left: 4px solid #0056b3; margin: 20px 0;">
                                    <p style="margin: 0; color: #004085;"><strong>Fresh Start:</strong> Your previous registration has been moved to history without penalties. You are free to register for a new tournament slot immediately.</p>
                                </div>
                            </div>
                            <div style="background-color: #111; padding: 15px; text-align: center;">
                                <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- THE BLAZE FRONTIER COMMAND -</p>
                            </div>
                        </div>
                    `
                });
            }
            return res.json({ msg: 'Match marked as Missed. User notified.' });
        } else {
            return res.status(400).json({ msg: 'Invalid outcome' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/organizer/registrations/:id/approve
// @desc    Approve a registration and send email
router.put('/registrations/:id/approve', async (req, res) => {
    try {
        const registration = await Registration.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'Approved' } },
            { new: true }
        ).populate('userId', 'username inGameName playerId email');

        if (!registration) {
            return res.status(404).json({ msg: 'Registration not found' });
        }

        const formatMode = `${registration.format.toUpperCase()} ${registration.mode.toUpperCase()}`;
        const agenda = require('../utils/queue');

        // Notification
        agenda.now('send-inapp-notification', {
            userId: registration.userId._id,
            title: 'Registration Approved!',
            message: `Your registration for the ${formatMode} tournament on ${registration.startDate} has been Approved. Get ready for battle!`,
            type: 'success'
        });

        // Email
        if (registration.userId && registration.userId.email) {
            agenda.now('send-email', {
                email: registration.userId.email,
                subject: 'Tournament Registration Approved! - Blaze Frontier',
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                        <div style="text-align: center; background-color: #111; padding: 20px;">
                            <img src="cid:tournament_poster.png" alt="Tournament Poster" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                        </div>
                        <div style="padding: 30px; text-align: left;">
                            <h2 style="color: #ff4e00; margin-top: 0;">Tournament Registration Approved!</h2>
                            <p style="font-size: 1.1rem; color: #333;">Hello <strong>${registration.userId.inGameName || registration.userId.username}</strong>,</p>
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #333; margin-bottom: 25px;">
                                Your registration for the <strong>${formatMode}</strong> tournament on <strong>${registration.startDate}</strong> at <strong>${registration.timeSlot}</strong> has been officially confirmed by our organizers!
                            </p>
                            <p style="font-size: 1.1rem; color: #333;">Please ensure you and your team are ready at the designated time. Good luck on the battlefield!</p>
                        </div>
                        <div style="background-color: #111; padding: 15px; text-align: center;">
                            <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- THE BLAZE FRONTIER COMMAND -</p>
                        </div>
                    </div>
                `,
                attachments: [
                    {
                        filename: 'tournament_poster.png',
                        path: require('path').join(__dirname, '../../public/tournament_poster.png')
                    }
                ]
            });
        }

        res.json(registration);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/organizer/registrations/:id
// @desc    Completely delete a registration request with reason
router.delete('/registrations/:id', async (req, res) => {
    try {
        const reg = await Registration.findById(req.params.id).populate('userId', 'username inGameName email');
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });

        const userId = reg.userId._id;
        const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;
        const reason = req.body.reason || 'No reason provided by organizer.';

        // Soft Delete (Mark as Rejected)
        reg.status = 'Rejected';
        reg.resolutionCause = reason;
        await reg.save();

        const agenda = require('../utils/queue');

        agenda.now('send-inapp-notification', {
            userId: userId,
            title: 'Registration Rejected & Deleted',
            message: `Your ${formatMode} registration was declined. Reason: ${reason}.`,
            type: 'error'
        });

        if (reg.userId && reg.userId.email) {
            agenda.now('send-email', {
                email: reg.userId.email,
                subject: 'Registration Declined - Blaze Frontier',
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                        <div style="padding: 30px; text-align: left;">
                            <h2 style="color: #ef4444; margin-top: 0;">Registration Declined</h2>
                            <p style="font-size: 1.1rem; color: #333;">Hello <strong>${reg.userId.inGameName || reg.userId.username}</strong>,</p>
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">Your registration for the <strong>${formatMode}</strong> tournament on <strong>${reg.startDate}</strong> has been declined.</p>
                            <div style="background-color: #ffe5e5; padding: 15px; border-left: 4px solid #ef4444; margin: 20px 0;">
                                <p style="margin: 0; color: #cc0000;"><strong>Reason:</strong> ${reason}</p>
                            </div>
                            <p style="font-size: 1.1rem; color: #333;">You may submit a new registration after fixing the issue.</p>
                        </div>
                        <div style="background-color: #111; padding: 15px; text-align: center;">
                            <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- THE BLAZE FRONTIER COMMAND -</p>
                        </div>
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

// @route   PUT /api/organizer/registrations/:id/credentials
// @desc    Dispatch Room ID & Password to an approved squad
router.put('/registrations/:id/credentials', async (req, res) => {
    try {
        const { roomId, roomPassword } = req.body;
        if (!roomId || !roomPassword) {
            return res.status(400).json({ msg: 'Please provide both Room ID and Password.' });
        }

        const reg = await Registration.findById(req.params.id).populate('userId', 'username inGameName email');
        if (!reg) return res.status(404).json({ msg: 'Registration not found' });
        if (reg.status !== 'Approved') return res.status(400).json({ msg: 'Registration must be approved before dispatching credentials.' });

        reg.roomId = roomId;
        reg.roomPassword = roomPassword;
        await reg.save();

        const agenda = require('../utils/queue');
        const formatMode = `${reg.format.toUpperCase()} ${reg.mode.toUpperCase()}`;

        agenda.now('send-inapp-notification', {
            userId: reg.userId._id,
            title: 'Tournament Credentials Arrived',
            message: `Room ID: ${roomId} | Password: ${roomPassword} for your ${formatMode} match.`,
            type: 'info'
        });

        if (reg.userId && reg.userId.email) {
            agenda.now('send-email', {
                email: reg.userId.email,
                subject: 'Tournament Match Credentials - Blaze Frontier',
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #111; border: 1px solid #333; border-radius: 8px; overflow: hidden; color: #fff;">
                        <div style="text-align: center; border-bottom: 1px solid #333; padding: 20px;">
                            <h2 style="color: #ff4e00; margin: 0; font-size: 1.8rem; letter-spacing: 1px;">MATCH CREDENTIALS</h2>
                        </div>
                        <div style="padding: 30px;">
                            <p style="font-size: 1.1rem; color: #ccc;">Operator <strong>${reg.userId.inGameName || reg.userId.username}</strong>,</p>
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #aaa; margin-bottom: 25px;">
                                Your room details for the <strong>${formatMode}</strong> tournament on <strong>${reg.startDate}</strong> have been generated by the organizer.
                            </p>
                            
                            <div style="background-color: #1a1a24; border: 1px solid #ff4e00; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 25px;">
                                <div style="margin-bottom: 15px;">
                                    <span style="color: #888; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Room ID</span>
                                    <div style="font-size: 1.8rem; font-weight: bold; color: #fff; font-family: monospace; letter-spacing: 2px;">${roomId}</div>
                                </div>
                                <div>
                                    <span style="color: #888; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Password</span>
                                    <div style="font-size: 1.8rem; font-weight: bold; color: #ff4e00; font-family: monospace; letter-spacing: 2px;">${roomPassword}</div>
                                </div>
                            </div>
                            
                            <p style="font-size: 1rem; color: #888; text-align: center;">Do not share these credentials outside of your authorized squad.</p>
                        </div>
                        <div style="background-color: #0a0a0f; padding: 15px; text-align: center; border-top: 1px solid #222;">
                            <p style="color: #ff4e00; font-size: 0.9rem; font-weight: bold; letter-spacing: 1px; margin: 0;">- THE BLAZE FRONTIER COMMAND -</p>
                        </div>
                    </div>
                `
            });
        }

        res.json({ msg: 'Credentials dispatched successfully', reg });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/daily-content
// @desc    Get current daily content
router.get('/daily-content', async (req, res) => {
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

// @route   POST /api/organizer/daily-content
// @desc    Update daily content links
router.post('/daily-content', async (req, res) => {
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

// @route   GET /api/organizer/slot-report
// @desc    Get slots booked per day for the next 7 days
router.get('/slot-report', async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const dates = [];
        const result = [];
        
        // Generate next 7 days in YYYY-MM-DD
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dates.push(`${yyyy}-${mm}-${dd}`);
        }

        for (const dateStr of dates) {
            const regs = await Registration.find({ startDate: dateStr, status: { $in: ['Pending', 'Approved'] } })
                .populate('userId', 'username inGameName playerId email')
                .lean();
            const uniqueSlots = new Set(regs.map(r => r.timeSlot).filter(Boolean));
            result.push({ 
                date: dateStr, 
                count: uniqueSlots.size,
                details: regs.map(r => ({
                    timeSlot: r.timeSlot,
                    mode: r.mode,
                    format: r.format,
                    status: r.status,
                    playerName: r.userId ? (r.userId.inGameName || r.userId.username) : 'Unknown',
                    playerId: r.userId ? r.userId.playerId : 'N/A',
                    discord: r.discord
                }))
            });
        }

        res.json(result);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Player of the Day ---
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const potdStorage = multer.diskStorage({
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
const potdUpload = multer({
    storage: potdStorage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// @route   GET /api/organizer/potd-current
// @desc    Get the current active Player of the Day
router.get('/potd-current', async (req, res) => {
    try {
        const PlayerOfTheDay = require('../models/PlayerOfTheDay');
        const potd = await PlayerOfTheDay.findOne({ isActive: true }).populate('userId', 'inGameName username playerId').lean();
        if (!potd) return res.json(null);
        res.json({
            playerName: potd.playerName || (potd.userId && (potd.userId.inGameName || potd.userId.username)) || 'Unknown',
            title: potd.title,
            createdAt: potd.createdAt,
            videoUrl: potd.videoUrl
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/organizer/potd
// @desc    Set Player of the Day (same as admin, backup for organizers)
router.post('/potd', potdUpload.single('video'), async (req, res) => {
    try {
        const PlayerOfTheDay = require('../models/PlayerOfTheDay');
        const { playerId, title, playerName } = req.body;

        if (!playerId) {
            return res.status(400).json({ msg: 'Blaze ID is required' });
        }
        if (!req.file) {
            return res.status(400).json({ msg: 'Video file is required' });
        }

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

        // Invalidate Hub caches
        global.graphqlStatsCache = null;
        if (global.clearApiStatsCache) {
            global.clearApiStatsCache();
        }

        res.json({ msg: 'Player of the Day updated successfully!', potd: newPotd });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/users
// @desc    List all users (players) with optional search
router.get('/users', async (req, res) => {
    try {
        const search = req.query.search;
        let filter = { role: 'player' };

        if (search && search.trim()) {
            const q = search.trim();
            filter.$or = [
                { username: new RegExp(q, 'i') },
                { inGameName: new RegExp(q, 'i') },
                { playerId: new RegExp(q, 'i') },
                { email: new RegExp(q, 'i') }
            ];
        }

        const users = await User.find(filter)
            .select('username inGameName playerId email isGenuine blazeCoins location createdAt')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

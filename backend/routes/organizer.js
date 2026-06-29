const express = require('express');
const router = express.Router();
const organizerAuth = require('../middleware/organizerAuth');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const User = require('../models/User');

// All routes require organizer auth
router.use(organizerAuth);

// @route   GET /api/organizer/me
// @desc    Get current organizer profile
router.get('/me', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/organizer/stats
// @desc    Get organizer dashboard stats
router.get('/stats', async (req, res) => {
    try {
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
        const tournaments = await Tournament.find().sort({ createdAt: -1 });
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
        const { name, status, date, participants } = req.body;

        if (!name || !status || !date || !participants) {
            return res.status(400).json({ msg: 'All required fields must be provided' });
        }

        const tournament = new Tournament({
            name,
            status,
            date,
            participants
        });

        await tournament.save();
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
        const { name, status, date, participants } = req.body;
        const updateFields = {};
        if (name) updateFields.name = name;
        if (status) updateFields.status = status;
        if (date) updateFields.date = date;
        if (participants) updateFields.participants = participants;

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

// @route   GET /api/organizer/registrations
// @desc    List all registrations with optional status filter
router.get('/registrations', async (req, res) => {
    try {
        const filter = {};
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
            .populate('userId', 'username inGameName playerId email profilePic')
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

module.exports = router;

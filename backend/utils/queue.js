const Agenda = require('agenda');
const mongoose = require('mongoose');

const agenda = new Agenda({
    db: { address: process.env.MONGO_URI, collection: 'agendaJobs' },
    processEvery: '10 seconds'
});

// Define Job: Send In-App Notification
agenda.define('send-inapp-notification', async (job) => {
    const { userId, title, message, type } = job.attrs.data;
    const Notification = require('../models/Notification');
    
    try {
        await Notification.create({
            userId,
            title,
            message,
            type: type || 'info'
        });
        // console.log(`[Queue] In-app notification created for User ${userId}: ${title}`);
    } catch (err) {
        console.error(`[Queue Error] Failed to create notification: ${err.message}`);
        throw err;
    }
});

// Define Job: Send Email
agenda.define('send-email', async (job) => {
    const { email, subject, html, attachments } = job.attrs.data;
    const sendEmail = require('./sendEmail');
    
    try {
        await sendEmail({ email, subject, html, attachments });
        console.log(`[Queue] Email successfully sent to ${email}: ${subject}`);
    } catch (err) {
        console.error(`[Queue Error] Failed to send email to ${email}: ${err.message}`);
        throw err;
    }
});

// Define Job: Resolve Weekly Voting Event
agenda.define('resolve-weekly-voting', async (job) => {
    try {
        const VotingEvent = require('../models/VotingEvent');
        const Vote = require('../models/Vote');
        const User = require('../models/User');

        const event = await VotingEvent.findOne({ isActive: true }).populate('clips');
        if (!event) {
            console.log(`[Queue] No active voting event to resolve.`);
            return;
        }

        console.log(`[Queue] Resolving Weekly Voting Event: ${event.title}`);
        
        // Mark event as inactive
        event.isActive = false;
        await event.save();

        // Calculate vote counts
        const votes = await Vote.aggregate([
            { $match: { eventId: event._id } },
            { $group: { _id: '$clipId', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        if (votes.length > 0) {
            // Reward distribution (1st: 50, 2nd: 25, 3rd: 10)
            const rewards = [50, 25, 10];
            
            for (let i = 0; i < Math.min(votes.length, 3); i++) {
                const clip = event.clips.find(c => c._id.toString() === votes[i]._id.toString());
                if (clip) {
                    await User.findByIdAndUpdate(clip.userId, {
                        $inc: { 'wallet.balance': rewards[i] }
                    });
                    
                    // Create notification
                    const Notification = require('../models/Notification');
                    await Notification.create({
                        userId: clip.userId,
                        title: 'Weekly Voting Reward!',
                        message: `Congratulations! Your clip won #${i + 1} place in the weekly voting event. You've earned ${rewards[i]} BlazeCoins!`,
                        type: 'info'
                    });
                }
            }
        }
        console.log(`[Queue] Weekly Voting Event resolved successfully.`);
    } catch (err) {
        console.error(`[Queue Error] Failed to resolve voting event: ${err.message}`);
        throw err;
    }
});

// Define Job: Publish Tournament List
agenda.define('publish-tournament-list', async (job) => {
    const { tournamentId } = job.attrs.data;
    try {
        const Tournament = require('../models/Tournament');
        const User = require('../models/User');
        const Notification = require('../models/Notification');
        const PushSubscription = require('../models/PushSubscription');
        const webpush = require('web-push');
        const sendEmail = require('./sendEmail');

        const tournament = await Tournament.findById(tournamentId);
        if (tournament) {
            tournament.isListPublished = true;
            await tournament.save();
            console.log(`[Queue] Tournament list published automatically for ${tournament.name}`);

            // Notify all organizers
            const organizers = await User.find({ role: 'organizer' });
            for (const org of organizers) {
                const title = 'Tournament Registration Ended';
                const message = `The registration time for "${tournament.name}" has ended. The player list is ready. Please prepare and dispatch the room credentials.`;

                // 1. In-App Notification
                await Notification.create({
                    userId: org._id,
                    title,
                    message,
                    type: 'info'
                });

                // 2. Offline / Web-Push Notification
                const subscriptions = await PushSubscription.find({ userId: org._id });
                if (subscriptions.length > 0) {
                    const payload = JSON.stringify({ title, body: message });
                    subscriptions.forEach(sub => {
                        webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload).catch(err => {
                            if (err.statusCode === 404 || err.statusCode === 410) {
                                PushSubscription.deleteOne({ endpoint: sub.endpoint }).exec();
                            }
                        });
                    });
                }

                // 3. Email Notification
                if (org.email) {
                    try {
                        const emailHtml = `
                            <div style="font-family: Arial, sans-serif; background-color: #1a1a1f; color: #fff; padding: 20px; border-radius: 8px;">
                                <h2 style="color: #ff3c1e;">Registration Ended!</h2>
                                <p>Hello ${org.username || 'Organizer'},</p>
                                <p>The registration period for the tournament <strong>${tournament.name}</strong> has just ended.</p>
                                <p>The final participant list is now automatically published and ready.</p>
                                <p style="color: #ff3c1e; font-weight: bold;">Please log in to the Organizer Dashboard and prepare to dispatch the match room credentials to the verified participants.</p>
                                <br/>
                                <p>Best regards,<br/>Blaze Frontier System</p>
                            </div>
                        `;
                        await sendEmail({
                            email: org.email,
                            subject: `[Reminder] Registration Ended for ${tournament.name}`,
                            html: emailHtml
                        });
                    } catch (emailErr) {
                        console.error(`[Queue Error] Failed to send email to ${org.email}: ${emailErr.message}`);
                    }
                }
            }

            // Notify all registered participants
            const Registration = require('../models/Registration');
            const registrations = await Registration.find({
                tournamentId: tournament._id,
                status: { $nin: ['Missed', 'Rejected'] }
            });
            
            for (const reg of registrations) {
                await Notification.create({
                    userId: reg.userId,
                    title: 'Participant List Ready',
                    message: `The registration for "${tournament.name}" is now closed and the final player list has been generated! Check the tournament page for updates.`,
                    type: 'info'
                });
            }
        }
    } catch (err) {
        console.error(`[Queue Error] Failed to publish tournament list: ${err.message}`);
        throw err;
    }
});

// Define Job: Clean Up Weekly Clips (Deletes from DB and filesystem)
agenda.define('cleanup-weekly-clips', async (job) => {
    try {
        const ClipSubmission = require('../models/ClipSubmission');
        const fs = require('fs');
        const path = require('path');

        const clips = await ClipSubmission.find({});
        let deletedFiles = 0;

        for (const clip of clips) {
            if (clip.videoUrl) {
                // videoUrl is in format "/public/uploads/user_clips/filename.mp4"
                const filename = clip.videoUrl.split('/').pop();
                const filepath = path.join(__dirname, '../../public/uploads/user_clips', filename);
                
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                    deletedFiles++;
                }
            }
        }

        const deleteResult = await ClipSubmission.deleteMany({});
        console.log(`[Queue] Weekly Cleanup Complete: Deleted ${deleteResult.deletedCount} clip records and ${deletedFiles} video files from server.`);
    } catch (err) {
        console.error(`[Queue Error] Failed to cleanup weekly clips: ${err.message}`);
        throw err;
    }
});

// Define Job: Notify Organizers 30 mins before slot
agenda.define('check-upcoming-slots', async (job) => {
    try {
        const Registration = require('../models/Registration');
        const Tournament = require('../models/Tournament');
        const User = require('../models/User');
        const Notification = require('../models/Notification');
        const PushSubscription = require('../models/PushSubscription');
        const webpush = require('web-push');
        const sendEmail = require('./sendEmail');

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        let notifyOrganizers = false;

        // 1. Check Registrations (Qualification Series)
        const upcomingRegs = await Registration.find({
            status: 'Approved',
            organizerNotified: false,
            startDate: todayStr
        });

        for (const reg of upcomingRegs) {
            if (!reg.timeSlot) continue;
            // e.g. "9:00 AM - 10:00 AM" -> "9:00 AM"
            const match = reg.timeSlot.match(/^(\d+):(\d+)\s*(AM|PM)/i);
            if (match) {
                let hour = parseInt(match[1]);
                const minute = parseInt(match[2]);
                const ampm = match[3].toUpperCase();
                if (ampm === 'PM' && hour < 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;

                const slotTime = new Date();
                slotTime.setHours(hour, minute, 0, 0);

                const diffMs = slotTime - new Date();
                const diffMins = diffMs / 60000;

                // If the slot starts in 30 mins or less (but not in the past)
                if (diffMins > 0 && diffMins <= 30) {
                    notifyOrganizers = true;
                    reg.organizerNotified = true;
                    await reg.save();
                }
            }
        }

        // 2. Check Tournaments (League Matches)
        const upcomingTournaments = await Tournament.find({
            status: { $ne: 'ENDED' },
            organizerNotified: false
        });

        for (const t of upcomingTournaments) {
            const tDate = new Date(t.date);
            if (!isNaN(tDate.getTime())) {
                const diffMs = tDate.getTime() - Date.now();
                const diffMins = diffMs / 60000;
                
                if (diffMins > 0 && diffMins <= 30) {
                    notifyOrganizers = true;
                    t.organizerNotified = true;
                    await t.save();
                }
            }
        }

        // 3. Send Notifications if needed
        if (notifyOrganizers) {
            const organizers = await User.find({ role: 'organizer' });
            for (const org of organizers) {
                await Notification.create({
                    userId: org._id,
                    title: 'Upcoming Match Alert',
                    message: 'A booked match/slot starts in 30 minutes! Please prepare to send credentials.',
                    type: 'warning'
                });

                const subscriptions = await PushSubscription.find({ userId: org._id });
                const payload = JSON.stringify({
                    title: 'Upcoming Match Alert',
                    body: 'A booked match/slot starts in 30 minutes! Please prepare to send credentials.'
                });
                subscriptions.forEach(sub => {
                    webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload).catch(err => {
                        if (err.statusCode === 404 || err.statusCode === 410) {
                            PushSubscription.deleteOne({ endpoint: sub.endpoint }).exec();
                        }
                    });
                });

                if (org.email) {
                    await sendEmail({
                        email: org.email,
                        subject: 'ACTION REQUIRED: Upcoming Match in 30 Minutes',
                        html: `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #1a1a24; color: #fff; border-radius: 8px;">
                                <h2 style="color: #ff5722;">Upcoming Match Alert</h2>
                                <p style="font-size: 1.1rem;">Hello Organizer <strong>${org.username}</strong>,</p>
                                <p style="font-size: 1.1rem; line-height: 1.6;">A booked Qualification Series slot or League Match is scheduled to begin in approximately <strong>30 minutes</strong>.</p>
                                <p style="font-size: 1.1rem; line-height: 1.6;">Please log in to the Organizer Dashboard and distribute the Room Credentials (ID and Password) to the participants immediately.</p>
                                <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard/organizer" style="display: inline-block; padding: 12px 24px; background: #ff5722; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px;">Go to Dashboard</a>
                                <p style="font-size: 1.1rem; color: #aaa; margin-top: 30px;">The Blaze Frontier System</p>
                               </div>`
                    });
                }
            }
        }
    } catch (err) {
        console.error(`[Queue Error] Failed to check upcoming slots: ${err.message}`);
    }
});

// Define Job: Check for tournaments that passed registrationEndTime and publish list
agenda.define('check-registration-ends', async (job) => {
    try {
        const Tournament = require('../models/Tournament');
        const now = new Date();
        const pendingTournaments = await Tournament.find({
            isListPublished: false,
            registrationEndTime: { $lte: now },
            status: { $ne: 'ENDED' }
        });
        
        for (const t of pendingTournaments) {
            console.log(`[Queue] Auto-publishing list for tournament: ${t.name}`);
            await agenda.now('publish-tournament-list', { tournamentId: t._id });
        }
    } catch (err) {
        console.error(`[Queue Error] Failed to check registration ends: ${err.message}`);
    }
});

module.exports = agenda;

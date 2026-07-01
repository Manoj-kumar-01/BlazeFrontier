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
        const User = require('../models/User');
        const Notification = require('../models/Notification');
        const PushSubscription = require('../models/PushSubscription');
        const webpush = require('web-push');

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const upcomingRegs = await Registration.find({
            status: 'Approved',
            organizerNotified: false,
            startDate: todayStr
        });

        if (upcomingRegs.length === 0) return;

        let notifyOrganizers = false;

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

        if (notifyOrganizers) {
            const organizers = await User.find({ role: 'organizer' });
            for (const org of organizers) {
                await Notification.create({
                    userId: org._id,
                    title: 'Upcoming Slot Alert',
                    message: 'A booked slot starts in 30 minutes! Please prepare to send credentials.',
                    type: 'warning'
                });

                const subscriptions = await PushSubscription.find({ userId: org._id });
                const payload = JSON.stringify({
                    title: 'Upcoming Slot Alert',
                    body: 'A booked slot starts in 30 minutes! Please prepare to send credentials.'
                });
                subscriptions.forEach(sub => {
                    webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload).catch(err => {
                        if (err.statusCode === 404 || err.statusCode === 410) {
                            PushSubscription.deleteOne({ endpoint: sub.endpoint }).exec();
                        }
                    });
                });
            }
        }
    } catch (err) {
        console.error(`[Queue Error] Failed to check upcoming slots: ${err.message}`);
    }
});

module.exports = agenda;

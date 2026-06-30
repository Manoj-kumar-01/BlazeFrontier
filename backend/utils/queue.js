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

module.exports = agenda;

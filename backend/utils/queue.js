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
        console.log(`[Queue] In-app notification created for User ${userId}: ${title}`);
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

module.exports = agenda;

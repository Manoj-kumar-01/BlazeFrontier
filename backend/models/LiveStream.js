const mongoose = require('mongoose');

const LiveStreamSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    game: {
        type: String,
        required: true,
        default: 'Free Fire'
    },
    platform: {
        type: String,
        enum: ['YouTube', 'Facebook', 'Twitch', 'Other'],
        default: 'YouTube'
    },
    streamUrl: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['LIVE', 'ENDED', 'SCHEDULED'],
        default: 'LIVE'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('LiveStream', LiveStreamSchema);

const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    game: {
        type: String,
        default: 'Free Fire'
    },
    prize: {
        type: String,
        default: 'Player of the Day & Get Noticed'
    },
    status: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    participants: {
        type: String,
        required: true
    },
    isListPublished: {
        type: Boolean,
        default: false
    },
    registrationEndTime: {
        type: Date
    },
    roomId: {
        type: String,
        default: ''
    },
    roomPassword: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

TournamentSchema.index({ status: 1 });
TournamentSchema.index({ game: 1 });

module.exports = mongoose.model('Tournament', TournamentSchema);

const mongoose = require('mongoose');

const BannedUserSchema = new mongoose.Schema({
    originalUserId: {
        type: String,
        required: true
    },
    playerId: {
        type: String,
        default: 'UNKNOWN'
    },
    username: {
        type: String,
        required: true
    },
    bannedAt: {
        type: Date,
        default: Date.now
    },
    reason: {
        type: String,
        default: 'Flagged for Cheating/TOS Violation by Admin'
    }
});

module.exports = mongoose.model('BannedUser', BannedUserSchema);

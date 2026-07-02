const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
    seriesId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Series'
    },
    tournamentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tournament'
    },
    matchNumber: {
        type: Number,
        required: true
    },
    playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    team: {
        type: String,
        required: true
    },
    slot: {
        type: String,
        required: true
    },
    format: {
        type: String,
        default: 'squad'
    },
    mode: {
        type: String,
        default: 'br'
    },
    kills: {
        type: Number,
        default: 0
    },
    survivalTimeMinutes: {
        type: Number,
        default: 0
    },
    placement: {
        type: Number,
        default: 0
    },
    blazePoints: {
        type: Number,
        default: 0
    },
    isCompleted: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['SCHEDULED', 'LIVE', 'CALCULATING', 'COMPLETED'],
        default: 'SCHEDULED'
    },
    startTime: {
        type: Date
    }
});

MatchSchema.index({ status: 1 });
MatchSchema.index({ playerId: 1 });

module.exports = mongoose.model('Match', MatchSchema);

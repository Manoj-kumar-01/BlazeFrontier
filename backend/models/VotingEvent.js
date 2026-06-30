const mongoose = require('mongoose');
require('./ClipSubmission'); // Register schema for populate
const VotingEventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    game: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    clips: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClipSubmission' }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VotingEvent', VotingEventSchema);

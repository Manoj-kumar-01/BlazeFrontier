const mongoose = require('mongoose');

const VoteSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'VotingEvent', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clipId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClipSubmission', required: true },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// A user can only vote once per event
VoteSchema.index({ eventId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Vote', VoteSchema);

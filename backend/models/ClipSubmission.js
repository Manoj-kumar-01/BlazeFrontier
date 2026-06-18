const mongoose = require('mongoose');

const ClipSubmissionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    playerId: { type: String, required: true },
    game: { type: String, required: true },
    title: { type: String, required: true },
    videoUrl: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClipSubmission', ClipSubmissionSchema);

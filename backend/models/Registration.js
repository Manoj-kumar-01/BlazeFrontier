const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
    format: { type: String, required: true },
    mode: { type: String, required: true },
    skills: { type: String, default: 'on' },
    discord: { type: String, required: true },
    startDate: { type: String, required: true },
    timeSlot: { type: String, required: true },
    teamMembers: [{ type: String }], // Array of playerIds
    matchId: { type: Number },
    roomId: { type: String, default: null },
    roomPassword: { type: String, default: null },
    status: { type: String, default: 'Pending' },
    playerFeedback: { type: String, enum: ['Pending', 'Completed', 'Not Completed'], default: 'Pending' },
    isCompleted: { type: Boolean, default: false },
    resolutionCause: { type: String, default: null },
    organizerNotified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

RegistrationSchema.index({ status: 1 });
RegistrationSchema.index({ userId: 1 });

module.exports = mongoose.model('Registration', RegistrationSchema);

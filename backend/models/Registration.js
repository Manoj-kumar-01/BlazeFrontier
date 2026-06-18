const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    format: { type: String, required: true },
    mode: { type: String, required: true },
    skills: { type: String, default: 'on' },
    discord: { type: String, required: true },
    startDate: { type: String, required: true },
    timeSlot: { type: String, required: true },
    teamMembers: [{ type: String }], // Array of playerIds
    matchId: { type: Number },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

RegistrationSchema.index({ status: 1 });
RegistrationSchema.index({ userId: 1 });

module.exports = mongoose.model('Registration', RegistrationSchema);

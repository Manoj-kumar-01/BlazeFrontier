const mongoose = require('mongoose');

const WeeklyChallengeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    game: { type: String, default: 'freefire' },
    rewardCoins: { type: Number, default: 100 },
    rewardPoints: { type: Number, default: 20 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WeeklyChallenge', WeeklyChallengeSchema);

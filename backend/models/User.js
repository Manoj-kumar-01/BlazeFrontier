const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    playerId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    email: {
        type: String,
        unique: true,
        sparse: true
    },
    tourneysWon: {
        type: Number,
        default: 0
    },
    // Onboarding Fields
    location: {
        type: String,
        default: null
    },
    gameUid: {
        type: String,
        default: null
    },
    inGameName: {
        type: String,
        default: null
    },
    profilePic: {
        type: String,
        default: '/public/blaze_avatar.png'
    },
    isSetupComplete: {
        type: Boolean,
        default: false
    },
    // Role
    role: {
        type: String,
        enum: ['player', 'organizer'],
        default: 'player'
    },
    // Admin Fields
    isAdmin: {
        type: Boolean,
        default: false
    },
    isBanned: {
        type: Boolean,
        default: false
    },
    // Rewards & Earn Fields
    blazeCoins: {
        type: Number,
        default: 0
    },
    blazePoints: {
        type: Number,
        default: 0
    },
    firstLoginClaimed: {
        type: Boolean,
        default: false
    },
    lastLoginClaimDate: {
        type: Date,
        default: null
    },
    trustedPlayerClaimed: {
        type: Boolean,
        default: false
    },
    isGenuine: {
        type: Boolean,
        default: false
    },
    hasCompletedTwoSeries: {
        type: Boolean,
        default: false
    },
    matchmakingBlockedUntil: {
        type: Date,
        default: null
    },
    matchmakingDailyCount: {
        type: Number,
        default: 0
    },
    matchmakingLastReset: {
        type: Date,
        default: Date.now
    },
    activityLog: {
        type: Map,
        of: Number,
        default: {}
    },
    currentStreak: {
        type: Number,
        default: 0
    },
    lastStreakUpdate: {
        type: Date,
        default: null
    },
    directives: {
        squadDeployment: { completed: { type: Boolean, default: false }, claimed: { type: Boolean, default: false } },
        firstBlood: { completed: { type: Boolean, default: false }, claimed: { type: Boolean, default: false } },
        highCommandVoter: { completed: { type: Boolean, default: false }, claimed: { type: Boolean, default: false } },
        lastReset: { type: Date, default: Date.now }
    },
    sessionToken: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

UserSchema.index({ isGenuine: 1 });
UserSchema.index({ blazeCoins: -1 });

module.exports = mongoose.model('User', UserSchema);

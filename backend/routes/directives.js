const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Constants for rewards
const REWARDS = {
    squadDeployment: 30,
    firstBlood: 15,
    highCommandVoter: 20
};

// Check if directives need a daily reset (midnight UTC)
const checkDailyReset = async (user) => {
    if (!user.directives) {
        user.directives = {
            squadDeployment: { completed: false, claimed: false },
            firstBlood: { completed: false, claimed: false },
            highCommandVoter: { completed: false, claimed: false },
            lastReset: new Date()
        };
        await user.save();
        return;
    }

    const lastReset = user.directives.lastReset;
    const now = new Date();
    
    // Reset if it's a new day
    if (!lastReset || lastReset.getDate() !== now.getDate() || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
        user.directives.squadDeployment = { completed: false, claimed: false };
        user.directives.firstBlood = { completed: false, claimed: false };
        user.directives.highCommandVoter = { completed: false, claimed: false };
        user.directives.lastReset = now;
        await user.save();
    }
};

// @route   GET /api/directives/status
// @desc    Get current status of tactical directives
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        await checkDailyReset(user);
        
        res.json({
            directives: user.directives,
            rewards: REWARDS
        });
    } catch (err) {
        console.error('Error fetching directives:', err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/directives/claim/:id
// @desc    Claim reward for a completed directive
router.post('/claim/:id', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        await checkDailyReset(user);
        
        const directiveId = req.params.id;
        
        if (!REWARDS[directiveId]) {
            return res.status(400).json({ msg: 'Invalid directive ID' });
        }
        
        const dirState = user.directives[directiveId];
        
        if (!dirState.completed) {
            return res.status(400).json({ msg: 'Directive not completed yet' });
        }
        
        if (dirState.claimed) {
            return res.status(400).json({ msg: 'Reward already claimed today' });
        }
        
        // Claim reward
        user.directives[directiveId].claimed = true;
        user.blazeCoins += REWARDS[directiveId];
        await user.save();
        
        res.json({ 
            msg: `Successfully claimed ${REWARDS[directiveId]} BlazeCoins!`,
            newBalance: user.blazeCoins
        });
        
    } catch (err) {
        console.error('Error claiming directive:', err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

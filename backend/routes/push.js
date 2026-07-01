const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const authMiddleware = require('../middleware/auth');

// Configure web-push
webpush.setVapidDetails(
    'mailto:support@blazefrontier.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// @route   GET /api/push/public-key
// @desc    Get VAPID public key
router.get('/public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// @route   POST /api/push/subscribe
// @desc    Subscribe to push notifications
router.post('/subscribe', authMiddleware, async (req, res) => {
    try {
        const subscription = req.body;
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ msg: 'Invalid subscription' });
        }

        // Check if subscription already exists
        let existingSub = await PushSubscription.findOne({ endpoint: subscription.endpoint });
        
        if (existingSub) {
            // Update user ID if it changed
            existingSub.userId = req.user.id;
            await existingSub.save();
        } else {
            // Create new subscription
            const newSub = new PushSubscription({
                userId: req.user.id,
                endpoint: subscription.endpoint,
                keys: subscription.keys
            });
            await newSub.save();
        }

        res.status(201).json({ msg: 'Subscribed successfully' });
    } catch (err) {
        console.error('Error saving push subscription:', err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/push/unsubscribe
// @desc    Unsubscribe from push notifications
router.post('/unsubscribe', authMiddleware, async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ msg: 'Endpoint required' });
        }

        await PushSubscription.findOneAndDelete({ endpoint, userId: req.user.id });
        res.json({ msg: 'Unsubscribed successfully' });
    } catch (err) {
        console.error('Error removing push subscription:', err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

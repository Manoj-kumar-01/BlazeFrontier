const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

// Helper to generate unique Player ID
const generatePlayerId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'BLZ-';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
};

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy_client_id_for_startup');

// @route   POST /api/auth/google
// @desc    Authenticate with Google Identity Services
router.post('/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ msg: 'No credential provided' });
        }

        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id_for_startup',
        });
        const payload = ticket.getPayload();
        
        const { email, name, sub: googleId } = payload;

        // Check if user is banned (optional: based on email or googleId, but previously we only checked username)
        const BannedUser = require('../models/BannedUser');
        // If we want to check ban by email/googleId, we would need to update BannedUser model.
        // For now we will just check if we have a ban on their generated username/email.
        const isBanned = await BannedUser.findOne({ $or: [{ username: name }, { username: email }] });
        if (isBanned) {
            return res.status(403).json({ msg: 'Account creation denied. This account has been banned.' });
        }

        // Find or create user
        let user = await User.findOne({ $or: [{ email }, { googleId }] });
        
        if (!user) {
            // Check if there is an old user with the same username (name) who didn't use google auth
            let existingUsername = await User.findOne({ username: name });
            let finalUsername = name;
            
            // If the exact Google name is already taken by a non-Google account, append a random string
            if (existingUsername && !existingUsername.googleId) {
                finalUsername = `${name}_${Math.floor(Math.random() * 10000)}`;
            } else if (existingUsername && existingUsername.googleId) {
                // Should be caught by the $or check above unless email/googleId changed, but just in case
                user = existingUsername;
            }

            if (!user) {
                user = new User({
                    playerId: generatePlayerId(),
                    username: finalUsername,
                    email,
                    googleId
                });
                await user.save();
            }
        } else {
            // Update googleId if they matched by email but didn't have googleId yet
            if (!user.googleId) {
                user.googleId = googleId;
                await user.save();
            }
        }

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // Token expires in 7 days, session managed by frontend activity tracker
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                playerId: user.playerId,
                isSetupComplete: user.isSetupComplete
            }
        });

    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(500).json({ msg: 'Authentication failed' });
    }
});

// @route   GET /api/auth/user
// @desc    Get user data
router.get('/user', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = require('../middleware/auth');

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
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '../auth-debug.log');
    const log = (msg) => {
        try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch(e){}
    };
    log('--- New Google Auth Request ---');

    try {
        const { credential, loginType } = req.body;
        log(`loginType: ${loginType}, credential provided: ${!!credential}`);
        if (!credential) {
            return res.status(400).json({ msg: 'No credential provided' });
        }

        log(`Verifying ID token...`);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id_for_startup',
        });
        const payload = ticket.getPayload();
        
        const { email, name, sub: googleId } = payload;
        log(`Payload verified. email: ${email}, name: ${name}`);

        // Parse Organizer Emails
        let envEmails = process.env.ORGANIZER_EMAILS || '';

        const allowedEmails = envEmails
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);

        // --- Role Enforcement ---
        if (loginType === 'organizer') {
            log(`Allowed organizer emails: ${allowedEmails.join(', ')}`);
            if (!allowedEmails.includes(email.toLowerCase())) {
                log(`Auth Rejected: ${email} not in whitelist`);
                return res.status(403).json({ msg: 'Access denied. You are not an authorized organizer.' });
            }
            log(`Email ${email} authorized as organizer.`);
        } else if (loginType === 'player') {
            if (allowedEmails.includes(email.toLowerCase())) {
                log(`Auth Rejected: ${email} is an Organizer trying to login as Player`);
                return res.status(403).json({ msg: `Access denied. Organizers are restricted from logging in as Users. Please use the Organizer portal.` });
            }
        }

        log(`Checking BannedUser...`);
        const BannedUser = require('../models/BannedUser');
        const isBanned = await BannedUser.findOne({ $or: [{ username: name }, { username: email }] });
        if (isBanned) {
            return res.status(403).json({ msg: 'Account creation denied. This account has been banned.' });
        }

        // Find or create user
        let user;
        try {
            user = await User.findOne({ $or: [{ email }, { googleId }] });
            
            if (!user) {
                let existingUsername = await User.findOne({ username: name });
                let finalUsername = name;
                
                if (existingUsername && !existingUsername.googleId) {
                    finalUsername = `${name}_${Math.floor(Math.random() * 10000)}`;
                } else if (existingUsername && existingUsername.googleId) {
                    user = existingUsername;
                }

                if (!user) {
                    const isOrganizer = loginType === 'organizer';
                    user = new User({
                        playerId: generatePlayerId(),
                        username: finalUsername,
                        email,
                        googleId,
                        role: isOrganizer ? 'organizer' : 'player',
                        isSetupComplete: isOrganizer ? true : false
                    });
                    await user.save();
                }
            } else {
                if (!user.googleId) {
                    user.googleId = googleId;
                    await user.save();
                }
                if (loginType === 'player' && user.role === 'organizer') {
                    return res.status(403).json({ msg: 'Access Denied: Organizers are restricted from logging in as Users.' });
                }

                if (loginType === 'organizer') {
                    user.role = 'organizer';
                    user.isSetupComplete = true;
                }
                await user.save();
            }
        } catch (dbErr) {
            console.error('DB Error during user find/save:', dbErr);
            return res.status(500).json({ msg: `Database error while saving user: ${dbErr.message}` });
        }

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                playerId: user.playerId,
                isSetupComplete: user.isSetupComplete,
                role: user.role || 'player'
            }
        });

    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(500).json({ msg: `Authentication failed: ${err.message}` });
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

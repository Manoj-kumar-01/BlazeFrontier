const jwt = require('jsonwebtoken');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

const authMiddleware = async (req, res, next) => {
    // Check header or query parameter for token
    const token = req.header('x-auth-token') || req.query.token;
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Fetch user from DB to check role and email
        const user = await User.findById(decoded.id || decoded.user?.id);
        if (!user) return res.status(401).json({ msg: 'User not found' });

        // Parse Organizer Emails
        let envEmails = process.env.ORGANIZER_EMAILS || '';
        try {
            const envPath = path.join(__dirname, '../.env');
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/^ORGANIZER_EMAILS=(.*)$/m);
                if (match && match[1]) {
                    envEmails = match[1];
                }
            }
        } catch (e) {
            console.error('Error reading .env in auth middleware:', e.message);
        }

        const allowedEmails = envEmails
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);

        const email = user.email ? user.email.toLowerCase() : '';

        // Block if user is an Organizer (return 401 to trigger frontend logout)
        if (user.role === 'organizer' || allowedEmails.includes(email)) {
            return res.status(401).json({ msg: 'Access Denied: Organizers cannot access the Player portal.' });
        }

        // Enforce Single Device Login
        if (user.sessionToken && decoded.sessionToken !== user.sessionToken) {
            return res.status(401).json({ msg: 'Session expired. Logged in from another device.' });
        }

        req.user = decoded.user || decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

module.exports = authMiddleware;

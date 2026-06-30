const jwt = require('jsonwebtoken');
const User = require('../models/User');

const organizerAuth = async (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('role');
        
        if (!user) {
            console.log(`[organizerAuth] User not found for id: ${decoded.id}`);
            return res.status(404).json({ msg: 'User not found' });
        }

        if (user.role !== 'organizer') {
            console.log(`[organizerAuth] User role is not organizer: ${user.role} for id: ${decoded.id}`);
            return res.status(403).json({ msg: 'Access denied. Organizer privileges required.' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        console.error(`[organizerAuth] Token verify failed: ${err.message}`);
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

module.exports = organizerAuth;

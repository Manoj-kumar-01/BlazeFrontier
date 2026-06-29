const jwt = require('jsonwebtoken');
const User = require('../models/User');

const organizerAuth = async (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('role');
        
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        if (user.role !== 'organizer') {
            return res.status(403).json({ msg: 'Access denied. Organizer privileges required.' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

module.exports = organizerAuth;

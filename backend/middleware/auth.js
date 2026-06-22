const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Check header or query parameter for token
    const token = req.header('x-auth-token') || req.query.token;
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

module.exports = authMiddleware;

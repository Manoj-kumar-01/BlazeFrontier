const adminPrefix = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';

const adminAuth = (req, res, next) => {
    // If the admin is authenticated in the session, allow them through
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }
    
    // Check if it's an API request or a page request
    if (req.originalUrl.includes('/api/')) {
        return res.status(401).json({ msg: 'Unauthorized. Admin session required.' });
    }
    
    // Otherwise, redirect to the new secure login page
    res.redirect(`${adminPrefix}/login`);
};

module.exports = adminAuth;

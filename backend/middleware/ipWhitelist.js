const ipWhitelist = (req, res, next) => {
    // Get client IP
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Parse allowed IPs from env (comma separated)
    const allowedIpsStr = process.env.ADMIN_IPS || '';
    const allowedIps = allowedIpsStr.split(',').map(ip => ip.trim());

    // Normalize IPv4 mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
    let normalizedClientIp = clientIp;
    if (clientIp && clientIp.includes('::ffff:')) {
        normalizedClientIp = clientIp.split('::ffff:')[1];
    }

    if (allowedIps.includes(normalizedClientIp) || allowedIps.includes(clientIp)) {
        next();
    } else {
        // Return 404 Not Found to completely mask the existence of the admin route
        res.status(404).send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET ${req.originalUrl}</pre>
</body>
</html>
        `);
    }
};

module.exports = ipWhitelist;

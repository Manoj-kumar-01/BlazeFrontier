const NodeCache = require('node-cache');
// Standard cache configured for 5 minutes (300 seconds)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const cacheMiddleware = (durationInSeconds) => {
    return (req, res, next) => {
        // Skip caching for anything other than GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const key = req.originalUrl || req.url;
        const cachedResponse = cache.get(key);

        if (cachedResponse) {
            // console.log(`[Cache Hit] ${key}`);
            return res.json(cachedResponse);
        } else {
            // console.log(`[Cache Miss] ${key}`);
            // Intercept res.json to cache the response before sending it
            const originalJson = res.json.bind(res);
            res.json = (body) => {
                // Cache the body using the requested duration, or fallback to default
                cache.set(key, body, durationInSeconds || 300);
                originalJson(body);
            };
            next();
        }
    };
};

module.exports = { cacheMiddleware, cache };

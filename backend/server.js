const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const app = express();
app.set('trust proxy', 1); // Fix for proxy IPs, sessions, rate limits

const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Security & Performance Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP to allow embeds like YT/FB without strict configs
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(compression()); // Gzip compression for faster load times

// Basic Rate Limiting for API routes to prevent DDoS / Brute Force
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per `window` (here, per 15 minutes)
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session for Admin Panel
const session = require('express-session');
app.use(session({
    secret: process.env.SESSION_SECRET || 'blaze_default_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
}));

// Apply rate limiter specifically to API routes
app.use('/api/', apiLimiter);

// View Engine
app.set('view engine', 'ejs');



// Initialize Discord Bot
if (process.env.NODE_ENV !== 'test') {
    require('./discordBot');
}

// Routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminApiRoutes = require('./routes/admin');
const matchmakingRoutes = require('./routes/matchmaking');

const adminAuth = require('./middleware/adminAuth');
const adminPrefix = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';

// Admin Login Rate Limiter
const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 login requests per 15 mins
    message: 'Too many login attempts, please try again later.'
});
const speakeasy = require('speakeasy');

// Global No-Cache for APIs and dynamic content (Fix BFCache and caching bugs)
app.use((req, res, next) => {
    if (!req.path.startsWith('/public')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/matchmaking', matchmakingRoutes);
app.use(`${adminPrefix}/api`, adminAuth, adminApiRoutes);

// --- Admin Login Routes ---
app.get(`${adminPrefix}/login`, (req, res) => {
    if (req.session && req.session.adminAuthenticated) {
        return res.redirect(adminPrefix);
    }
    res.render('admin/login', { adminPrefix, error: null });
});

app.post(`${adminPrefix}/login`, adminLoginLimiter, (req, res) => {
    const { password, mfaCode } = req.body;
    
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.render('admin/login', { adminPrefix, error: 'Invalid password.' });
    }
    
    const isValid = speakeasy.totp.verify({
        secret: process.env.ADMIN_MFA_SECRET,
        encoding: 'base32',
        token: mfaCode,
        window: 2
    });
    
    if (!isValid) {
        return res.render('admin/login', { adminPrefix, error: 'Invalid 2FA code.' });
    }
    
    req.session.adminAuthenticated = true;
    res.redirect(adminPrefix);
});

app.get(`${adminPrefix}/logout`, (req, res) => {
    req.session.destroy();
    res.redirect(`${adminPrefix}/login`);
});

// Configure EJS View Engine
const path = require('path');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));
app.use('/public', express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// Cache control handled globally above

// Frontend View Routes
app.get('/auth', (req, res) => res.render('auth/auth', { clientId: process.env.GOOGLE_CLIENT_ID }));
app.get('/onboarding', (req, res) => res.render('onboarding/index'));
app.get('/dashboard', (req, res) => res.render('dashboard/index', { activePage: '/dashboard' }));
app.get('/dashboard/seasons', (req, res) => res.render('dashboard/seasons', { activePage: '/dashboard/seasons' }));
app.get('/dashboard/seasons/hub', (req, res) => res.render('dashboard/season_hub', { activePage: '/dashboard/seasons' }));
app.get('/dashboard/profile', (req, res) => res.render('dashboard/profile', { activePage: '/dashboard/profile' }));
app.get('/dashboard/tournaments', (req, res) => res.render('dashboard/tournaments', { activePage: '/dashboard/tournaments' }));
app.get('/dashboard/tournaments/register', (req, res) => res.render('dashboard/tourney_register', { activePage: '/dashboard/tournaments' }));
app.get('/dashboard/leaderboards', (req, res) => res.render('dashboard/leaderboards', { activePage: '/dashboard/leaderboards' }));
app.get('/dashboard/freefire', (req, res) => res.render('dashboard/freefire', { activePage: '/dashboard/freefire' }));
app.get('/dashboard/content', (req, res) => res.render('dashboard/content', { activePage: '/dashboard/content' }));
app.get(adminPrefix, adminAuth, (req, res) => res.render('admin/index', { adminPrefix, activePage: 'admin' }));
app.get(`${adminPrefix}/player/:playerId`, adminAuth, (req, res) => res.render('admin/profile', { adminPrefix, activePage: 'admin', playerId: req.params.playerId }));
app.get('/banned', (req, res) => res.render('onboarding/banned'));

const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');

async function startBackend() {
    // Initialize Apollo Server
    const server = new ApolloServer({
        typeDefs,
        resolvers,
    });
    await server.start();

    // Mount GraphQL endpoint with Context
    const jwt = require('jsonwebtoken');
    app.use('/graphql', expressMiddleware(server, {
        context: async ({ req }) => {
            const token = req.header('x-auth-token');
            if (!token) return { user: null };
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                return { user: decoded };
            } catch (err) {
                return { user: null };
            }
        }
    }));

    // Connect to MongoDB
    mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB Connected to Blaze Frontier Cluster');
        // Start Agenda Queue
        const agenda = require('./utils/queue');
        await agenda.start();
        console.log('Agenda Job Queue Started successfully.');
    })
    .catch(err => console.log('MongoDB Connection Error:', err));

    if (process.env.NODE_ENV !== 'test') {
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            console.log(`Blaze Frontier Backend running on port ${PORT}`);
            console.log(`GraphQL endpoint available at http://localhost:${PORT}/graphql`);
        });
    }
}

if (require.main === module) {
    startBackend();
}

module.exports = { app, startBackend };

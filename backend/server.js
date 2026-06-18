const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const app = express();

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

// Apply rate limiter specifically to API routes
app.use('/api/', apiLimiter);

// View Engine
app.set('view engine', 'ejs');

// Log all incoming requests for debugging
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

// Initialize Discord Bot
require('./discordBot');

// Routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminApiRoutes = require('./routes/admin');

const ipWhitelist = require('./middleware/ipWhitelist');
const adminPrefix = process.env.ADMIN_ROUTE_PREFIX || '/hidden-admin';

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use(`${adminPrefix}/api`, ipWhitelist, adminApiRoutes);

// Configure EJS View Engine
const path = require('path');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));
app.use('/public', express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// Middleware to prevent caching for authenticated views
app.use('/dashboard', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

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
app.get(adminPrefix, ipWhitelist, (req, res) => res.render('admin/index', { adminPrefix, activePage: 'admin' }));
app.get('/banned', (req, res) => res.render('onboarding/banned'));

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Blaze Frontier Backend running on port ${PORT}`));

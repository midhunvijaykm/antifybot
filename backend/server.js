require('dotenv').config();

// ==============================
// IMPORTS
// ==============================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const passport = require('passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');

const connectDB = require('./db');

// ==============================
// DEBUG ENV VARIABLES
// ==============================

console.log('=================================');
console.log('CLIENT_ID:', process.env.CLIENT_ID);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('PORT:', process.env.PORT);
console.log('=================================');

// ==============================
// LOAD PASSPORT CONFIG
// ==============================

require('./config/passport');

// ==============================
// IMPORT ROUTES
// ==============================

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

// ==============================
// CREATE EXPRESS APP & PROXIES
// ==============================

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);

// ==============================
// CORS
// ==============================

const allowedOrigins = [
  'https://antifybot.pages.dev',
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173'
];

app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Dev-friendly fallback
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// ==============================
// SECURITY HEADERS & LIMITERS
// ==============================

// 1. Helmet (Strict HTTP Security Headers & Content Security Policy)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://antifybot.pages.dev",
        "https://*.cloudflare.com",
        "https://discord.com",
        "https://*.discord.com",
        "http://localhost:5173"
      ],
      connectSrc: [
        "'self'",
        "https://antifybot.pages.dev",
        "https://antify-bot.duckdns.org",
        "https://discord.com",
        "https://*.discord.com",
        "wss://antify-bot.duckdns.org",
        "ws://localhost:5000",
        "ws://localhost:5173",
        "http://localhost:5000",
        "http://localhost:5173"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://cdn.discordapp.com",
        "https://discordapp.com",
        "https://*.discordapp.com"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'"
      ],
      upgradeInsecureRequests: []
    }
  }
}));

// 2. MongoDB Operator Injection Sanitization
app.use(mongoSanitize());

// 3. Cross-Site Scripting (XSS) Sanitization
app.use(xss());

// 4. HTTP Parameter Pollution Protection
app.use(hpp());

// Apply rate limiter to all API endpoints
app.set('trust proxy', 1);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// ==============================
// ENV VARIABLES
// ==============================

const PORT = process.env.PORT || 5000;

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  'http://localhost:5173';

// ==============================
// CONNECT DATABASE
// ==============================

connectDB();

// ==============================
// SOCKET.IO CONFIG
// ==============================

const io = socketIo(server, {
  cors: {
    origin: ['https://antifybot.pages.dev', FRONTEND_URL, 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io globally available
app.set('io', io);

// ==============================
// BODY PARSERS
// ==============================

app.use(express.json());

app.use(express.urlencoded({
  extended: true
}));

// ==============================
// JWT AUTHENTICATION MIDDLEWARE
// ==============================

const jwt = require('jsonwebtoken');
const { User } = require('./models');

app.use(async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'antify_jwt_secret');
      const user = await User.findById(decoded.id);
      if (user) {
        req.user = user;
      }
    }
  } catch (err) {
    console.warn('Optional JWT authentication failed:', err.message);
  }
  next();
});

// ==============================
// PASSPORT
// ==============================

app.use(passport.initialize());

// ==============================
// ROUTES
// ==============================

app.use('/api/auth', authRoutes);

app.use('/api', apiRoutes);

// ==============================
// ROOT ROUTE
// ==============================

app.get('/', (req, res) => {

  res.json({

    status: 'ANTIFY Backend Running',

    authenticated: !!req.user,

    frontend: FRONTEND_URL
  });
});

// ==============================
// HEALTH CHECK
// ==============================

app.get('/health', (req, res) => {

  res.json({

    status: 'ok',

    uptime: process.uptime(),

    authenticated: !!req.user
  });
});

// ==============================
// CURRENT USER ROUTE
// ==============================

app.get('/api/me', (req, res) => {

  if (!req.user) {

    return res.status(401).json({

      authenticated: false
    });
  }

  res.json({

    authenticated: true,

    user: req.user
  });
});

// ==============================
// SOCKET CONNECTIONS
// ==============================

io.on('connection', (socket) => {

  console.log(
    `🔌 Client connected: ${socket.id}`
  );

  // ==========================
  // JOIN GUILD ROOM
  // ==========================

  socket.on('join_guild', (guildId) => {

    const roomName =
      `guild_${guildId}`;

    socket.join(roomName);

    console.log(
      `📡 Joined room: ${roomName}`
    );
  });

  // ==========================
  // LEAVE GUILD ROOM
  // ==========================

  socket.on('leave_guild', (guildId) => {

    const roomName =
      `guild_${guildId}`;

    socket.leave(roomName);

    console.log(
      `📡 Left room: ${roomName}`
    );
  });

  // ==========================
  // DISCONNECT
  // ==========================

  socket.on('disconnect', () => {

    console.log(
      `❌ Client disconnected: ${socket.id}`
    );
  });
});

// ==============================
// START SERVER FUNCTION
// ==============================

function startServer(client) {
  if (client) {
    app.set('discordClient', client);
    client.io = io;
  }

  server.listen(PORT, () => {
    console.log(`
========================================
🚀 ANTIFY Backend Running
🌐 Port: ${PORT}
🖥️ Frontend: ${FRONTEND_URL}
========================================
`);
  });
}

// Support both direct execution and bot.js module import
if (require.main === module) {
  startServer();
}

module.exports = startServer;
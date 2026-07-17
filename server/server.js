const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { getConfig, CONFIG_DIR } = require('./config');
const { router: authRouter, requireAuth, socketAuthMiddleware } = require('./auth');
const { startTunnel, stopTunnel, getTunnelUrl } = require('./tunnel');
const { log, getLocalLogs, getMachineMetrics, CATEGORIES, LEVELS } = require('./supabase-logger');

const config = getConfig();
const PORT = config.port || 3000;
const PID_FILE = path.join(CONFIG_DIR, 'server.pid');

const app = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  secret: config.session_secret || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use(authRouter);
app.use(requireAuth);
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/tunnel/url', (req, res) => {
  res.json({ url: getTunnelUrl() });
});

// --- Dashboard APIs (for Cloudflare Worker) ---

// Middleware: allow dashboard access without requiring an API key
function validateApiKey(req, res, next) {
  next();
}

// GET /api/v1/dashboard/info - Machine and system info
app.get('/api/v1/dashboard/info', validateApiKey, (req, res) => {
  const config = getConfig();
  const metrics = getMachineMetrics();
  res.json({
    success: true,
    data: {
      machineId: config.machineId,
      machineName: config.machineName || os.hostname(),
      tunnelUrl: getTunnelUrl(),
      timestamp: Date.now(),
      metrics: {
        cpuUsage: metrics.cpuUsage,
        memoryPercent: metrics.memoryPercent,
        usedMemory: metrics.usedMemory,
        totalMemory: metrics.totalMemory,
        uptime: metrics.uptime,
        platform: metrics.platform,
        nodeVersion: metrics.nodeVersion,
        loadAverage: metrics.loadAverage
      }
    }
  });
});

// GET /api/v1/dashboard/logs - Get logs with pagination
app.get('/api/v1/dashboard/logs', validateApiKey, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const category = req.query.category;
  const level = req.query.level;

  let logs = getLocalLogs();

  // Filter by category
  if (category) {
    logs = logs.filter(l => l.category === category);
  }

  // Filter by level
  if (level) {
    logs = logs.filter(l => l.level === level);
  }

  // Sort by timestamp descending (newest first)
  logs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Paginate
  const total = logs.length;
  const paginated = logs.slice(offset, offset + limit);

  res.json({
    success: true,
    data: {
      logs: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      timestamp: Date.now()
    }
  });
});

// GET /api/v1/dashboard/metrics - Get current metrics
app.get('/api/v1/dashboard/metrics', validateApiKey, (req, res) => {
  const metrics = getMachineMetrics();
  res.json({
    success: true,
    data: metrics,
    timestamp: Date.now()
  });
});

// GET /api/v1/dashboard/stats - Get log statistics
app.get('/api/v1/dashboard/stats', validateApiKey, (req, res) => {
  const logs = getLocalLogs();

  const stats = {
    total: logs.length,
    byCategory: {},
    byLevel: {},
    recent: {
      lastHour: 0,
      lastMinute: 0
    }
  };

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneMinuteAgo = now - 60 * 1000;

  logs.forEach(log => {
    const logTime = new Date(log.timestamp).getTime();

    // Count by category
    stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;

    // Count by level
    stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

    // Recent counts
    if (logTime > oneMinuteAgo) stats.recent.lastMinute++;
    if (logTime > oneHourAgo) stats.recent.lastHour++;
  });

  res.json({
    success: true,
    data: stats,
    timestamp: Date.now()
  });
});

// GET /api/v1/dashboard/health - Health check
app.get('/api/v1/dashboard/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'online',
      authorized: true,
      timestamp: Date.now(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  });
});

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024
});

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const req = socket.request;
  if (!req.session) {
    sessionMiddleware(req, {}, () => {
      socketAuthMiddleware(socket, next);
    });
  } else {
    socketAuthMiddleware(socket, next);
  }
});

// Register socket handlers (wrapped in try/catch for modules not yet built)
const handlers = ['screen', 'monitors', 'privacy', 'terminal', 'clipboard'];
const loadedHandlers = {};

handlers.forEach((name) => {
  try {
    loadedHandlers[name] = require(`./${name}`);
  } catch (err) {
    console.log(`[server] Module ./${name} not yet available: ${err.message}`);
  }
});

io.on('connection', (socket) => {
  log(CATEGORIES.SERVER, `Client connected: ${socket.id}`, LEVELS.INFO);

  socket.on('ping-latency', (callback) => {
    if (typeof callback === 'function') callback();
  });

  Object.entries(loadedHandlers).forEach(([name, handler]) => {
    if (handler && typeof handler.handleConnection === 'function') {
      try {
        handler.handleConnection(socket, io);
      } catch (err) {
        log(CATEGORIES.SERVER, `Error in ${name}.handleConnection: ${err.message}`, LEVELS.ERROR);
      }
    }
  });

  socket.on('disconnect', (reason) => {
    log(CATEGORIES.SERVER, `Client disconnected: ${socket.id} (${reason})`, LEVELS.INFO);
    Object.entries(loadedHandlers).forEach(([name, handler]) => {
      if (handler && typeof handler.handleDisconnect === 'function') {
        try {
          handler.handleDisconnect(socket);
        } catch (err) {
          log(CATEGORIES.SERVER, `Error in ${name}.handleDisconnect: ${err.message}`, LEVELS.ERROR);
        }
      }
    });
  });
});

// Mount file routes (REST-based)
try {
  const filesRouter = require('./files');
  app.use('/api/files', filesRouter);
} catch (err) {
  console.log(`[server] Files module not yet available: ${err.message}`);
}

// Write PID file
function writePidFile() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch { }
}

async function start() {
  writePidFile();

  server.listen(PORT, '127.0.0.1', async () => {
    log(CATEGORIES.SERVER, `Running on http://127.0.0.1:${PORT}`, LEVELS.INFO);
    const url = await startTunnel(PORT);
    if (url) {
      log(CATEGORIES.SERVER, `Remote access: ${url}`, LEVELS.INFO);
    } else {
      log(CATEGORIES.SERVER, 'Tunnel connecting in background. It will appear when ready.', LEVELS.INFO);
    }
  });
}

async function shutdown() {
  log(CATEGORIES.SERVER, 'Shutting down...', LEVELS.INFO);
  await stopTunnel();
  removePidFile();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

// Helper to broadcast logs to dashboard viewers
global.broadcastLog = (category, message, level = 'info', data = null) => {
  log(category, message, level, data);
  io.to('dashboard').emit('log-entry', {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    category,
    level,
    message,
    data: data || {}
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  log(CATEGORIES.SERVER, `Uncaught exception: ${err.message}`, LEVELS.ERROR, { stack: err.stack });
});
process.on('unhandledRejection', (err) => {
  log(CATEGORIES.SERVER, `Unhandled rejection: ${err.message || String(err)}`, LEVELS.ERROR);
});

start();


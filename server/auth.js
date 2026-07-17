const { Router } = require('express');
const crypto = require('crypto');
const { getConfig } = require('./config');

const router = Router();

const failedAttempts = new Map();
const LOCKOUT_MS = 30000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60000;

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function isLockedOut(ip) {
  const record = failedAttempts.get(ip);
  if (!record) return false;
  if (Date.now() - record.lockedAt < LOCKOUT_MS && record.locked) return true;
  if (Date.now() - record.firstAttempt > WINDOW_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return false;
}

function recordFailure(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, firstAttempt: now, locked: false, lockedAt: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.locked = true;
    record.lockedAt = now;
  }
  failedAttempts.set(ip, record);
}

function clearFailures(ip) {
  failedAttempts.delete(ip);
}

router.post('/api/auth/login', (req, res) => {
  const ip = req.ip;
  if (isLockedOut(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 30 seconds.' });
  }

  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN required' });
  }

  const config = getConfig();
  const hashed = hashPin(pin);

  const storedHash = config.pin_hash;
  if (hashed === storedHash) {
    clearFailures(ip);
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    req.session.ip = ip;
    return res.json({ success: true });
  }

  recordFailure(ip);
  return res.status(401).json({ error: 'Invalid PIN' });
});

router.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

router.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

function requireAuth(req, res, next) {
  const publicPaths = ['/login.html', '/api/auth/login', '/api/auth/status'];
  const dashboardPaths = ['/api/v1/dashboard/info', '/api/v1/dashboard/logs', '/api/v1/dashboard/metrics', '/api/v1/dashboard/stats', '/api/v1/dashboard/health'];
  const isPublicAsset = req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path === '/favicon.ico';

  if (publicPaths.includes(req.path) || dashboardPaths.includes(req.path) || isPublicAsset) {
    return next();
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.redirect('/login.html');
}

function socketAuthMiddleware(socket, next) {
  const session = socket.request.session;
  if (session && session.authenticated) {
    return next();
  }
  return next(new Error('Authentication required'));
}

module.exports = { router, requireAuth, socketAuthMiddleware };

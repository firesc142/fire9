const admin = require('firebase-admin');
const os = require('os');
const { getFirebaseApp, isFirebaseReady } = require('./firebase-config');
const { getConfig } = require('./config');

function canUseFirebaseDatabase() {
  try {
    const app = getFirebaseApp();
    if (!app) return false;
    const config = getConfig();
    const dbUrl = app.options?.databaseURL;
    return !!(dbUrl && config.machineId);
  } catch {
    return false;
  }
}

// Local log buffer for UI (last 100 logs)
const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// Machine metrics cache
let machineMetrics = {
  machineId: null,
  machineName: os.hostname(),
  timestamp: Date.now(),
  cpuUsage: 0,
  totalMemory: os.totalmem(),
  freeMemory: os.freemem(),
  uptime: os.uptime(),
  platform: process.platform
};

function updateMachineMetrics() {
  const config = getConfig();
  machineMetrics = {
    machineId: config.machineId,
    machineName: config.machineName || os.hostname(),
    timestamp: Date.now(),
    cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    usedMemory: os.totalmem() - os.freemem(),
    memoryPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    uptime: os.uptime(),
    platform: process.platform,
    nodeVersion: process.version,
    loadAverage: os.loadavg()
  };

  return machineMetrics;
}

function log(category, message, level = 'info', data = null) {
  const timestamp = new Date().toISOString();
  const config = getConfig();
  
  const logEntry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp,
    machineId: config.machineId,
    machineName: config.machineName || os.hostname(),
    category,
    level,
    message,
    data: data || {}
  };

  // Add to local buffer
  logBuffer.push(logEntry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }

  // Send to Firebase if available
  if (isFirebaseReady() && canUseFirebaseDatabase()) {
    sendToFirebase(logEntry);
  }

  // Console output
  const prefix = `[${category}]`;
  const levelSymbol = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} ${levelSymbol} ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
}

async function sendToFirebase(logEntry) {
  try {
    const app = getFirebaseApp();
    if (!app) return;

    const config = getConfig();
    const machineId = config.machineId;
    if (!machineId) return;

    const db = admin.database(app);
    if (!db || typeof db.ref !== 'function') return;

    // Store in database path: machines/{machineId}/logs/{logId}
    await db.ref(`machines/${machineId}/logs/${logEntry.id}`).set(logEntry);

    // Update machine last-seen timestamp
    await db.ref(`machines/${machineId}/lastSeen`).set(Date.now());
  } catch (err) {
    // Silently fail - don't spam console
  }
}

async function pushMachineMetrics() {
  updateMachineMetrics();

  if (isFirebaseReady() && canUseFirebaseDatabase()) {
    try {
      const app = getFirebaseApp();
      if (!app) return;

      const config = getConfig();
      const machineId = config.machineId;
      if (!machineId) return;

      const db = admin.database(app);
      if (!db || typeof db.ref !== 'function') return;

      await db.ref(`machines/${machineId}/metrics`).set({
        ...machineMetrics,
        lastUpdated: Date.now()
      });
    } catch (err) {
      // Silently fail
    }
  }
}

function getLocalLogs() {
  return logBuffer;
}

function getMachineMetrics() {
  return updateMachineMetrics();
}

function clearLogs() {
  logBuffer = [];
}

// Categories
const CATEGORIES = {
  TUNNEL: 'tunnel',
  SERVER: 'server',
  AUTH: 'auth',
  SCREEN: 'screen',
  TERMINAL: 'terminal',
  FILES: 'files',
  CLIPBOARD: 'clipboard',
  MONITORS: 'monitors',
  PRIVACY: 'privacy'
};

// Levels
const LEVELS = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  DEBUG: 'debug'
};

module.exports = {
  log,
  getLocalLogs,
  getMachineMetrics,
  pushMachineMetrics,
  clearLogs,
  updateMachineMetrics,
  CATEGORIES,
  LEVELS
};

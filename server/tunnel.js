const net = require('net');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { getConfig, updateConfig, CONFIG_DIR } = require('./config');
const { log, CATEGORIES, LEVELS } = require('./supabase-logger');

let tunnelInstance = null;
let currentUrl = null;
let tunnelPort = null;
let stopped = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 300000;
const NETWORK_CHECK_TIMEOUT = 5000;
const FIRST_ATTEMPT_TIMEOUT = 120000;
const NETWORK_TARGETS = [
  { host: '1.1.1.1', port: 443 },
  { host: '1.0.0.1', port: 443 },
  { host: '8.8.8.8', port: 443 },
];

// --- Binary management ---

function getBinaryPaths() {
  const { DEFAULT_CLOUDFLARED_BIN } = require('cloudflared/lib/constants');
  const fallback = path.join(CONFIG_DIR, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  return { npmPath: DEFAULT_CLOUDFLARED_BIN, fallbackPath: fallback };
}

async function ensureBinary() {
  const { npmPath, fallbackPath } = getBinaryPaths();
  const constants = require('cloudflared/lib/constants');

  if (fs.existsSync(npmPath)) {
    constants.use(npmPath);
    return npmPath;
  }

  if (fs.existsSync(fallbackPath)) {
    constants.use(fallbackPath);
    return fallbackPath;
  }

  log(CATEGORIES.TUNNEL, 'Cloudflared binary not found, downloading...', LEVELS.INFO);
  const { install } = require('cloudflared/lib/install');

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await install(fallbackPath);
      log(CATEGORIES.TUNNEL, 'Cloudflared binary downloaded successfully', LEVELS.INFO);
      constants.use(fallbackPath);
      return fallbackPath;
    } catch (err) {
      log(CATEGORIES.TUNNEL, `Binary download failed (attempt ${attempt}/2): ${err.message}`, LEVELS.ERROR);
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
  }

  throw new Error('Failed to download cloudflared binary');
}

// --- Network readiness ---

function checkNetwork(target) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port, timeout: NETWORK_CHECK_TIMEOUT });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForNetwork(maxWaitMs = 120000) {
  const start = Date.now();
  let delay = 2000;
  let targetIndex = 0;

  while (Date.now() - start < maxWaitMs) {
    if (stopped) throw new Error('stopped');

    const target = NETWORK_TARGETS[targetIndex % NETWORK_TARGETS.length];
    const online = await checkNetwork(target);
    if (online) return true;

    targetIndex++;
    log(CATEGORIES.TUNNEL, `Waiting for network... (${Math.round((Date.now() - start) / 1000)}s elapsed)`, LEVELS.INFO);
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30000);
  }

  throw new Error('Network not available after ' + (maxWaitMs / 1000) + 's');
}

// --- DNS flush ---

function flushDns() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }
    exec('ipconfig /flushdns', { timeout: 5000 }, () => resolve());
  });
}

// --- Tunnel diagnostics ---

function captureTunnelState() {
  const state = {
    timestamp: new Date().toISOString(),
    tunnelRunning: !!tunnelInstance,
    currentUrl: currentUrl || 'none',
    stopped: stopped,
    pid: tunnelInstance?.pid || 'unknown'
  };
  return state;
}

function logTunnelFailure(reason, details) {
  const state = captureTunnelState();
  log(CATEGORIES.TUNNEL, `FAILURE: ${reason}`, LEVELS.ERROR, { details, state });
}

function killTunnelProcess() {
  if (tunnelInstance) {
    const inst = tunnelInstance;
    tunnelInstance = null;
    currentUrl = null;
    try { if (inst.stop) inst.stop(); else if (inst.close) inst.close(); } catch { }
  }
}

// --- Worker communication ---

async function pushUrlToWorker(url, retries = 3) {
  const config = getConfig();
  const workerUrl = config.urlWorker?.endpoint;
  const apiKey = config.urlWorker?.apiKey;
  const machineId = config.machineId;
  const machineName = config.machineName || os.hostname();

  if (!workerUrl || !apiKey || !machineId) return;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ url, machineId, machineName, status: 'online', ts: Date.now() })
      });
      if (response.ok) {
        log(CATEGORIES.TUNNEL, 'URL pushed to worker', LEVELS.INFO);
        syncPinFromWorker();
        return;
      }
      log(CATEGORIES.TUNNEL, `Failed to push URL to worker: ${response.status}`, LEVELS.ERROR);
    } catch (err) {
      log(CATEGORIES.TUNNEL, `Error pushing URL to worker (attempt ${attempt}/${retries}): ${err.message}`, LEVELS.ERROR);
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 5000 * attempt));
  }

  syncPinFromWorker();
}

async function syncPinFromWorker() {
  const config = getConfig();
  const workerUrl = config.urlWorker?.endpoint;
  const apiKey = config.urlWorker?.apiKey;

  if (!workerUrl || !apiKey) return;

  try {
    const baseUrl = workerUrl.replace(/\/api\/url$/, '');
    const response = await fetch(`${baseUrl}/api/pin`, { headers: { 'X-API-Key': apiKey } });
    if (response.ok) {
      const data = await response.json();
      if (data.pin_hash) {
        updateConfig({ pin_hash: data.pin_hash, pinHash: null });
        log(CATEGORIES.TUNNEL, 'PIN synced from worker', LEVELS.INFO);
      }
    }
  } catch (err) {
    log(CATEGORIES.TUNNEL, `Error syncing PIN: ${err.message}`, LEVELS.ERROR);
  }
}

async function notifyOffline() {
  const config = getConfig();
  const workerUrl = config.urlWorker?.endpoint;
  const apiKey = config.urlWorker?.apiKey;
  const machineId = config.machineId;

  if (!workerUrl || !apiKey || !machineId) return;

  try {
    const baseUrl = workerUrl.replace(/\/api\/url$/, '');
    await fetch(`${baseUrl}/api/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ machineId })
    });
    log(CATEGORIES.TUNNEL, 'Offline notification sent', LEVELS.INFO);
  } catch (err) {
    log(CATEGORIES.TUNNEL, `Failed to send offline notification: ${err.message}`, LEVELS.ERROR);
  }
}

// --- Restart polling ---
// Polls the worker every 30s for a restart command set from the dashboard.
// On receipt, waits 30s (shows countdown in logs) then restarts the process.

let restartPollTimer = null;
let restartCountdownTimer = null;

function startRestartPolling() {
  if (restartPollTimer) return;
  restartPollTimer = setInterval(checkForRestart, 30000);
}

function stopRestartPolling() {
  if (restartPollTimer) { clearInterval(restartPollTimer); restartPollTimer = null; }
  if (restartCountdownTimer) { clearTimeout(restartCountdownTimer); restartCountdownTimer = null; }
}

async function checkForRestart() {
  const config = getConfig();
  const workerUrl = config.urlWorker?.endpoint;
  const apiKey = config.urlWorker?.apiKey;
  if (!workerUrl || !apiKey) return;
  // Already in countdown — don't stack another
  if (restartCountdownTimer) return;

  try {
    const baseUrl = workerUrl.replace(/\/api\/url$/, '');
    const res = await fetch(`${baseUrl}/api/restart`, {
      headers: { 'X-API-Key': apiKey }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.restart === true) {
      log(CATEGORIES.SERVER, 'Global restart toggle is ON — restarting in 30s...', LEVELS.INFO);
      let countdown = 30;
      const tick = () => {
        log(CATEGORIES.SERVER, `Restarting in ${countdown}s...`, LEVELS.INFO);
        countdown--;
        if (countdown <= 0) {
          log(CATEGORIES.SERVER, 'Restarting now.', LEVELS.INFO);
          setTimeout(() => process.exit(0), 500);
        } else {
          restartCountdownTimer = setTimeout(tick, 1000);
        }
      };
      restartCountdownTimer = setTimeout(tick, 1000);
    }
  } catch {
    // ignore network errors during poll
  }
}



async function startTunnel(port) {
  tunnelPort = port;
  stopped = false;
  reconnectAttempts = 0;

  updateConfig({ tunnel: { url: null } });

  startRestartPolling(); // begin polling for remote restart commands

  try {
    await ensureBinary();
  } catch (err) {
    log(CATEGORIES.TUNNEL, err.message, LEVELS.ERROR);
    log(CATEGORIES.TUNNEL, 'Will retry in background...', LEVELS.INFO);
    scheduleReconnect();
    return null;
  }

  try {
    await waitForNetwork();
  } catch (err) {
    if (err.message === 'stopped') return null;
    log(CATEGORIES.TUNNEL, err.message, LEVELS.ERROR);
    scheduleReconnect();
    return null;
  }

  return launchTunnel(port, true);
}

async function launchTunnel(port, isFirstAttempt) {
  let Tunnel;
  try {
    Tunnel = require('cloudflared/lib/tunnel').Tunnel;
  } catch (err) {
    log(CATEGORIES.TUNNEL, `cloudflared module not available: ${err.message}`, LEVELS.ERROR);
    if (isFirstAttempt) { scheduleReconnect(); return null; }
    return;
  }

  try {
    return new Promise((resolve) => {
      let resolved = false;
      const t = Tunnel.quick(`http://localhost:${port}`);
      tunnelInstance = t;

      t.on('url', (url) => {
        currentUrl = url;
        reconnectAttempts = 0;
        updateConfig({ tunnel: { url: currentUrl } });
        log(CATEGORIES.TUNNEL, `Connected: ${currentUrl}`, LEVELS.INFO);
        pushUrlToWorker(currentUrl);
        if (isFirstAttempt && !resolved) { resolved = true; resolve(currentUrl); }
      });

      t.on('error', (err) => {
        logTunnelFailure('Tunnel error', err.message || String(err));
      });

      t.on('exit', (code) => {
        if (code === 0) {
          log(CATEGORIES.TUNNEL, 'Process exited normally (code 0)', LEVELS.INFO);
        } else {
          logTunnelFailure('Tunnel process exited', `Exit code: ${code}`);
        }
        tunnelInstance = null;
        currentUrl = null;
        if (!stopped) scheduleReconnect();
      });

      if (isFirstAttempt) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('[tunnel] Still connecting in background (initial timeout reached)');
            resolve(null);
          }
        }, FIRST_ATTEMPT_TIMEOUT);
      }
    });
  } catch (err) {
    log(CATEGORIES.TUNNEL, `Cloudflare tunnel spawn failed: ${err.message}`, LEVELS.ERROR);
    if (isFirstAttempt) { scheduleReconnect(); return null; }
  }
}

// --- Reconnection (infinite, exponential backoff, capped at 5 min) ---

function scheduleReconnect() {
  if (stopped) return;
  if (reconnectTimer) return;

  reconnectAttempts++;
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
  log(CATEGORIES.TUNNEL, `Reconnect in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`, LEVELS.INFO);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (stopped || !tunnelPort) return;

    await flushDns();

    try {
      await waitForNetwork(60000);
    } catch (err) {
      if (err.message === 'stopped') return;
      log(CATEGORIES.TUNNEL, 'Network not ready, will retry...', LEVELS.WARN);
      scheduleReconnect();
      return;
    }

    try {
      await ensureBinary();
    } catch (err) {
      log(CATEGORIES.TUNNEL, `${err.message}, will retry...`, LEVELS.WARN);
      scheduleReconnect();
      return;
    }

    log(CATEGORIES.TUNNEL, 'Attempting reconnect...', LEVELS.INFO);
    await launchTunnel(tunnelPort, false);
  }, delay);
}

// --- Public API ---

async function stopTunnel() {
  stopped = true;
  stopRestartPolling();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  await notifyOffline();
  killTunnelProcess();
  updateConfig({ tunnel: { url: null } });
  console.log('[tunnel] Stopped');
}

function getTunnelUrl() {
  return currentUrl;
}

module.exports = { startTunnel, stopTunnel, getTunnelUrl };

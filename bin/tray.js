#!/usr/bin/env node
/**
 * Paperfly Tray Host
 * Launches the Paperfly server and shows a Windows system tray icon.
 * Run with:  node bin/tray.js
 * Startup:   VBScript in Windows Startup folder calls this file via node.
 */

'use strict';

let SysTray;
try {
  SysTray = require('systray2').default;
} catch (err) {
  console.error('[tray] systray2 not available:', err.message);
  process.exit(0);
}
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ensureStartupScript } = require('./startup-repair');

const CONFIG_DIR = path.join(os.homedir(), '.paperfly');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PID_FILE = path.join(CONFIG_DIR, 'server.pid');
const SERVER_SCRIPT = path.join(__dirname, '..', 'server', 'server.js');

// Self-repair: ensure VBS in Startup folder has correct paths after npm update
ensureStartupScript();

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 16x16 transparent PNG icon
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklE' +
  'QVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Server process management
// ---------------------------------------------------------------------------
let serverProc = null;

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function getTunnelUrl() {
  const cfg = readConfig();
  return cfg.tunnel?.url || cfg.tunnelUrl || null;
}

function isServerRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    try { fs.unlinkSync(PID_FILE); } catch {}
    return false;
  }
}

function startServer() {
  if (isServerRunning()) return;

  serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(serverProc.pid), 'utf-8');
  } catch {}

  serverProc.on('exit', () => {
    serverProc = null;
    try { fs.unlinkSync(PID_FILE); } catch {}
  });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch {}
    serverProc = null;
  }
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      try { process.kill(pid, 'SIGTERM'); } catch {}
      setTimeout(() => {
        try { process.kill(pid, 0); execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
      }, 3000);
    } catch {}
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Tray menu — Refresh only
// ---------------------------------------------------------------------------
const itemRefresh = {
  title: 'Refresh',
  tooltip: 'refreshh',
  checked: false,
  enabled: true,
  click() {
    stopServer();
    setTimeout(() => startServer(), 1200);
  },
};

// ---------------------------------------------------------------------------
// Create tray
// ---------------------------------------------------------------------------
const systray = new SysTray({
  menu: {
    icon: ICON_B64,
    title: 'refresh',
    tooltip: 'refresh',
    items: [
      itemRefresh,
    ],
  },
  debug: false,
  copyDir: false,
});

systray.onClick(action => {
  if (action.item && typeof action.item.click === 'function') {
    action.item.click();
  }
});

systray.ready().then(() => {
  startServer();
}).catch(err => {
  console.error('[tray] Failed to start:', err.message);
  startServer();
});

// Graceful shutdown on signals
process.on('SIGINT', () => { stopServer(); process.exit(0); });
process.on('SIGTERM', () => { stopServer(); process.exit(0); });

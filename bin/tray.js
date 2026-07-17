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
// .env sitting next to the installed package (global install) or in ~/.paperfly
const DOTENV_PATHS = [
  path.join(__dirname, '..', '.env'),
  path.join(CONFIG_DIR, '.env'),
];

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
  } catch { }
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
    try { fs.unlinkSync(PID_FILE); } catch { }
    return false;
  }
}

function buildServerEnv() {
  // Start with the current process environment
  const env = { ...process.env };

  // Load any .env files we know about so credentials reach the child process
  // even when launched from the system tray (no shell env loading)
  for (const envPath of DOTENV_PATHS) {
    if (fs.existsSync(envPath)) {
      try {
        const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx < 1) continue;
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (k && !(k in env)) env[k] = v; // don't override already-set vars
        }
      } catch { /* ignore unreadable file */ }
    }
  }
  return env;
}

function startServer() {
  if (isServerRunning()) return;

  serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
    env: buildServerEnv(),
  });

  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(serverProc.pid), 'utf-8');
  } catch { }

  serverProc.on('exit', () => {
    serverProc = null;
    try { fs.unlinkSync(PID_FILE); } catch { }
  });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch { }
    serverProc = null;
  }
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      // Force-kill the old process and wait for it to die before allowing a restart
      try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { }
    } catch { }
    try { fs.unlinkSync(PID_FILE); } catch { }
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
    // taskkill /F is synchronous — 500ms is enough for the port to be released
    setTimeout(() => startServer(), 500);
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

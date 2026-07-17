const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), '.paperfly');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_PIN = '123456';

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function createConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`  Created config directory: ${CONFIG_DIR}`);
  }
}

function initConfig() {
  let config = {};

  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  }

  if (!config.pinHash) {
    config.pinHash = hashPin(DEFAULT_PIN);
    console.log(`  Default PIN set to: ${DEFAULT_PIN}`);
    console.log('  Change it with: paperfly set-pin');
  }

  if (!config.sessionSecret) {
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  if (!config.port) {
    config.port = 3000;
  }

  if (!config.machineId) {
    config.machineId = crypto.randomUUID();
    console.log(`  Machine ID: ${config.machineId}`);
  }

  if (!config.machineName) {
    config.machineName = os.hostname();
    console.log(`  Machine Name: ${config.machineName}`);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function createActivityLog() {
  const logDir = path.join(CONFIG_DIR, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Auto-start: VBScript in Windows Startup folder (same approach as 9remote)
// ---------------------------------------------------------------------------
function registerAutoStart() {
  try {
    const startupDir = path.join(
      os.homedir(),
      'AppData', 'Roaming', 'Microsoft', 'Windows',
      'Start Menu', 'Programs', 'Startup'
    );
    const vbsPath = path.join(startupDir, 'PaperFly.vbs');
    const trayScript = path.resolve(__dirname, 'tray.js');
    const nodeExe = process.execPath;

    // Match 9remote format: single-line, hidden window, non-blocking
    const vbsContent =
      'CreateObject("WScript.Shell").Run """' + nodeExe + '"" ""' + trayScript + '"" --tray --skip-update --start", 0, False\r\n';

    fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
    console.log('  Registered auto-start: PaperFly.vbs');
    console.log('  Location: ' + vbsPath);
    return true;
  } catch (err) {
    console.log('  [!] Failed to register auto-start: ' + err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Immediate launch after install (hidden, no terminal flash)
// ---------------------------------------------------------------------------
function launchTrayNow() {
  try {
    const trayScript = path.resolve(__dirname, 'tray.js');
    const nodeExe = process.execPath;
    const tmpVbs = path.join(os.tmpdir(), 'paperfly_launch.vbs');

    const vbsContent =
      'CreateObject("WScript.Shell").Run """' + nodeExe + '"" ""' + trayScript + '"" --start", 0, False\r\n';

    fs.writeFileSync(tmpVbs, vbsContent, 'utf-8');
    execSync(`cscript //nologo "${tmpVbs}"`, { stdio: 'ignore', windowsHide: true });
    try { fs.unlinkSync(tmpVbs); } catch {}
    console.log('  Paperfly tray launched.');
  } catch (err) {
    try {
      const { spawn } = require('child_process');
      const trayScript = path.resolve(__dirname, 'tray.js');
      const child = spawn(process.execPath, [trayScript, '--start'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      console.log('  Paperfly tray launched (spawn fallback).');
    } catch (err2) {
      console.log('  [!] Could not launch tray now: ' + err2.message);
      console.log('  It will start automatically at next logon.');
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function ensureCloudflaredBinary() {
  const binDir = path.join(CONFIG_DIR, 'bin');
  const binPath = path.join(binDir, 'cloudflared.exe');

  // Check if npm module already has it
  try {
    const constantsPath = require.resolve('cloudflared/lib/constants');
    const npmBin = path.join(path.dirname(constantsPath), '..', 'bin', 'cloudflared.exe');
    if (fs.existsSync(npmBin)) {
      console.log('  cloudflared binary already present (npm module)');
      return;
    }
  } catch {}

  if (fs.existsSync(binPath)) {
    console.log('  cloudflared binary already present');
    return;
  }

  console.log('  Downloading cloudflared binary...');
  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    const { install } = require('cloudflared/lib/install');
    await install(binPath);
    console.log('  cloudflared binary downloaded successfully');
  } catch (err) {
    console.log(`  [!] cloudflared download failed: ${err.message}`);
    console.log('  The service will retry at first launch.');
  }
}

async function main() {
  console.log('\n========================================');
  console.log('  Paperfly - Installation Setup');
  console.log('========================================\n');

  console.log('[1/5] Creating config directory...');
  createConfigDir();

  console.log('[2/5] Initializing configuration...');
  initConfig();
  createActivityLog();

  console.log('[3/5] Downloading cloudflared tunnel binary...');
  await ensureCloudflaredBinary();

  console.log('[4/5] Registering auto-start...');
  registerAutoStart();

  console.log('[5/5] Launching Paperfly...');
  launchTrayNow();

  console.log('\n========================================');
  console.log('  Installation Complete!');
  console.log('========================================');
  console.log(`\n  Config: ${CONFIG_DIR}`);
  console.log('  Default PIN: 123456 (change with: paperfly set-pin)');
  console.log('\n  Commands:');
  console.log('    paperfly start    - Start service');
  console.log('    paperfly stop     - Stop service');
  console.log('    paperfly status   - Check status');
  console.log('    paperfly help     - Show help');
  console.log('');
}

main().catch((err) => {
  console.error('Installation failed:', err.message);
  process.exit(1);
});

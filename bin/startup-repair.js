'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const STARTUP_DIR = path.join(
  os.homedir(),
  'AppData', 'Roaming', 'Microsoft', 'Windows',
  'Start Menu', 'Programs', 'Startup'
);
const VBS_PATH = path.join(STARTUP_DIR, 'PaperFly.vbs');

function buildVbsContent() {
  const nodeExe = process.execPath;
  const trayScript = path.resolve(__dirname, 'tray.js');
  return (
    'CreateObject("WScript.Shell").Run """' + nodeExe + '"" ""' + trayScript + '"" --tray --skip-update --start", 0, False\r\n'
  );
}

/**
 * Self-repair: verify VBS in Startup folder has correct paths.
 * Rewrites if stale or missing — ensures auto-start survives npm updates
 * and Node.js version changes (which move the node.exe path).
 *
 * Returns: 'ok' | 'repaired' | 'created' | 'error'
 */
function ensureStartupScript() {
  try {
    const expected = buildVbsContent();

    if (fs.existsSync(VBS_PATH)) {
      const current = fs.readFileSync(VBS_PATH, 'utf-8');
      if (current === expected) return 'ok';
      fs.writeFileSync(VBS_PATH, expected, 'utf-8');
      return 'repaired';
    } else {
      fs.writeFileSync(VBS_PATH, expected, 'utf-8');
      return 'created';
    }
  } catch {
    return 'error';
  }
}

module.exports = { ensureStartupScript, VBS_PATH, STARTUP_DIR };

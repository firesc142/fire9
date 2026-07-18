const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { VBS_PATH } = require('./startup-repair');

const CONFIG_DIR = path.join(os.homedir(), '.paperfly');
const PID_FILE = path.join(CONFIG_DIR, 'server.pid');

function killByPid(pid, label) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    console.log(`  Stopped ${label} (PID: ${pid})`);
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`  Stopped ${label} (PID: ${pid})`);
    } catch { }
  }
}

function killRunningProcess() {
  // Kill server process tracked by PID file
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!isNaN(pid)) killByPid(pid, 'server process');
    try { fs.unlinkSync(PID_FILE); } catch { }
  }

  // Kill any remaining tray / server node processes holding the package folder
  // This is the main cause of EBUSY during npm install/uninstall
  try {
    // Find all node.exe processes whose command line contains 'paperfly' or 'tray.js'
    const result = execSync(
      'wmic process where "name=\'node.exe\'" get processid,commandline /format:csv',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const selfPid = process.pid;
    result.split(/\r?\n/).forEach(line => {
      if (
        (line.toLowerCase().includes('paperfly') || line.toLowerCase().includes('tray.js')) &&
        !line.toLowerCase().includes('uninstall')
      ) {
        const parts = line.split(',');
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid) && pid !== selfPid) {
          killByPid(pid, 'tray/server process');
        }
      }
    });
  } catch {
    // wmic not available — best effort
  }

  // Small wait to let OS release file handles
  try { execSync('timeout /T 2 /NOBREAK', { stdio: 'ignore' }); } catch { }
}

function removeStartupScript() {
  try {
    if (fs.existsSync(VBS_PATH)) {
      fs.unlinkSync(VBS_PATH);
      console.log('  Removed auto-start script: PaperFly.vbs');
    } else {
      console.log('  Auto-start script not found (already removed).');
    }
  } catch (err) {
    console.log('  [!] Failed to remove auto-start script: ' + err.message);
  }
}

function promptConfigCleanup() {
  console.log(`\n  Config directory preserved at: ${CONFIG_DIR}`);
  console.log('  To remove it manually, delete that folder.');
}

function main() {
  console.log('\n========================================');
  console.log('  Paperfly - Uninstalling');
  console.log('========================================\n');

  console.log('[1/3] Stopping running service...');
  killRunningProcess();

  console.log('[2/3] Removing auto-start...');
  removeStartupScript();

  console.log('[3/3] Cleanup...');
  promptConfigCleanup();

  console.log('\n========================================');
  console.log('  Uninstall Complete');
  console.log('========================================\n');
}

main();

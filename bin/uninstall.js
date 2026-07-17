const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { VBS_PATH } = require('./startup-repair');

const CONFIG_DIR = path.join(os.homedir(), '.paperfly');
const PID_FILE = path.join(CONFIG_DIR, 'server.pid');

function killRunningProcess() {
  if (!fs.existsSync(PID_FILE)) return;

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    console.log(`  Stopped running process (PID: ${pid})`);
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`  Stopped running process (PID: ${pid})`);
    } catch {}
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
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

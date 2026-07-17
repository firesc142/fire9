const { spawn, execSync } = require('child_process');
const path = require('path');

let privacyActive = false;
let overlayProcess = null;
let connectedClients = new Set();

const OVERLAY_SCRIPT = path.join(__dirname, 'privacy-overlay.ps1');

function enablePrivacy() {
  if (privacyActive) return true;

  try {
    overlayProcess = spawn('powershell.exe', [
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', OVERLAY_SCRIPT,
    ], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });

    overlayProcess.on('error', (err) => {
      console.error('Privacy overlay process error:', err.message);
      privacyActive = false;
      overlayProcess = null;
    });

    overlayProcess.on('exit', (code) => {
      privacyActive = false;
      overlayProcess = null;
    });

    privacyActive = true;
    return true;
  } catch (err) {
    console.error('Failed to enable privacy mode:', err.message);
    return false;
  }
}

function disablePrivacy() {
  if (!privacyActive) return true;

  try {
    if (overlayProcess && !overlayProcess.killed) {
      overlayProcess.kill('SIGTERM');
      setTimeout(() => {
        if (overlayProcess && !overlayProcess.killed) {
          overlayProcess.kill('SIGKILL');
        }
      }, 1000);
    }
  } catch (err) {
    console.error('Error killing overlay process:', err.message);
  }

  try {
    execSync('taskkill /F /FI "WINDOWTITLE eq RemoteDesktopPrivacy" 2>nul', { stdio: 'ignore' });
  } catch (err) {
    // Process may already be gone
  }

  privacyActive = false;
  overlayProcess = null;
  return true;
}

function isPrivacyActive() {
  return privacyActive;
}

function handleConnection(socket, io) {
  connectedClients.add(socket.id);

  socket.on('privacy-enable', () => {
    const success = enablePrivacy();
    io.emit('privacy-status', { active: privacyActive, success });
  });

  socket.on('privacy-disable', () => {
    const success = disablePrivacy();
    io.emit('privacy-status', { active: privacyActive, success });
  });

  socket.on('privacy-status', (callback) => {
    const status = { active: privacyActive };
    if (typeof callback === 'function') callback(status);
    else socket.emit('privacy-status', status);
  });

  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    if (connectedClients.size === 0 && privacyActive) {
      console.log('All clients disconnected — disabling privacy mode for safety.');
      disablePrivacy();
      io.emit('privacy-status', { active: false, reason: 'auto-disabled' });
    }
  });
}

module.exports = { handleConnection };

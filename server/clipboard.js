const { execSync, exec } = require('child_process');

const watchers = new Map();

function getClipboard() {
  try {
    const text = execSync('powershell.exe -Command "Get-Clipboard"', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
    });
    return text.replace(/\r\n$/, '');
  } catch {
    return '';
  }
}

function setClipboard(text) {
  const escaped = text.replace(/'/g, "''");
  execSync(`powershell.exe -Command "Set-Clipboard -Value '${escaped}'"`, {
    windowsHide: true,
    timeout: 5000,
  });
}

function handleConnection(socket) {
  socket.on('clipboard-get', () => {
    try {
      const text = getClipboard();
      socket.emit('clipboard-data', { text });
    } catch (err) {
      socket.emit('clipboard-error', { error: err.message });
    }
  });

  socket.on('clipboard-set', ({ text }) => {
    try {
      setClipboard(text || '');
      socket.emit('clipboard-status', { success: true });
    } catch (err) {
      socket.emit('clipboard-error', { error: err.message });
    }
  });

  socket.on('clipboard-watch-start', () => {
    if (watchers.has(socket.id)) return;

    let lastContent = getClipboard();

    const interval = setInterval(() => {
      try {
        const current = getClipboard();
        if (current !== lastContent) {
          lastContent = current;
          socket.emit('clipboard-data', { text: current });
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    watchers.set(socket.id, interval);
    socket.emit('clipboard-watch-status', { active: true });
  });

  socket.on('clipboard-watch-stop', () => {
    const interval = watchers.get(socket.id);
    if (interval) {
      clearInterval(interval);
      watchers.delete(socket.id);
    }
    socket.emit('clipboard-watch-status', { active: false });
  });

  socket.on('disconnect', () => {
    const interval = watchers.get(socket.id);
    if (interval) {
      clearInterval(interval);
      watchers.delete(socket.id);
    }
  });
}

module.exports = { handleConnection };

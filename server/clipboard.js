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
  // Encode the command as Base64 to safely handle quotes, $vars, backticks, newlines etc.
  const ps = `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  execSync(`powershell.exe -EncodedCommand ${encoded}`, {
    windowsHide: true,
    timeout: 5000,
  });
}

function handleConnection(socket) {
  // Start watching clipboard automatically as soon as client connects.
  // Push any change to the frontend within ~1 second of it happening.
  let lastContent = '';
  try { lastContent = getClipboard(); } catch { /* ignore */ }

  const autoInterval = setInterval(() => {
    try {
      const current = getClipboard();
      if (current !== lastContent) {
        lastContent = current;
        socket.emit('clipboard-data', { text: current });
      }
    } catch { /* ignore polling errors */ }
  }, 1000);

  watchers.set(socket.id, autoInterval);

  socket.on('clipboard-get', () => {
    try {
      const text = getClipboard();
      lastContent = text; // keep in sync so next poll doesn't re-fire
      socket.emit('clipboard-data', { text });
    } catch (err) {
      socket.emit('clipboard-error', { error: err.message });
    }
  });

  socket.on('clipboard-set', ({ text }) => {
    try {
      setClipboard(text || '');
      lastContent = text || ''; // keep in sync so next poll doesn't echo back
      socket.emit('clipboard-status', { success: true });
    } catch (err) {
      socket.emit('clipboard-error', { error: err.message });
    }
  });

  // Keep these events so existing UI checkbox still works (no-op since we auto-watch)
  socket.on('clipboard-watch-start', () => {
    socket.emit('clipboard-watch-status', { active: true });
  });

  socket.on('clipboard-watch-stop', () => {
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

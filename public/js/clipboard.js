// Clipboard sync
(function() {
  const clipboardText = document.getElementById('clipboard-text');
  const getBtn = document.getElementById('clipboard-get-btn');
  const sendBtn = document.getElementById('clipboard-send-btn');
  const copyLocalBtn = document.getElementById('clipboard-copy-local-btn');
  const pasteLocalBtn = document.getElementById('clipboard-paste-local-btn');
  const autoSyncCheckbox = document.getElementById('clipboard-auto-sync');

  // Get remote clipboard
  getBtn.addEventListener('click', () => {
    socket.emit('clipboard-get');
  });

  // Send to remote clipboard
  sendBtn.addEventListener('click', () => {
    const text = clipboardText.value;
    if (!text) {
      showNotification('Nothing to send', 'warning');
      return;
    }
    socket.emit('clipboard-set', { text });
  });

  // Copy to local clipboard
  copyLocalBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(clipboardText.value);
      showNotification('Copied to local clipboard', 'success');
    } catch (err) {
      showNotification('Failed to copy: ' + err.message, 'error');
    }
  });

  // Paste from local clipboard
  pasteLocalBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      clipboardText.value = text;
      showNotification('Pasted from local clipboard', 'success');
    } catch (err) {
      showNotification('Failed to read clipboard: ' + err.message, 'error');
    }
  });

  // Auto-sync toggle
  autoSyncCheckbox.addEventListener('change', () => {
    if (autoSyncCheckbox.checked) {
      socket.emit('clipboard-watch-start');
      showNotification('Auto-sync enabled', 'info');
    } else {
      socket.emit('clipboard-watch-stop');
      showNotification('Auto-sync disabled', 'info');
    }
  });

  // Receive clipboard data from server
  socket.on('clipboard-data', (data) => {
    clipboardText.value = data.text;
  });

  // Clipboard operation status
  socket.on('clipboard-status', (data) => {
    if (data.success) {
      showNotification('Clipboard updated on remote', 'success');
    } else {
      showNotification('Clipboard operation failed', 'error');
    }
  });
})();

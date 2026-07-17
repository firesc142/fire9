// Clipboard sync
(function () {
  const clipboardText = document.getElementById('clipboard-text');
  const getBtn = document.getElementById('clipboard-get-btn');
  const sendBtn = document.getElementById('clipboard-send-btn');
  const copyLocalBtn = document.getElementById('clipboard-copy-local-btn');
  const pasteLocalBtn = document.getElementById('clipboard-paste-local-btn');
  const autoSyncCheckbox = document.getElementById('clipboard-auto-sync');

  // Auto-sync is always on — pre-check the box to reflect that
  if (autoSyncCheckbox) {
    autoSyncCheckbox.checked = true;
    autoSyncCheckbox.disabled = true;
    autoSyncCheckbox.title = 'Clipboard is always synced automatically';
  }

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
    // Primary: modern Clipboard API (requires HTTPS or localhost + focus)
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        clipboardText.value = text;
        showNotification('Pasted from local clipboard', 'success');
        return;
      } catch (err) {
        // Fall through to execCommand fallback
      }
    }
    // Fallback: execCommand('paste') — works over HTTP and in older browsers
    try {
      const tmp = document.createElement('textarea');
      tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(tmp);
      tmp.focus();
      const ok = document.execCommand('paste');
      const text = tmp.value;
      document.body.removeChild(tmp);
      if (ok && text) {
        clipboardText.value = text;
        showNotification('Pasted from local clipboard', 'success');
      } else {
        showNotification('Clipboard access denied — grant permission or use HTTPS', 'error');
      }
    } catch (err) {
      showNotification('Failed to read clipboard: ' + err.message, 'error');
    }
  });

  // Receive clipboard data from server (pushed automatically on any remote copy/cut)
  socket.on('clipboard-data', (data) => {
    // Only update if the textarea isn't focused (don't clobber user typing)
    if (document.activeElement !== clipboardText) {
      clipboardText.value = data.text;
    }
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

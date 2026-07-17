// Screen viewer and remote control
(function() {
  const canvas = document.getElementById('screen-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = document.getElementById('screen-placeholder');
  const startBtn = document.getElementById('start-stream-btn');
  const stopBtn = document.getElementById('stop-stream-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const monitorSelect = document.getElementById('monitor-select'); // may be null (removed from UI)
  const fpsSelect = document.getElementById('fps-select');
  const qualitySelect = document.getElementById('quality-select');
  const modeSelect = document.getElementById('stream-mode-select');
  const privacyBtn = document.getElementById('privacy-toggle-btn');
  const privacyBanner = document.getElementById('privacy-banner');

  let streaming = false;
  let privacyActive = false;
  let streamMode = 'efficient';
  let screenWidth = 1920;
  let screenHeight = 1080;
  let isDragging = false;
  let dragStartPos = null;
  let lastMouseEmit = 0;
  let lastFrameSeq = 0;
  const MOUSE_THROTTLE = 16;

  // Start streaming
  startBtn.addEventListener('click', () => {
    streamMode = modeSelect.value;
    socket.emit('start-stream', {
      fps: parseInt(fpsSelect.value),
      quality: parseInt(qualitySelect.value),
      monitor: monitorSelect ? parseInt(monitorSelect.value) : 0,
      mode: streamMode
    });
    streaming = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    placeholder.classList.add('hidden');
    canvas.focus();
  });

  // Stop streaming
  stopBtn.addEventListener('click', () => {
    socket.emit('stop-stream');
    streaming = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    placeholder.classList.remove('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // Mode change
  modeSelect.addEventListener('change', () => {
    streamMode = modeSelect.value;
    if (streaming) {
      socket.emit('set-stream-mode', streamMode);
    }
  });

  // FPS/Quality change
  fpsSelect.addEventListener('change', () => {
    if (streaming) socket.emit('set-fps', parseInt(fpsSelect.value));
  });

  qualitySelect.addEventListener('change', () => {
    if (streaming) socket.emit('set-quality', parseInt(qualitySelect.value));
  });

  // Fullscreen
  fullscreenBtn.addEventListener('click', () => {
    const container = canvas.parentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  });

  // Screenshot
  screenshotBtn.addEventListener('click', () => {
    socket.emit('get-screenshot', {}, (data) => {
      if (data.error) {
        showNotification('Screenshot failed: ' + data.error, 'error');
        return;
      }
      const link = document.createElement('a');
      link.href = 'data:image/' + (data.format || 'png') + ';base64,' + data.data;
      link.download = 'screenshot-' + Date.now() + '.' + (data.format || 'png');
      link.click();
      showNotification('Screenshot saved', 'success');
    });
  });

  socket.on('screenshot-result', (data) => {
    if (data.error) {
      showNotification('Screenshot failed: ' + data.error, 'error');
      return;
    }
    const link = document.createElement('a');
    link.href = 'data:image/' + (data.format || 'png') + ';base64,' + data.data;
    link.download = 'screenshot-' + Date.now() + '.' + (data.format || 'png');
    link.click();
    showNotification('Screenshot saved', 'success');
  });

  // Monitor selection
  socket.emit('get-monitors');
  socket.on('monitors-list', (monitors) => {
    if (!monitorSelect) return; // element removed from UI
    monitorSelect.innerHTML = '';
    monitors.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = 'Monitor ' + (i + 1) + ' (' + m.width + 'x' + m.height + ')';
      monitorSelect.appendChild(opt);
    });
  });

  if (monitorSelect) {
    monitorSelect.addEventListener('change', () => {
      socket.emit('set-monitor', parseInt(monitorSelect.value));
    });
  }

  // Privacy mode
  privacyBtn.addEventListener('click', () => {
    if (privacyActive) {
      socket.emit('privacy-disable');
    } else {
      socket.emit('privacy-enable');
    }
  });

  socket.on('privacy-status', (data) => {
    privacyActive = data.active;
    privacyBtn.classList.toggle('active', privacyActive);
    privacyBanner.classList.toggle('hidden', !privacyActive);
  });

  // === HD MODE: Receive full JPEG frames ===
  const img = new Image();
  img.onload = () => {
    if (streamMode !== 'hd') return;
    canvas.width = img.width;
    canvas.height = img.height;
    screenWidth = img.width;
    screenHeight = img.height;
    ctx.drawImage(img, 0, 0);
  };

  socket.on('screen-frame', (data) => {
    if (streamMode !== 'hd') return;
    img.src = 'data:image/jpeg;base64,' + data.data;
    if (data.width) screenWidth = data.width;
    if (data.height) screenHeight = data.height;
  });

  // === EFFICIENT MODE: Receive tile diffs ===
  const FMT_RAW_DEFLATE = 0x00;
  const FMT_WEBP = 0x01;
  const HEADER_SIZE = 14;
  const TILE_HEADER_SIZE = 8;

  function ensureCanvasSize(width, height, isKeyframe) {
    if (canvas.width === width && canvas.height === height) return;
    let savedImage = null;
    if (canvas.width > 0 && canvas.height > 0) {
      savedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    canvas.width = width;
    canvas.height = height;
    if (savedImage && !isKeyframe) {
      ctx.putImageData(savedImage, 0, 0);
    }
    screenWidth = width;
    screenHeight = height;
  }

  function drawDeflateTile(bytes, tileX, tileY, tileSize, width, height) {
    const rgb = pako.inflate(bytes);
    const tileW = Math.min(tileSize, width - tileX);
    const tileH = Math.min(tileSize, height - tileY);
    const rgba = new Uint8ClampedArray(tileW * tileH * 4);
    let ri = 0;
    for (let i = 0; i < tileW * tileH; i++) {
      rgba[i * 4] = rgb[ri];
      rgba[i * 4 + 1] = rgb[ri + 1];
      rgba[i * 4 + 2] = rgb[ri + 2];
      rgba[i * 4 + 3] = 255;
      ri += 3;
    }
    ctx.putImageData(new ImageData(rgba, tileW, tileH), tileX, tileY);
  }

  socket.on('screen-tiles', (buffer) => {
    if (streamMode !== 'efficient') return;
    try {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      const msgType = view.getUint8(0);
      const format = view.getUint8(1);
      const frameSeq = view.getUint32(2, true);
      const width = view.getUint16(6, true);
      const height = view.getUint16(8, true);
      const tileSize = view.getUint16(10, true);
      const tileCount = view.getUint16(12, true);
      const isKeyframe = msgType === 0x02;

      // Detect frame gaps — request keyframe if needed
      if (lastFrameSeq > 0 && frameSeq > lastFrameSeq + 1 && !isKeyframe) {
        socket.emit('request-keyframe');
      }
      lastFrameSeq = frameSeq;

      ensureCanvasSize(width, height, isKeyframe);

      // Parse tile headers
      const tiles = [];
      let offset = HEADER_SIZE;
      for (let i = 0; i < tileCount; i++) {
        const col = view.getUint16(offset, true);
        const row = view.getUint16(offset + 2, true);
        const dataLength = view.getUint32(offset + 4, true);
        tiles.push({ col, row, dataLength });
        offset += TILE_HEADER_SIZE;
      }

      if (format === FMT_WEBP) {
        // Decode each WebP tile asynchronously, then blit at its position.
        for (const tile of tiles) {
          const data = bytes.slice(offset, offset + tile.dataLength);
          offset += tile.dataLength;
          const tileX = tile.col * tileSize;
          const tileY = tile.row * tileSize;
          const blob = new Blob([data], { type: 'image/webp' });
          createImageBitmap(blob).then((bmp) => {
            ctx.drawImage(bmp, tileX, tileY);
            bmp.close && bmp.close();
          }).catch(() => {});
        }
      } else {
        for (const tile of tiles) {
          const data = bytes.slice(offset, offset + tile.dataLength);
          offset += tile.dataLength;
          drawDeflateTile(data, tile.col * tileSize, tile.row * tileSize, tileSize, width, height);
        }
      }
    } catch (err) {
      console.error('Tile decode error:', err);
      socket.emit('request-keyframe');
    }
  });

  // Mouse events
  canvas.addEventListener('mousemove', (e) => {
    if (!streaming) return;
    const now = Date.now();
    if (now - lastMouseEmit < MOUSE_THROTTLE) return;
    lastMouseEmit = now;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    socket.emit('mouse-move', { x, y });

    if (isDragging) {
      socket.emit('mouse-drag', { x, y, dragging: true });
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!streaming) return;
    e.preventDefault();
    canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const button = ['left', 'middle', 'right'][e.button] || 'left';

    isDragging = true;
    dragStartPos = { x, y };
    socket.emit('mouse-down', { x, y, button });
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!streaming) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const button = ['left', 'middle', 'right'][e.button] || 'left';

    isDragging = false;
    socket.emit('mouse-up', { x, y, button });
  });

  canvas.addEventListener('dblclick', (e) => {
    if (!streaming) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    socket.emit('mouse-click', { x, y, button: 'left', type: 'double' });
  });

  canvas.addEventListener('wheel', (e) => {
    if (!streaming) return;
    e.preventDefault();
    socket.emit('mouse-scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard events
  canvas.addEventListener('keydown', (e) => {
    if (!streaming) return;
    e.preventDefault();
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.altKey) modifiers.push('alt');
    if (e.shiftKey) modifiers.push('shift');
    if (e.metaKey) modifiers.push('meta');
    socket.emit('key-press', { key: e.key, code: e.code, modifiers });
  });

  canvas.addEventListener('keyup', (e) => {
    if (!streaming) return;
    e.preventDefault();
    socket.emit('key-release', { key: e.key, code: e.code });
  });

  // Touch support for mobile
  let touchStartTime = 0;
  let touchStartPos = null;
  let lastTapTime = 0;
  let touchTimeout = null;

  canvas.addEventListener('touchstart', (e) => {
    if (!streaming) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    touchStartPos = {
      x: (touch.clientX - rect.left) / rect.width,
      y: (touch.clientY - rect.top) / rect.height
    };
    touchStartTime = Date.now();

    if (e.touches.length === 2) {
      // Two finger tap = right click
      socket.emit('mouse-click', { ...touchStartPos, button: 'right', type: 'single' });
      return;
    }

    // Long press detection for drag
    touchTimeout = setTimeout(() => {
      isDragging = true;
      socket.emit('mouse-down', { ...touchStartPos, button: 'left' });
    }, 500);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!streaming) return;
    e.preventDefault();
    if (touchTimeout) { clearTimeout(touchTimeout); touchTimeout = null; }
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    socket.emit('mouse-move', { x, y });
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!streaming) return;
    e.preventDefault();
    if (touchTimeout) { clearTimeout(touchTimeout); touchTimeout = null; }

    const touchDuration = Date.now() - touchStartTime;
    const now = Date.now();

    if (isDragging) {
      isDragging = false;
      socket.emit('mouse-up', { ...touchStartPos, button: 'left' });
      return;
    }

    if (touchDuration < 300 && touchStartPos) {
      // Check for double tap
      if (now - lastTapTime < 300) {
        socket.emit('mouse-click', { ...touchStartPos, button: 'left', type: 'double' });
      } else {
        socket.emit('mouse-click', { ...touchStartPos, button: 'left', type: 'single' });
      }
      lastTapTime = now;
    }
  }, { passive: false });
})();

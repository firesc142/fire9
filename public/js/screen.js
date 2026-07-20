// Screen viewer and remote control
// Coordinate system follows industry-standard-mouse.md:
//   Client → normalised (0–1) → Server → logical desktop pixels
(function () {
  const canvas = document.getElementById('screen-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = document.getElementById('screen-placeholder');
  const startBtn = document.getElementById('start-stream-btn');
  const stopBtn = document.getElementById('stop-stream-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const monitorSelect = document.getElementById('monitor-select');
  const fpsSelect = document.getElementById('fps-select');
  const qualitySelect = document.getElementById('quality-select');
  const modeSelect = document.getElementById('stream-mode-select');
  const privacyBtn = document.getElementById('privacy-toggle-btn');
  const privacyBanner = document.getElementById('privacy-banner');
  const viewOnlyBtn = document.getElementById('view-only-btn');

  let streaming = false;
  let privacyActive = false;
  let viewOnlyMode = false;  // when true — all input events are suppressed
  let streamMode = 'efficient';
  let screenWidth = 1920;
  let screenHeight = 1080;
  let lastFrameSeq = 0;

  // ── Drag state (§7 Drag Operations) ────────────────────────────────────────
  let isDragging = false;
  let dragStartPos = null;  // normalised {x,y} at mousedown
  let lastDragPos = null;   // last normalised pos during drag

  // ── §1 / §3 / §4.3 Coordinate mapping ──────────────────────────────────────────
  // Converts a browser event position to normalised coordinates (0.0 – 1.0)
  // relative to the rendered content area of the canvas (object-fit:contain).
  //
  // §4.3: Subtracts border and padding so the origin is the inner content edge.
  // §3:   Computes letterbox/pillarbox offset to match object-fit:contain geometry.
  function clientToNormalized(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();

    // §4.3 — subtract border and padding (matches getBoundingClientRect spec)
    const style = window.getComputedStyle(canvas);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;

    const srcW = canvas.width || screenWidth;
    const srcH = canvas.height || screenHeight;
    if (!srcW || !srcH) return null;

    const dispW = rect.width - borderLeft - borderRight - paddingLeft - paddingRight;
    const dispH = rect.height - borderTop - borderBottom - paddingTop - paddingBottom;

    const srcAspect = srcW / srcH;
    const dispAspect = dispW / dispH;

    let renderW, renderH, offsetX, offsetY;

    if (Math.abs(dispAspect - srcAspect) < 0.01) {
      renderW = dispW; renderH = dispH;
      offsetX = 0; offsetY = 0;
    } else if (dispAspect > srcAspect) {
      renderH = dispH;
      renderW = dispH * srcAspect;
      offsetX = (dispW - renderW) / 2;
      offsetY = 0;
    } else {
      renderW = dispW;
      renderH = dispW / srcAspect;
      offsetX = 0;
      offsetY = (dispH - renderH) / 2;
    }

    const relX = (clientX - rect.left) - borderLeft - paddingLeft;
    const relY = (clientY - rect.top) - borderTop - paddingTop;

    if (relX < offsetX || relX > offsetX + renderW ||
      relY < offsetY || relY > offsetY + renderH) {
      return null;
    }

    return {
      x: (relX - offsetX) / renderW,
      y: (relY - offsetY) / renderH,
    };
  }

  function touchToNormalized(touch) {
    return clientToNormalized(touch.clientX, touch.clientY);
  }

  // ── §5.4 Client DPI-change listener ──────────────────────────────────────────
  // When the user changes Windows DPI scaling or browser zoom, devicePixelRatio
  // changes. We notify the server so it can log/adapt, and the coordinate
  // mapper automatically uses the new getBoundingClientRect() values.
  (function watchDPIChanges() {
    let lastDPR = window.devicePixelRatio;
    function onDPRChange() {
      if (window.devicePixelRatio === lastDPR) return;
      lastDPR = window.devicePixelRatio;
      notifyViewportChange();
      // Re-register with the new DPR value
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDPRChange, { once: true });
    }
    const mq = matchMedia(`(resolution: ${lastDPR}dppx)`);
    mq.addEventListener('change', onDPRChange, { once: true });
  })();

  // ── §9 Viewport change notification ────────────────────────────────────────
  // Tells the server the client's current viewport and video dimensions so it
  // can validate or log coordinate context.  Called on resize and fullscreen.
  function notifyViewportChange() {
    if (!streaming) return;
    socket.emit('viewport-change', {
      clientWidth: window.innerWidth,
      clientHeight: window.innerHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      timestamp: performance.now(),
    });
  }

  // Monitor viewport/fullscreen/orientation changes (§9)
  const resizeObserver = new ResizeObserver(() => notifyViewportChange());
  resizeObserver.observe(canvas);
  window.addEventListener('resize', notifyViewportChange);

  // Hide CRT corner brackets in fullscreen — toggle a class on the container
  const screenContainer = canvas.parentElement;
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!document.fullscreenElement;
    screenContainer.classList.toggle('fullscreen-active', isFullscreen);
    setTimeout(notifyViewportChange, 100);
  });
  document.addEventListener('webkitfullscreenchange', () => {
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    screenContainer.classList.toggle('fullscreen-active', isFullscreen);
  });
  // §9.4 — mobile orientation change
  window.addEventListener('orientationchange', () => {
    setTimeout(notifyViewportChange, 300); // wait for resize to complete
  });

  // ── Stream controls ──────────────────────────────────────────────────────────

  startBtn.addEventListener('click', () => {
    streamMode = modeSelect.value;
    socket.emit('start-stream', {
      fps: parseInt(fpsSelect.value),
      quality: parseInt(qualitySelect.value),
      monitor: monitorSelect ? parseInt(monitorSelect.value) : 0,
      mode: streamMode,
    });
    streaming = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    placeholder.classList.add('hidden');
    canvas.focus();
    notifyViewportChange();
  });

  stopBtn.addEventListener('click', () => {
    socket.emit('stop-stream');
    streaming = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    placeholder.classList.remove('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  modeSelect.addEventListener('change', () => {
    streamMode = modeSelect.value;
    if (streaming) socket.emit('set-stream-mode', streamMode);
  });

  fpsSelect.addEventListener('change', () => {
    if (streaming) socket.emit('set-fps', parseInt(fpsSelect.value));
  });

  qualitySelect.addEventListener('change', () => {
    if (streaming) socket.emit('set-quality', parseInt(qualitySelect.value));
  });

  fullscreenBtn.addEventListener('click', () => {
    const container = canvas.parentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen();
  });

  screenshotBtn.addEventListener('click', () => {
    socket.emit('get-screenshot', {}, (data) => {
      if (data.error) { showNotification('Screenshot failed: ' + data.error, 'error'); return; }
      const link = document.createElement('a');
      link.href = 'data:image/' + (data.format || 'png') + ';base64,' + data.data;
      link.download = 'screenshot-' + Date.now() + '.' + (data.format || 'png');
      link.click();
      showNotification('Screenshot saved', 'success');
    });
  });

  socket.on('screenshot-result', (data) => {
    if (data.error) { showNotification('Screenshot failed: ' + data.error, 'error'); return; }
    const link = document.createElement('a');
    link.href = 'data:image/' + (data.format || 'png') + ';base64,' + data.data;
    link.download = 'screenshot-' + Date.now() + '.' + (data.format || 'png');
    link.click();
    showNotification('Screenshot saved', 'success');
  });

  // Monitor selection
  socket.emit('get-monitors');
  socket.on('monitors-list', (monitors) => {
    if (!monitorSelect) return;
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

  // Privacy mode — show toast instead of the layout-shrinking banner
  privacyBtn.addEventListener('click', () => {
    socket.emit(privacyActive ? 'privacy-disable' : 'privacy-enable');
  });
  socket.on('privacy-status', (data) => {
    privacyActive = data.active;
    privacyBtn.classList.toggle('active', privacyActive);
    // Keep the hidden banner element in sync (used by server/other code)
    if (privacyBanner) privacyBanner.classList.toggle('hidden', !privacyActive);
    if (privacyActive) {
      showNotification('<i class="fas fa-eye-slash" style="margin-right:6px"></i>Privacy mode ON — host screen is blacked out', 'warning');
    } else {
      showNotification('<i class="fas fa-eye" style="margin-right:6px"></i>Privacy mode OFF — screen visible again', 'success');
    }
  });

  // View-only mode — toggle blocks all input from reaching the server
  if (viewOnlyBtn) {
    viewOnlyBtn.addEventListener('click', () => {
      viewOnlyMode = !viewOnlyMode;
      viewOnlyBtn.classList.toggle('active', viewOnlyMode);
      // Swap icon and label to reflect current state
      viewOnlyBtn.innerHTML = viewOnlyMode
        ? '<i class="fas fa-eye"></i> View Only'
        : '<i class="fas fa-eye"></i> View Only';
      // Keep cursor hidden at all times over the canvas
      if (viewOnlyMode) {
        showNotification('<i class="fas fa-eye" style="margin-right:6px"></i>View-only mode ON — input disabled', 'info');
      } else {
        showNotification('<i class="fas fa-computer-mouse" style="margin-right:6px"></i>View-only mode OFF — input enabled', 'success');
      }
    });
  }

  // ── HD MODE: full JPEG frames ────────────────────────────────────────────────
  const img = new Image();
  img.onload = () => {
    if (streamMode !== 'hd') return;
    canvas.width = img.width;
    canvas.height = img.height;
    screenWidth = img.width;
    screenHeight = img.height;
    ctx.drawImage(img, 0, 0);
    notifyViewportChange(); // §9 — resolution known after first frame
  };
  socket.on('screen-frame', (data) => {
    if (streamMode !== 'hd') return;
    img.src = 'data:image/jpeg;base64,' + data.data;
    if (data.width) screenWidth = data.width;
    if (data.height) screenHeight = data.height;
  });

  // ── EFFICIENT MODE: tile diffs ───────────────────────────────────────────────
  const FMT_RAW_DEFLATE = 0x00;
  const FMT_WEBP = 0x01;
  const HEADER_SIZE = 14;
  const TILE_HEADER_SIZE = 8;

  function ensureCanvasSize(width, height, isKeyframe) {
    if (canvas.width === width && canvas.height === height) return;
    let saved = null;
    if (canvas.width > 0 && canvas.height > 0) {
      saved = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    canvas.width = width;
    canvas.height = height;
    if (saved && !isKeyframe) ctx.putImageData(saved, 0, 0);
    screenWidth = width;
    screenHeight = height;
    notifyViewportChange(); // §9 — resolution updated
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

      if (lastFrameSeq > 0 && frameSeq > lastFrameSeq + 1 && !isKeyframe) {
        socket.emit('request-keyframe');
      }
      lastFrameSeq = frameSeq;
      ensureCanvasSize(width, height, isKeyframe);

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
        for (const tile of tiles) {
          const data = bytes.slice(offset, offset + tile.dataLength);
          offset += tile.dataLength;
          const tileX = tile.col * tileSize;
          const tileY = tile.row * tileSize;
          createImageBitmap(new Blob([data], { type: 'image/webp' }))
            .then((bmp) => { ctx.drawImage(bmp, tileX, tileY); bmp.close && bmp.close(); })
            .catch(() => { });
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

  // ── §10 Mouse events ────────────────────────────────────────────────────────
  // Mouse move is NOT sent to the server — the remote PC cursor does not follow
  // the client's hover. Only clicks, scrolls and drags are transmitted.

  // ── §7 / §10 Mouse down ──────────────────────────────────────────────────────

  canvas.addEventListener('mousedown', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    canvas.focus();

    const pos = clientToNormalized(e.clientX, e.clientY);
    if (!pos) return;

    const button = ['left', 'middle', 'right'][e.button] || 'left';
    isDragging = true;
    dragStartPos = pos;
    lastDragPos = pos;

    socket.emit('mouse-down', { ...pos, button, timestamp: performance.now() });
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();

    const pos = clientToNormalized(e.clientX, e.clientY);
    const button = ['left', 'middle', 'right'][e.button] || 'left';
    const finalPos = pos || lastDragPos || dragStartPos || { x: 0, y: 0 };

    isDragging = false;
    socket.emit('mouse-up', { ...finalPos, button, timestamp: performance.now() });
  });

  canvas.addEventListener('dblclick', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    const pos = clientToNormalized(e.clientX, e.clientY);
    if (!pos) return;
    socket.emit('mouse-click', { ...pos, button: 'left', type: 'double', timestamp: performance.now() });
  });

  canvas.addEventListener('wheel', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    socket.emit('mouse-scroll', { deltaX: e.deltaX, deltaY: e.deltaY, timestamp: performance.now() });
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Global mouseup — release drag if mouse leaves window
  window.addEventListener('mouseup', (e) => {
    if (!streaming || !isDragging || viewOnlyMode) return;
    const pos = clientToNormalized(e.clientX, e.clientY) || lastDragPos || dragStartPos || { x: 0, y: 0 };
    const button = ['left', 'middle', 'right'][e.button] || 'left';
    isDragging = false;
    socket.emit('mouse-up', { ...pos, button, timestamp: performance.now() });
    if (dragStartPos) {
      socket.emit('mouse-drag', {
        startX: dragStartPos.x, startY: dragStartPos.y,
        endX: pos.x, endY: pos.y,
        timestamp: performance.now(),
      });
    }
  });

  // ── Drag & drop files onto the canvas ───────────────────────────────────────
  // Dragging local files over the streaming canvas uploads them to the remote
  // machine's current directory via the files upload API.
  // Shows a drop overlay while dragging so it's visually distinct from remote
  // mouse drag operations (which are pointer events, not HTML5 drag events).

  let dragOverlay = null;

  function createDragOverlay() {
    if (dragOverlay) return;
    dragOverlay = document.createElement('div');
    dragOverlay.id = 'canvas-drop-overlay';
    dragOverlay.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:20',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:12px',
      'background:rgba(0,0,0,0.75)',
      'border:2px dashed rgba(255,255,255,0.5)',
      'color:#f4f4f4',
      'font-family:\'Share Tech Mono\',monospace',
      'font-size:13px', 'letter-spacing:0.1em', 'text-transform:uppercase',
      'pointer-events:none',
    ].join(';');
    dragOverlay.innerHTML = '<i class="fas fa-cloud-upload-alt" style="font-size:36px;opacity:0.7"></i><span>Drop to upload to remote</span>';
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(dragOverlay);
  }

  function removeDragOverlay() {
    if (dragOverlay) { dragOverlay.remove(); dragOverlay = null; }
  }

  canvas.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    createDragOverlay();
  });

  canvas.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  canvas.addEventListener('dragleave', (e) => {
    // Only remove overlay when leaving the canvas itself, not its children
    if (canvas.contains(e.relatedTarget)) return;
    removeDragOverlay();
  });

  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    removeDragOverlay();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    uploadFilesToRemote(files);
  });

  function uploadFilesToRemote(files) {
    // Get the current remote path from the files tab's breadcrumb context,
    // falling back to the home directory on the remote machine.
    const remotePath = (window._remoteCurrentPath) || '';
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) formData.append('files', files[i]);

    const fileNames = Array.from(files).map(f => f.name).join(', ');
    showNotification('<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Uploading: ' + fileNames, 'info');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload?path=' + encodeURIComponent(remotePath));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round(ev.loaded / ev.total * 100);
        // Update the last toast's text live
        const toasts = document.querySelectorAll('#toast-container .toast');
        const last = toasts[toasts.length - 1];
        if (last) last.querySelector('span').innerHTML =
          '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Uploading ' + pct + '%…';
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        showNotification('<i class="fas fa-check" style="margin-right:6px"></i>Uploaded: ' + fileNames, 'success');
      } else {
        showNotification('<i class="fas fa-times" style="margin-right:6px"></i>Upload failed', 'error');
      }
    };
    xhr.onerror = () => showNotification('Upload failed: network error', 'error');
    xhr.send(formData);
  }

  canvas.addEventListener('keydown', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.altKey) modifiers.push('alt');
    if (e.shiftKey) modifiers.push('shift');
    if (e.metaKey) modifiers.push('meta');
    socket.emit('key-press', { key: e.key, code: e.code, modifiers, timestamp: performance.now() });
  });

  canvas.addEventListener('keyup', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    socket.emit('key-release', { key: e.key, code: e.code, timestamp: performance.now() });
  });

  // ── Touch (mobile) ───────────────────────────────────────────────────────────

  let touchStartTime = 0;
  let touchStartPos = null;
  let lastTapTime = 0;
  let touchTimeout = null;

  canvas.addEventListener('touchstart', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    const touch = e.touches[0];
    touchStartPos = touchToNormalized(touch);
    touchStartTime = Date.now();

    if (e.touches.length === 2) {
      if (touchStartPos) socket.emit('mouse-click', { ...touchStartPos, button: 'right', type: 'single', timestamp: performance.now() });
      return;
    }

    touchTimeout = setTimeout(() => {
      isDragging = true;
      dragStartPos = touchStartPos;
      lastDragPos = touchStartPos;
      if (touchStartPos) socket.emit('mouse-down', { ...touchStartPos, button: 'left', timestamp: performance.now() });
    }, 500);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    if (touchTimeout) { clearTimeout(touchTimeout); touchTimeout = null; }
    const pos = touchToNormalized(e.touches[0]);
    if (pos) lastDragPos = pos; // track position for drag release
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!streaming || viewOnlyMode) return;
    e.preventDefault();
    if (touchTimeout) { clearTimeout(touchTimeout); touchTimeout = null; }

    const duration = Date.now() - touchStartTime;
    const now = Date.now();

    if (isDragging) {
      isDragging = false;
      const finalPos = lastDragPos || touchStartPos || { x: 0, y: 0 };
      socket.emit('mouse-up', { ...finalPos, button: 'left', timestamp: performance.now() });
      if (dragStartPos) {
        socket.emit('mouse-drag', {
          startX: dragStartPos.x, startY: dragStartPos.y,
          endX: finalPos.x, endY: finalPos.y,
          timestamp: performance.now(),
        });
      }
      return;
    }

    if (duration < 300 && touchStartPos) {
      if (now - lastTapTime < 300) {
        socket.emit('mouse-click', { ...touchStartPos, button: 'left', type: 'double', timestamp: performance.now() });
      } else {
        socket.emit('mouse-click', { ...touchStartPos, button: 'left', type: 'single', timestamp: performance.now() });
      }
      lastTapTime = now;
    }
  }, { passive: false });

})();

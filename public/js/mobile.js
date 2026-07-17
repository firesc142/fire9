// Mobile-optimized touch controls
(function() {
  let trackpadEnabled = false;
  let keyboardVisible = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTapTime = 0;
  let sensitivity = 1.5;
  let trackpadOverlay = null;
  let hiddenInput = null;

  function isMobileDevice() {
    return window.innerWidth < 768 || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  }

  function init() {
    if (!isMobileDevice()) return;

    createTrackpadOverlay();
    createMobileToolbar();
    createHiddenInput();
  }

  function createTrackpadOverlay() {
    trackpadOverlay = document.createElement('div');
    trackpadOverlay.id = 'mobile-trackpad';
    trackpadOverlay.className = 'mobile-trackpad hidden';
    trackpadOverlay.innerHTML = `
      <div class="trackpad-header">
        <span>Virtual Trackpad</span>
        <button id="trackpad-close" class="btn btn-sm"><i class="fas fa-times"></i></button>
      </div>
      <div class="trackpad-area" id="trackpad-area">
        <p class="trackpad-hint">Drag to move cursor</p>
      </div>
      <div class="trackpad-buttons">
        <button id="tp-left-click" class="btn btn-sm">Left Click</button>
        <button id="tp-right-click" class="btn btn-sm">Right Click</button>
        <button id="tp-keyboard-toggle" class="btn btn-sm"><i class="fas fa-keyboard"></i></button>
      </div>
    `;
    document.body.appendChild(trackpadOverlay);

    // Close button
    document.getElementById('trackpad-close').addEventListener('click', () => {
      trackpadOverlay.classList.add('hidden');
      trackpadEnabled = false;
    });

    // Click buttons
    document.getElementById('tp-left-click').addEventListener('click', () => {
      socket.emit('mouse-click', { button: 'left', type: 'single' });
    });

    document.getElementById('tp-right-click').addEventListener('click', () => {
      socket.emit('mouse-click', { button: 'right', type: 'single' });
    });

    document.getElementById('tp-keyboard-toggle').addEventListener('click', toggleKeyboard);

    // Trackpad touch events
    const area = document.getElementById('trackpad-area');
    let tracking = false;

    area.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      tracking = true;

      // Double-tap detection
      const now = Date.now();
      if (now - lastTapTime < 300) {
        socket.emit('mouse-click', { button: 'left', type: 'double' });
      }
      lastTapTime = now;
    }, { passive: false });

    area.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      e.preventDefault();
      const touch = e.touches[0];
      const deltaX = (touch.clientX - touchStartX) * sensitivity / window.innerWidth;
      const deltaY = (touch.clientY - touchStartY) * sensitivity / window.innerHeight;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      socket.emit('mouse-move-relative', { deltaX, deltaY });
    }, { passive: false });

    area.addEventListener('touchend', (e) => {
      tracking = false;
      // Single finger tap with no movement = click
      if (e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const moved = Math.abs(touch.clientX - touchStartX) + Math.abs(touch.clientY - touchStartY);
        if (moved < 5) {
          socket.emit('mouse-click', { button: 'left', type: 'single' });
        }
      }
    });

    // Two-finger tap = right click
    area.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        socket.emit('mouse-click', { button: 'right', type: 'single' });
      }
    }, { passive: false });

    // Two-finger scroll
    let scrollTracking = false;
    let scrollStartY = 0;

    area.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        scrollTracking = true;
        scrollStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    area.addEventListener('touchmove', (e) => {
      if (scrollTracking && e.touches.length === 2) {
        e.preventDefault();
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const delta = scrollStartY - currentY;
        scrollStartY = currentY;
        socket.emit('mouse-scroll', { deltaX: 0, deltaY: delta * 3 });
      }
    }, { passive: false });

    area.addEventListener('touchend', () => {
      scrollTracking = false;
    });
  }

  function createMobileToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'mobile-toolbar';
    toolbar.innerHTML = `
      <button id="mobile-trackpad-btn" class="btn btn-sm" title="Trackpad">
        <i class="fas fa-hand-pointer"></i>
      </button>
      <button id="mobile-keyboard-btn" class="btn btn-sm" title="Keyboard">
        <i class="fas fa-keyboard"></i>
      </button>
    `;
    document.body.appendChild(toolbar);

    document.getElementById('mobile-trackpad-btn').addEventListener('click', () => {
      trackpadEnabled = !trackpadEnabled;
      trackpadOverlay.classList.toggle('hidden', !trackpadEnabled);
    });

    document.getElementById('mobile-keyboard-btn').addEventListener('click', toggleKeyboard);
  }

  function createHiddenInput() {
    hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.className = 'mobile-hidden-input';
    hiddenInput.autocomplete = 'off';
    hiddenInput.autocapitalize = 'off';
    hiddenInput.autocorrect = 'off';
    hiddenInput.spellcheck = false;
    document.body.appendChild(hiddenInput);

    hiddenInput.addEventListener('input', (e) => {
      const char = e.data;
      if (char) {
        socket.emit('key-type', { text: char });
      }
      hiddenInput.value = '';
    });

    hiddenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        socket.emit('key-press', { key: 'Backspace', modifiers: [] });
        e.preventDefault();
      } else if (e.key === 'Enter') {
        socket.emit('key-press', { key: 'Enter', modifiers: [] });
        e.preventDefault();
      }
    });
  }

  function toggleKeyboard() {
    keyboardVisible = !keyboardVisible;
    if (keyboardVisible) {
      hiddenInput.focus();
    } else {
      hiddenInput.blur();
    }
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

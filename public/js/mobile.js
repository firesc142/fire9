// Mobile-optimized touch controls
(function () {
  let hiddenInput = null;

  function isMobileDevice() {
    return window.innerWidth < 768 || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  }

  function init() {
    if (!isMobileDevice()) return;
    createHiddenInput();
  }

  function createHiddenInput() {
    hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.className = 'mobile-keyboard-input';
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

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Terminal with xterm.js
(function() {
  let term = null;
  let fitAddon = null;
  let terminalStarted = false;

  function initTerminal() {
    if (terminalStarted) return;

    const container = document.getElementById('terminal-container');
    if (!container) return;

    term = new Terminal({
      theme: {
        background:      '#0c0c0c',
        foreground:      '#c8c8c8',
        cursor:          '#ffffff',
        cursorAccent:    '#0c0c0c',
        selection:       'rgba(255, 255, 255, 0.18)',
        /* All 16 ANSI colors — strictly monochrome except status */
        black:           '#0c0c0c',
        red:             '#d94040',
        green:           '#5aad5a',
        yellow:          '#c8a840',
        blue:            '#888888',
        magenta:         '#999999',
        cyan:            '#aaaaaa',
        white:           '#c8c8c8',
        brightBlack:     '#3a3a3a',
        brightRed:       '#e86060',
        brightGreen:     '#70c070',
        brightYellow:    '#d8bc60',
        brightBlue:      '#aaaaaa',
        brightMagenta:   '#bbbbbb',
        brightCyan:      '#cccccc',
        brightWhite:     '#f0f0f0'
      },
      fontSize: 13,
      fontFamily: "'Share Tech Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      lineHeight: 1.45,
      letterSpacing: 0.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);
    fitAddon.fit();

    // Send input to server
    term.onData((data) => {
      socket.emit('terminal-input', { data });
    });

    // Request terminal start
    socket.emit('terminal-start', {
      cols: term.cols,
      rows: term.rows
    });

    terminalStarted = true;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && term) {
        fitAddon.fit();
        socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
      }
    });
    resizeObserver.observe(container);
  }

  // Listen for terminal output from server
  socket.on('terminal-output', (msg) => {
    if (term) {
      term.write(msg.data || msg);
    }
  });

  // Terminal exit
  socket.on('terminal-exit', (info) => {
    if (term) {
      term.write('\r\n\x1b[31m--- Terminal exited ---\x1b[0m\r\n');
      term.write('\x1b[33mPress any key to restart...\x1b[0m\r\n');
      terminalStarted = false;

      const disposable = term.onKey(() => {
        disposable.dispose();
        term.clear();
        socket.emit('terminal-start', { cols: term.cols, rows: term.rows });
        terminalStarted = true;
      });
    }
  });

  // Terminal error
  socket.on('terminal-error', (info) => {
    if (term) {
      term.write('\r\n\x1b[31mError: ' + (info.error || info) + '\x1b[0m\r\n');
    }
  });

  // Tab activation listener
  document.querySelector('[data-tab="terminal"]').addEventListener('click', () => {
    setTimeout(() => {
      if (!terminalStarted) {
        initTerminal();
      } else if (fitAddon) {
        fitAddon.fit();
      }
    }, 100);
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (fitAddon && term && terminalStarted) {
      fitAddon.fit();
      socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
    }
  });

})();

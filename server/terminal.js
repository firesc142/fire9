const { spawn } = require('child_process');
const os = require('os');

const terminals = new Map();

function handleConnection(socket) {
  socket.on('terminal-start', (options = {}) => {
    try {
      if (terminals.has(socket.id)) {
        socket.emit('terminal-error', { error: 'Terminal already running' });
        return;
      }

      const shell = spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
        cwd: process.env.USERPROFILE || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      terminals.set(socket.id, shell);

      shell.stdout.on('data', (data) => {
        socket.emit('terminal-output', { data: data.toString() });
      });

      shell.stderr.on('data', (data) => {
        socket.emit('terminal-output', { data: data.toString() });
      });

      shell.on('exit', (code) => {
        terminals.delete(socket.id);
        socket.emit('terminal-exit', { code });
      });

      shell.on('error', (err) => {
        terminals.delete(socket.id);
        socket.emit('terminal-error', { error: err.message });
      });

      socket.emit('terminal-ready', { pid: shell.pid });
    } catch (err) {
      socket.emit('terminal-error', { error: err.message });
    }
  });

  socket.on('terminal-input', ({ data }) => {
    const shell = terminals.get(socket.id);
    if (shell && shell.stdin.writable) {
      shell.stdin.write(data);
    }
  });

  socket.on('terminal-resize', ({ cols, rows }) => {
    // Resize not supported without node-pty/ConPTY
    // Terminal will work but won't reflow on resize
  });

  socket.on('terminal-stop', () => {
    const shell = terminals.get(socket.id);
    if (shell) {
      shell.kill();
      terminals.delete(socket.id);
    }
  });

  socket.on('disconnect', () => {
    const shell = terminals.get(socket.id);
    if (shell) {
      shell.kill();
      terminals.delete(socket.id);
    }
  });
}

module.exports = { handleConnection };

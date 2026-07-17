const screenshot = require('screenshot-desktop');
const monitors = require('./monitors');
const efficientStream = require('./efficient-stream');

let koffi = null;
let user32 = null;
let kernel32 = null;

try {
  koffi = require('koffi');
  user32 = koffi.load('user32.dll');
  kernel32 = koffi.load('kernel32.dll');
} catch (err) {
  console.warn('[screen] Failed to load koffi or system DLLs. Native input emulation will not be available:', err.message);
}


const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const WHEEL_DELTA = 120;

let SetCursorPos = null;
let GetSystemMetrics = null;
let POINT = null;
let GetCursorPos = null;
let MOUSEINPUT = null;
let KEYBDINPUT = null;
let INPUT_union = null;
let INPUT = null;

if (koffi && user32) {
  try {
    SetCursorPos = user32.func('bool SetCursorPos(int x, int y)');
    GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');

    POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
    GetCursorPos = user32.func('bool GetCursorPos(_Out_ POINT *lpPoint)');

    MOUSEINPUT = koffi.struct('MOUSEINPUT', {
      dx: 'int32',
      dy: 'int32',
      mouseData: 'uint32',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });

    KEYBDINPUT = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });

    INPUT_union = koffi.union('INPUT_union', {
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
    });

    INPUT = koffi.struct('INPUT', {
      type: 'uint32',
      _padding: koffi.array('uint8', 4),
      u: INPUT_union,
    });
  } catch (err) {
    console.error('[screen] Failed to build Windows structs and functions:', err.message);
  }
}


let SendInput = null;
if (user32) {
  try {
    SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
  } catch (e) {
    SendInput = null;
  }
}


const VK_MAP = {
  'Enter': 0x0D, 'Tab': 0x09, 'Escape': 0x1B, 'Backspace': 0x08,
  'Delete': 0x2E, 'Insert': 0x2D, 'Home': 0x24, 'End': 0x23,
  'PageUp': 0x21, 'PageDown': 0x22, 'Space': 0x20,
  'ArrowUp': 0x26, 'ArrowDown': 0x28, 'ArrowLeft': 0x25, 'ArrowRight': 0x27,
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
  'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
  'CapsLock': 0x14, 'NumLock': 0x90, 'ScrollLock': 0x91,
  'PrintScreen': 0x2C, 'Pause': 0x13,
  'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
  'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
  'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
  's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
  'y': 0x59, 'z': 0x5A,
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD,
  '\\': 0xDC, ';': 0xBA, "'": 0xDE,
  ',': 0xBC, '.': 0xBE, '/': 0xBF, '`': 0xC0,
};

const MODIFIER_VK = {
  'ctrl': 0x11, 'alt': 0x12, 'shift': 0x10, 'meta': 0x5B,
};

function sendKeyDown(vk) {
  if (!SendInput) return;
  const input = { type: INPUT_KEYBOARD, _padding: [0,0,0,0], u: { ki: { wVk: vk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

function sendKeyUp(vk) {
  if (!SendInput) return;
  const input = { type: INPUT_KEYBOARD, _padding: [0,0,0,0], u: { ki: { wVk: vk, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

function sendMouseClick(button, down) {
  if (!SendInput) return;
  let flags = 0;
  if (button === 'left') flags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  else if (button === 'right') flags = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  else if (button === 'middle') flags = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  const input = { type: INPUT_MOUSE, _padding: [0,0,0,0], u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

function sendMouseWheel(delta) {
  if (!SendInput) return;
  const input = { type: INPUT_MOUSE, _padding: [0,0,0,0], u: { mi: { dx: 0, dy: 0, mouseData: delta, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

function handleConnection(socket) {
  let captureInterval = null;
  let fps = 30;
  let quality = 60;
  let streaming = false;
  let pendingFrame = false;
  let streamMode = 'efficient'; // 'hd' or 'efficient'

  function startCapture() {
    if (captureInterval) return;
    streaming = true;
    const interval = Math.floor(1000 / fps);

    captureInterval = setInterval(async () => {
      if (pendingFrame) return;
      try {
        const monitorId = monitors.getActiveMonitor();
        const opts = { format: 'jpg', quality };
        if (monitorId !== null && monitorId !== undefined) {
          opts.screen = monitorId;
        }
        const imgBuffer = await screenshot(opts);
        const bounds = monitors.getMonitorBounds(monitorId);
        pendingFrame = true;
        socket.emit('screen-frame', {
          data: imgBuffer.toString('base64'),
          timestamp: Date.now(),
          width: bounds.width,
          height: bounds.height,
        }, () => {
          pendingFrame = false;
        });
        setTimeout(() => { pendingFrame = false; }, 500);
      } catch (err) {
        console.error('Screen capture error:', err.message);
      }
    }, interval);
  }

  function stopCapture() {
    streaming = false;
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
  }

  function startStream() {
    streaming = true;
    if (streamMode === 'efficient') {
      efficientStream.start(socket, { fps, quality });
    } else {
      startCapture();
    }
  }

  function stopStream() {
    stopCapture();
    efficientStream.stop();
    streaming = false;
  }

  socket.on('start-stream', (opts) => {
    if (opts && opts.fps) fps = Math.min(60, Math.max(1, opts.fps));
    if (opts && opts.quality) quality = Math.min(100, Math.max(1, opts.quality));
    if (opts && opts.mode) streamMode = opts.mode === 'hd' ? 'hd' : 'efficient';
    startStream();
  });

  socket.on('stop-stream', () => { stopStream(); });

  socket.on('set-stream-mode', (mode) => {
    const newMode = mode === 'hd' ? 'hd' : 'efficient';
    if (newMode === streamMode) return;
    streamMode = newMode;
    if (streaming) {
      stopStream();
      startStream();
    }
  });

  socket.on('set-fps', (newFps) => {
    fps = Math.min(60, Math.max(1, newFps));
    if (streaming) {
      if (streamMode === 'hd') {
        stopCapture();
        startCapture();
      } else {
        efficientStream.stop();
        efficientStream.start(socket, { fps, quality });
      }
    }
  });

  socket.on('set-quality', (newQuality) => {
    quality = Math.min(100, Math.max(1, newQuality));
    if (streaming && streamMode === 'efficient') {
      efficientStream.stop();
      efficientStream.start(socket, { fps, quality });
    }
  });

  socket.on('mouse-move', (data) => {
    try {
      if (!SetCursorPos) return;
      const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
      const x = Math.round(data.x * bounds.width) + (bounds.x || 0);
      const y = Math.round(data.y * bounds.height) + (bounds.y || 0);
      SetCursorPos(x, y);
    } catch (err) {
      console.error('Mouse move error:', err.message);
    }
  });

  socket.on('mouse-move-relative', (data) => {
    try {
      if (!GetCursorPos || !SetCursorPos) return;
      const point = { x: 0, y: 0 };
      GetCursorPos(point);
      const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
      const dx = Math.round(data.deltaX * bounds.width);
      const dy = Math.round(data.deltaY * bounds.height);
      SetCursorPos(point.x + dx, point.y + dy);
    } catch (err) {
      console.error('Mouse move relative error:', err.message);
    }
  });


  socket.on('mouse-down', (data) => {
    try {
      const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
      const x = Math.round(data.x * bounds.width) + (bounds.x || 0);
      const y = Math.round(data.y * bounds.height) + (bounds.y || 0);
      SetCursorPos(x, y);
      sendMouseClick(data.button || 'left', true);
    } catch (err) {
      console.error('Mouse down error:', err.message);
    }
  });

  socket.on('mouse-up', (data) => {
    try {
      const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
      const x = Math.round(data.x * bounds.width) + (bounds.x || 0);
      const y = Math.round(data.y * bounds.height) + (bounds.y || 0);
      SetCursorPos(x, y);
      sendMouseClick(data.button || 'left', false);
    } catch (err) {
      console.error('Mouse up error:', err.message);
    }
  });

  socket.on('mouse-click', (data) => {
    try {
      if (data.x !== undefined && data.y !== undefined) {
        const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
        const x = Math.round(data.x * bounds.width) + (bounds.x || 0);
        const y = Math.round(data.y * bounds.height) + (bounds.y || 0);
        SetCursorPos(x, y);
      }
      const button = data.button || 'left';
      sendMouseClick(button, true);
      sendMouseClick(button, false);
      if (data.type === 'double') {
        sendMouseClick(button, true);
        sendMouseClick(button, false);
      }
    } catch (err) {
      console.error('Mouse click error:', err.message);
    }
  });

  socket.on('mouse-scroll', (data) => {
    try {
      if (data.deltaY) {
        const delta = data.deltaY > 0 ? -WHEEL_DELTA : WHEEL_DELTA;
        sendMouseWheel(delta);
      }
    } catch (err) {
      console.error('Mouse scroll error:', err.message);
    }
  });

  socket.on('mouse-drag', (data) => {
    try {
      const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
      const startX = Math.round(data.startX * bounds.width) + (bounds.x || 0);
      const startY = Math.round(data.startY * bounds.height) + (bounds.y || 0);
      const endX = Math.round(data.endX * bounds.width) + (bounds.x || 0);
      const endY = Math.round(data.endY * bounds.height) + (bounds.y || 0);
      SetCursorPos(startX, startY);
      sendMouseClick('left', true);
      SetCursorPos(endX, endY);
      sendMouseClick('left', false);
    } catch (err) {
      console.error('Mouse drag error:', err.message);
    }
  });

  socket.on('key-press', (data) => {
    try {
      const vk = VK_MAP[data.key] || VK_MAP[data.key.toLowerCase()];
      if (!vk) return;
      const modifiers = (data.modifiers || []).map(m => MODIFIER_VK[m]).filter(Boolean);
      modifiers.forEach(m => sendKeyDown(m));
      sendKeyDown(vk);
      sendKeyUp(vk);
      modifiers.reverse().forEach(m => sendKeyUp(m));
    } catch (err) {
      console.error('Key press error:', err.message);
    }
  });

  socket.on('key-release', (data) => {
    try {
      const vk = VK_MAP[data.key] || VK_MAP[data.key.toLowerCase()];
      if (vk) sendKeyUp(vk);
    } catch (err) {
      console.error('Key release error:', err.message);
    }
  });

  socket.on('key-type', (data) => {
    try {
      if (!data.text || !SendInput) return;
      for (const char of data.text) {
        const code = char.charCodeAt(0);
        const down = { type: INPUT_KEYBOARD, _padding: [0,0,0,0], u: { ki: { wVk: 0, wScan: code, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } } };
        const up = { type: INPUT_KEYBOARD, _padding: [0,0,0,0], u: { ki: { wVk: 0, wScan: code, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } };
        SendInput(1, [down], koffi.sizeof(INPUT));
        SendInput(1, [up], koffi.sizeof(INPUT));
      }
    } catch (err) {
      console.error('Key type error:', err.message);
    }
  });

  socket.on('get-screenshot', async (opts, callback) => {
    try {
      const monitorId = monitors.getActiveMonitor();
      const captureOpts = { format: 'png' };
      if (monitorId !== null && monitorId !== undefined) {
        captureOpts.screen = monitorId;
      }
      const imgBuffer = await screenshot(captureOpts);
      const bounds = monitors.getMonitorBounds(monitorId);
      const result = {
        data: imgBuffer.toString('base64'),
        format: 'png',
        width: bounds.width,
        height: bounds.height,
        timestamp: Date.now(),
      };
      if (typeof callback === 'function') callback(result);
      else socket.emit('screenshot-result', result);
    } catch (err) {
      console.error('Screenshot error:', err.message);
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  socket.on('disconnect', () => { stopStream(); });
}

module.exports = { handleConnection };

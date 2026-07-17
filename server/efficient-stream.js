const zlib = require('zlib');
const captureGdi = require('./capture-gdi');
const captureNs = require('./capture-ns');
const tileDiff = require('./tile-diff');
const monitors = require('./monitors');

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (err) {
  console.warn('[efficient-stream] sharp unavailable, falling back to deflate tiles:', err.message);
  sharp = null;
}

const MSG_DIFF = 0x01;
const MSG_KEYFRAME = 0x02;

const FMT_RAW_DEFLATE = 0x00; // legacy: zlib-deflated RGB, client decodes with pako
const FMT_WEBP = 0x01;        // per-tile WebP image, client decodes with createImageBitmap

const KEYFRAME_INTERVAL = 5000;
// Frame header layout:
//   0      msgType   (uint8)
//   1      format    (uint8)   frame-level codec for all tiles
//   2..5   frameSeq  (uint32LE)
//   6..7   width     (uint16LE)
//   8..9   height    (uint16LE)
//   10..11 tileSize  (uint16LE)
//   12..13 tileCount (uint16LE)
const HEADER_SIZE = 14;
const TILE_HEADER_SIZE = 8; // col(uint16) row(uint16) dataLength(uint32)

// Adaptive framerate (mirrors 9remote streaming config)
const IDLE_INTERVAL = 400;
const IDLE_THRESHOLD = 3;
const WEBP_EFFORT = 0;

let timer = null;
let state = null;
let frameSeq = 0;
let lastKeyframe = 0;
let pendingFrame = false;
let currentFps = 15;
let quality = 50;
let active = false;
let currentSocket = null;
let keyframeHandler = null;
let lastMonitorId = null;
let idleFrameCount = 0;
let useNative = false; // true = node-screenshots (RGBA), false = GDI (BGRA)
let streamGen = 0;

function capture() {
  return useNative ? captureNs : captureGdi;
}

function start(socket, options = {}) {
  if (active) stop();

  currentFps = Math.min(30, Math.max(1, options.fps || 15));
  if (options.quality) quality = Math.min(100, Math.max(1, options.quality));
  currentSocket = socket;

  const monitorId = monitors.getActiveMonitor();
  const bounds = monitors.getMonitorBounds(monitorId);

  useNative = captureNs.isAvailable() && !!sharp;
  capture().initCapture(bounds.width, bounds.height, bounds.x, bounds.y);
  state = tileDiff.init(bounds.width, bounds.height);
  frameSeq = 0;
  lastKeyframe = 0;
  lastMonitorId = monitorId;
  pendingFrame = false;
  idleFrameCount = 0;
  active = true;
  streamGen++;
  const gen = streamGen;

  keyframeHandler = () => {
    if (active) sendKeyframe(socket);
  };
  socket.on('request-keyframe', keyframeHandler);

  sendKeyframe(socket);

  const loop = async () => {
    if (!active || streamGen !== gen || !socket.connected) return;
    const startedAt = Date.now();
    if (!pendingFrame) {
      await captureAndSend(socket, false);
    }
    if (!active || streamGen !== gen || !socket.connected) return;
    const interval = idleFrameCount >= IDLE_THRESHOLD
      ? IDLE_INTERVAL
      : Math.floor(1000 / currentFps);
    const wait = Math.max(0, interval - (Date.now() - startedAt));
    timer = setTimeout(loop, wait);
  };
  loop();
}

function stop() {
  active = false;
  streamGen++;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (currentSocket && keyframeHandler) {
    currentSocket.removeListener('request-keyframe', keyframeHandler);
    keyframeHandler = null;
  }
  currentSocket = null;
  if (useNative) captureNs.releaseCapture();
  else captureGdi.releaseCapture();
  state = null;
}

function setMonitor(socket, monitorId) {
  if (!active) return;
  const bounds = monitors.getMonitorBounds(monitorId);
  const changed = capture().reinitForMonitor(useNative ? bounds : monitorId);
  if (changed) {
    state = tileDiff.init(bounds.width, bounds.height);
    sendKeyframe(socket);
  }
}

function sendKeyframe(socket) {
  captureAndSend(socket, true);
  lastKeyframe = Date.now();
}

async function encodeTile(frame, tileIdx, width, height) {
  if (useNative && sharp) {
    const { rgba, tileW, tileH } = tileDiff.extractTileRGBA(frame, tileIdx, width, height, state.cols);
    const webp = await sharp(rgba, { raw: { width: tileW, height: tileH, channels: 4 } })
      .webp({ quality, effort: WEBP_EFFORT, alphaQuality: 100 })
      .toBuffer();
    return { data: webp, format: FMT_WEBP };
  }
  // Legacy GDI path: BGRA -> RGB -> deflate
  const { rgb } = tileDiff.extractTileRGB(frame, tileIdx, width, height, state.cols);
  return { data: zlib.deflateSync(rgb, { level: 1 }), format: FMT_RAW_DEFLATE };
}

async function captureAndSend(socket, forceKeyframe) {
  try {
    const currentMonitor = monitors.getActiveMonitor();
    if (currentMonitor !== lastMonitorId) {
      lastMonitorId = currentMonitor;
      const bounds = monitors.getMonitorBounds(currentMonitor);
      capture().initCapture(bounds.width, bounds.height, bounds.x, bounds.y);
      state = tileDiff.init(bounds.width, bounds.height);
      forceKeyframe = true;
    }

    const frame = capture().captureFrame();
    if (!frame) return; // capture not available

    const width = capture().getWidth();
    const height = capture().getHeight();

    // Capture dimensions can lag a monitor switch; resync tile state if so.
    if (width !== state.width || height !== state.height) {
      state = tileDiff.init(width, height);
      forceKeyframe = true;
    }

    const now = Date.now();
    const isKeyframe = forceKeyframe || (now - lastKeyframe >= KEYFRAME_INTERVAL);

    let dirtyTiles;
    if (isKeyframe) {
      dirtyTiles = tileDiff.getAllTileIndices(state);
      state.initialized = false;
      tileDiff.findDirtyTiles(frame, state);
      lastKeyframe = now;
    } else {
      dirtyTiles = tileDiff.findDirtyTiles(frame, state);
    }

    if (dirtyTiles.length === 0) {
      idleFrameCount++;
      return;
    }
    idleFrameCount = 0;

    const encoded = await Promise.all(
      dirtyTiles.map((tileIdx) => encodeTile(frame, tileIdx, width, height))
    );

    if (!active || !socket.connected) return;

    frameSeq++;
    const msgType = isKeyframe ? MSG_KEYFRAME : MSG_DIFF;
    const frameFormat = useNative && sharp ? FMT_WEBP : FMT_RAW_DEFLATE;

    const tileCount = dirtyTiles.length;
    const headerSection = HEADER_SIZE + tileCount * TILE_HEADER_SIZE;
    const totalDataSize = encoded.reduce((sum, e) => sum + e.data.length, 0);
    const message = Buffer.allocUnsafe(headerSection + totalDataSize);

    message.writeUInt8(msgType, 0);
    message.writeUInt8(frameFormat, 1);
    message.writeUInt32LE(frameSeq, 2);
    message.writeUInt16LE(width, 6);
    message.writeUInt16LE(height, 8);
    message.writeUInt16LE(tileDiff.TILE_SIZE, 10);
    message.writeUInt16LE(tileCount, 12);

    let offset = HEADER_SIZE;
    for (let i = 0; i < tileCount; i++) {
      const tileIdx = dirtyTiles[i];
      const col = tileIdx % state.cols;
      const row = Math.floor(tileIdx / state.cols);
      message.writeUInt16LE(col, offset);
      message.writeUInt16LE(row, offset + 2);
      message.writeUInt32LE(encoded[i].data.length, offset + 4);
      offset += TILE_HEADER_SIZE;
    }

    for (const e of encoded) {
      e.data.copy(message, offset);
      offset += e.data.length;
    }

    pendingFrame = true;
    socket.volatile.emit('screen-tiles', message, () => {
      pendingFrame = false;
    });
    setTimeout(() => { pendingFrame = false; }, 500);

  } catch (err) {
    console.error('Efficient stream error:', err.message);
    pendingFrame = false;
  }
}

function isActive() { return active; }

module.exports = { start, stop, setMonitor };

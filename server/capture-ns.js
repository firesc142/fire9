// node-screenshots capture wrapper. Mirrors capture-gdi.js so efficient-stream
// can use either. Returns raw RGBA (Windows native order) suitable for sharp.
let Monitor = null;

try {
  const ns = require('node-screenshots');
  Monitor = ns.Monitor || (ns.default && ns.default.Monitor) || null;
  if (!Monitor) throw new Error('Monitor export not found');
} catch (err) {
  console.warn('[capture-ns] node-screenshots unavailable, native capture disabled:', err.message);
  Monitor = null;
}

let selectedMonitor = null;
let captureWidth = 0;
let captureHeight = 0;
let targetBounds = null;

function isAvailable() {
  return !!Monitor;
}

// Pick the node-screenshots Monitor whose position best matches the requested bounds.
function pickMonitor(bounds) {
  const all = Monitor.all();
  if (!all || all.length === 0) return null;
  if (bounds) {
    const exact = all.find(m => m.x === bounds.x && m.y === bounds.y);
    if (exact) return exact;
  }
  const primary = all.find(m => m.isPrimary);
  return primary || all[0];
}

function initCapture(width, height, offsetX, offsetY) {
  if (!Monitor) return false;
  targetBounds = { x: offsetX || 0, y: offsetY || 0, width, height };
  selectedMonitor = pickMonitor(targetBounds);
  if (!selectedMonitor) return false;
  captureWidth = selectedMonitor.width;
  captureHeight = selectedMonitor.height;
  return true;
}

// Returns RGBA Buffer for the selected monitor, or null if unavailable.
function captureFrame() {
  if (!Monitor) return null;
  if (!selectedMonitor) {
    if (!initCapture(captureWidth, captureHeight, targetBounds ? targetBounds.x : 0, targetBounds ? targetBounds.y : 0)) {
      return null;
    }
  }
  try {
    const image = selectedMonitor.captureImageSync();
    captureWidth = image.width;
    captureHeight = image.height;
    return image.toRawSync();
  } catch (err) {
    console.error('[capture-ns] captureFrame error:', err.message);
    // Monitor handle may be stale (resolution/topology change) — force re-pick next call.
    selectedMonitor = null;
    return null;
  }
}

function reinitForMonitor(bounds) {
  if (!bounds) return false;
  const changed = !targetBounds || bounds.x !== targetBounds.x || bounds.y !== targetBounds.y ||
    bounds.width !== targetBounds.width || bounds.height !== targetBounds.height;
  if (changed) {
    initCapture(bounds.width, bounds.height, bounds.x, bounds.y);
    return true;
  }
  return false;
}

function releaseCapture() {
  selectedMonitor = null;
  targetBounds = null;
}

function getWidth() { return captureWidth; }
function getHeight() { return captureHeight; }

module.exports = { isAvailable, initCapture, captureFrame, reinitForMonitor, releaseCapture, getWidth, getHeight };

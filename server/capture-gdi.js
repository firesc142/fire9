const monitors = require('./monitors');

let koffi = null;
let gdi32 = null;
let user32 = null;

try {
  koffi = require('koffi');
  gdi32 = koffi.load('gdi32.dll');
  user32 = koffi.load('user32.dll');
} catch (err) {
  console.warn('[capture-gdi] Failed to load koffi or system DLLs. GDI capturing will not be available:', err.message);
}

const SRCCOPY = 0x00CC0020;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;

let BITMAPINFOHEADER = null;
let BITMAPINFO = null;
let GetDC = null;
let ReleaseDC = null;
let CreateCompatibleDC = null;
let CreateCompatibleBitmap = null;
let SelectObject = null;
let BitBlt = null;
let GetDIBits = null;
let DeleteObject = null;
let DeleteDC = null;

if (koffi && gdi32 && user32) {
  try {
    BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
      biSize: 'uint32',
      biWidth: 'int32',
      biHeight: 'int32',
      biPlanes: 'uint16',
      biBitCount: 'uint16',
      biCompression: 'uint32',
      biSizeImage: 'uint32',
      biXPelsPerMeter: 'int32',
      biYPelsPerMeter: 'int32',
      biClrUsed: 'uint32',
      biClrImportant: 'uint32',
    });

    BITMAPINFO = koffi.struct('BITMAPINFO', {
      bmiHeader: BITMAPINFOHEADER,
      bmiColors: koffi.array('uint8', 4),
    });

    GetDC = user32.func('intptr GetDC(intptr hWnd)');
    ReleaseDC = user32.func('int ReleaseDC(intptr hWnd, intptr hDC)');
    CreateCompatibleDC = gdi32.func('intptr CreateCompatibleDC(intptr hdc)');
    CreateCompatibleBitmap = gdi32.func('intptr CreateCompatibleBitmap(intptr hdc, int cx, int cy)');
    SelectObject = gdi32.func('intptr SelectObject(intptr hdc, intptr h)');
    BitBlt = gdi32.func('bool BitBlt(intptr hdc, int x, int y, int cx, int cy, intptr hdcSrc, int x1, int y1, uint32 rop)');
    GetDIBits = gdi32.func('int GetDIBits(intptr hdc, intptr hbm, uint32 start, uint32 cLines, _Out_ uint8 *lpvBits, _Inout_ BITMAPINFO *lpbmi, uint32 usage)');
    DeleteObject = gdi32.func('bool DeleteObject(intptr ho)');
    DeleteDC = gdi32.func('bool DeleteDC(intptr hdc)');
  } catch (err) {
    console.error('[capture-gdi] Failed to declare GDI structures/functions:', err.message);
  }
}


let desktopDC = null;
let memDC = null;
let bitmap = null;
let oldBitmap = null;
let pixelBuffer = null;
let captureWidth = 0;
let captureHeight = 0;
let captureOffsetX = 0;
let captureOffsetY = 0;
let initialized = false;

function initCapture(width, height, offsetX, offsetY) {
  if (!GetDC || !CreateCompatibleDC || !CreateCompatibleBitmap || !SelectObject) {
    console.warn('[capture-gdi] Cannot initialize capture: native GDI functions are not loaded.');
    return;
  }
  releaseCapture();

  captureWidth = width;
  captureHeight = height;
  captureOffsetX = offsetX || 0;
  captureOffsetY = offsetY || 0;

  desktopDC = GetDC(0);
  memDC = CreateCompatibleDC(desktopDC);
  bitmap = CreateCompatibleBitmap(desktopDC, width, height);
  oldBitmap = SelectObject(memDC, bitmap);
  pixelBuffer = Buffer.alloc(width * height * 4);
  initialized = true;
}

function captureFrame() {
  if (!BitBlt || !GetDIBits) {
    console.warn('[capture-gdi] Cannot capture frame: native GDI functions are not loaded.');
    return null;
  }
  if (!initialized) {
    const bounds = monitors.getMonitorBounds(monitors.getActiveMonitor());
    initCapture(bounds.width, bounds.height, bounds.x, bounds.y);
  }
  if (!initialized) return null;

  BitBlt(memDC, 0, 0, captureWidth, captureHeight, desktopDC, captureOffsetX, captureOffsetY, SRCCOPY);

  const bmi = {
    bmiHeader: {
      biSize: 40,
      biWidth: captureWidth,
      biHeight: -captureHeight, // negative = top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB,
      biSizeImage: captureWidth * captureHeight * 4,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0,
    },
    bmiColors: [0, 0, 0, 0],
  };

  GetDIBits(memDC, bitmap, 0, captureHeight, pixelBuffer, bmi, DIB_RGB_COLORS);
  return pixelBuffer;
}

function reinitForMonitor(monitorId) {
  const bounds = monitors.getMonitorBounds(monitorId);
  if (bounds.width !== captureWidth || bounds.height !== captureHeight ||
      bounds.x !== captureOffsetX || bounds.y !== captureOffsetY) {
    initCapture(bounds.width, bounds.height, bounds.x, bounds.y);
    return true;
  }
  return false;
}

function releaseCapture() {
  if (!initialized) return;
  try {
    if (oldBitmap && memDC && SelectObject) SelectObject(memDC, oldBitmap);
    if (bitmap && DeleteObject) DeleteObject(bitmap);
    if (memDC && DeleteDC) DeleteDC(memDC);
    if (desktopDC && ReleaseDC) ReleaseDC(0, desktopDC);
  } catch (err) {
    console.error('GDI cleanup error:', err.message);
  }
  desktopDC = null;
  memDC = null;
  bitmap = null;
  oldBitmap = null;
  pixelBuffer = null;
  initialized = false;
}

function getWidth() { return captureWidth; }
function getHeight() { return captureHeight; }

module.exports = { initCapture, captureFrame, reinitForMonitor, releaseCapture, getWidth, getHeight };

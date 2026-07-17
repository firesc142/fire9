const TILE_SIZE = 256;

function init(width, height) {
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const totalTiles = cols * rows;
  return {
    cols,
    rows,
    width,
    height,
    checksums: new Uint32Array(totalTiles),
    initialized: false,
  };
}

function computeChecksum(buffer, offset, stride, tileW, tileH) {
  let hash = 0;
  for (let row = 0; row < tileH; row += 2) {
    const rowStart = offset + row * stride;
    for (let col = 0; col < tileW * 4; col += 16) {
      const idx = rowStart + col;
      if (idx + 3 < buffer.length) {
        const val = buffer[idx] | (buffer[idx + 1] << 8) | (buffer[idx + 2] << 16) | (buffer[idx + 3] << 24);
        hash = ((hash << 5) | (hash >>> 27)) ^ val;
      }
    }
  }
  return hash >>> 0;
}

function findDirtyTiles(frameBuffer, state) {
  const { cols, rows, width, height, checksums } = state;
  const stride = width * 4;
  const dirty = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileIdx = row * cols + col;
      const offsetX = col * TILE_SIZE;
      const offsetY = row * TILE_SIZE;
      const tileW = Math.min(TILE_SIZE, width - offsetX);
      const tileH = Math.min(TILE_SIZE, height - offsetY);
      const bufferOffset = offsetY * stride + offsetX * 4;

      const checksum = computeChecksum(frameBuffer, bufferOffset, stride, tileW, tileH);

      if (!state.initialized || checksum !== checksums[tileIdx]) {
        checksums[tileIdx] = checksum;
        dirty.push(tileIdx);
      }
    }
  }

  state.initialized = true;
  return dirty;
}

function extractTileRGB(frameBuffer, tileIdx, width, height, cols) {
  const col = tileIdx % cols;
  const row = Math.floor(tileIdx / cols);
  const offsetX = col * TILE_SIZE;
  const offsetY = row * TILE_SIZE;
  const tileW = Math.min(TILE_SIZE, width - offsetX);
  const tileH = Math.min(TILE_SIZE, height - offsetY);
  const stride = width * 4;

  // BGRA → RGB conversion
  const rgb = Buffer.alloc(tileW * tileH * 3);
  let writeIdx = 0;

  for (let y = 0; y < tileH; y++) {
    const rowStart = (offsetY + y) * stride + offsetX * 4;
    for (let x = 0; x < tileW; x++) {
      const px = rowStart + x * 4;
      rgb[writeIdx] = frameBuffer[px + 2];     // R (from BGRA B=0,G=1,R=2,A=3)
      rgb[writeIdx + 1] = frameBuffer[px + 1]; // G
      rgb[writeIdx + 2] = frameBuffer[px];     // B
      writeIdx += 3;
    }
  }

  return { rgb, tileW, tileH };
}

// Extract a tile as raw RGBA (no channel swap) for sharp/WebP encoding.
// Input buffer is already RGBA (node-screenshots on Windows).
function extractTileRGBA(frameBuffer, tileIdx, width, height, cols) {
  const col = tileIdx % cols;
  const row = Math.floor(tileIdx / cols);
  const offsetX = col * TILE_SIZE;
  const offsetY = row * TILE_SIZE;
  const tileW = Math.min(TILE_SIZE, width - offsetX);
  const tileH = Math.min(TILE_SIZE, height - offsetY);
  const stride = width * 4;
  const rowBytes = tileW * 4;

  const rgba = Buffer.allocUnsafe(tileW * tileH * 4);
  let writeIdx = 0;
  for (let y = 0; y < tileH; y++) {
    const rowStart = (offsetY + y) * stride + offsetX * 4;
    frameBuffer.copy(rgba, writeIdx, rowStart, rowStart + rowBytes);
    writeIdx += rowBytes;
  }
  return { rgba, tileW, tileH };
}

function getAllTileIndices(state) {
  const total = state.cols * state.rows;
  const indices = [];
  for (let i = 0; i < total; i++) indices.push(i);
  return indices;
}

module.exports = { TILE_SIZE, init, findDirtyTiles, extractTileRGB, extractTileRGBA, getAllTileIndices };

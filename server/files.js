const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const multer = require('multer');
const archiver = require('archiver');
const { execSync } = require('child_process');

let uploadDestination = os.homedir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDestination);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });

function isPathSafe(requestedPath) {
  const resolved = path.resolve(requestedPath);
  const drive = resolved.split(path.sep)[0] + path.sep;
  return resolved.startsWith(drive);
}

router.get('/list', async (req, res) => {
  try {
    const dirPath = req.query.path || os.homedir();
    const resolved = path.resolve(dirPath);

    if (!isPathSafe(resolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(resolved, entry.name);
        const entryStat = await fs.stat(fullPath);
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
          extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1)
        });
      } catch {
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: 0,
          modified: null,
          extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1)
        });
      }
    }

    items.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: resolved, items });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/download', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const resolved = path.resolve(filePath);
    if (!isPathSafe(resolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      const folderName = path.basename(resolved);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.on('error', (err) => {
        res.status(500).json({ error: err.message });
      });
      archive.pipe(res);
      archive.directory(resolved, folderName);
      await archive.finalize();
    } else {
      const fileName = path.basename(resolved);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.sendFile(resolved);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', (req, res, next) => {
  const dest = req.query.path || req.headers['x-upload-path'] || os.homedir();
  const resolved = path.resolve(dest);
  if (!isPathSafe(resolved)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  uploadDestination = resolved;
  next();
}, upload.array('files', 50), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const uploaded = req.files.map(f => ({
      name: f.originalname,
      size: f.size,
      path: f.path
    }));

    res.json({ success: true, files: uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const resolved = path.resolve(dirPath);
    if (!isPathSafe(resolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.mkdir(resolved, { recursive: true });
    res.json({ success: true, path: resolved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/delete', async (req, res) => {
  try {
    const { path: targetPath } = req.body;
    if (!targetPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const resolved = path.resolve(targetPath);
    if (!isPathSafe(resolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true, force: true });
    } else {
      await fs.unlink(resolved);
    }

    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Both oldPath and newPath are required' });
    }

    const resolvedOld = path.resolve(oldPath);
    const resolvedNew = path.resolve(newPath);

    if (!isPathSafe(resolvedOld) || !isPathSafe(resolvedNew)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.rename(resolvedOld, resolvedNew);
    res.json({ success: true, path: resolvedNew });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Source path not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/drives', async (req, res) => {
  try {
    const psOutput = execSync(
      'powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json"',
      { encoding: 'utf-8', timeout: 10000 }
    );
    const psData = JSON.parse(psOutput);
    const drives = (Array.isArray(psData) ? psData : [psData]).map(d => ({
      name: d.Name + ':\\',
      description: '',
      size: (d.Used || 0) + (d.Free || 0),
      freeSpace: d.Free || 0
    }));
    res.json({ drives });
  } catch (err) {
    try {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const drives = [];
      for (const letter of letters) {
        const drivePath = letter + ':\\';
        if (fsSync.existsSync(drivePath)) {
          drives.push({ name: drivePath, description: '', size: 0, freeSpace: 0 });
        }
      }
      res.json({ drives });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Failed to list drives' });
    }
  }
});

module.exports = router;

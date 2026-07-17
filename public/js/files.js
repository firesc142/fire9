// File browser
(function() {
  const fileList = document.getElementById('file-list');
  const breadcrumb = document.getElementById('breadcrumb');
  const drivesList = document.getElementById('drives-list');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadInput = document.getElementById('file-upload-input');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const dropZone = document.getElementById('drop-zone');
  const uploadProgress = document.getElementById('upload-progress');
  const uploadProgressFill = document.getElementById('upload-progress-fill');
  const uploadProgressText = document.getElementById('upload-progress-text');

  let currentPath = '';

  function init() {
    fetchDrives();
    fetchPath('');
  }

  async function fetchDrives() {
    try {
      const res = await fetch('/api/files/drives');
      const data = await res.json();
      const drives = data.drives || [];
      drivesList.innerHTML = '';
      drives.forEach(drive => {
        const name = typeof drive === 'string' ? drive : drive.name;
        const btn = document.createElement('button');
        btn.className = 'drive-btn';
        btn.innerHTML = '<i class="fas fa-hdd"></i> ' + escapeHtml(name);
        btn.addEventListener('click', () => fetchPath(name));
        drivesList.appendChild(btn);
      });
    } catch (err) {
      showNotification('Failed to load drives', 'error');
    }
  }

  async function fetchPath(dirPath) {
    try {
      const res = await fetch('/api/files/list?path=' + encodeURIComponent(dirPath));
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to list directory');
      }
      const data = await res.json();
      currentPath = data.path;
      renderBreadcrumb(data.path);
      renderFileList(data.items);
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  function renderBreadcrumb(filePath) {
    breadcrumb.innerHTML = '';
    const parts = filePath.split(/[/\\]/).filter(Boolean);
    let accumulated = '';

    const homeBtn = document.createElement('span');
    homeBtn.className = 'breadcrumb-item';
    homeBtn.innerHTML = '<i class="fas fa-home"></i>';
    homeBtn.addEventListener('click', () => fetchPath(''));
    breadcrumb.appendChild(homeBtn);

    parts.forEach((part) => {
      accumulated += part + '\\';
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = ' / ';
      breadcrumb.appendChild(sep);

      const item = document.createElement('span');
      item.className = 'breadcrumb-item';
      item.textContent = part;
      const pathCopy = accumulated;
      item.addEventListener('click', () => fetchPath(pathCopy));
      breadcrumb.appendChild(item);
    });
  }

  function renderFileList(items) {
    fileList.innerHTML = '';

    if (!items || items.length === 0) {
      fileList.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>Empty folder</p></div>';
      return;
    }

    // Header row
    const header = document.createElement('div');
    header.className = 'file-row file-row-header';
    header.innerHTML = `
      <div class="file-icon"></div>
      <div class="file-name">Name</div>
      <div class="file-size">Size</div>
      <div class="file-date">Modified</div>
      <div class="file-actions">Actions</div>
    `;
    fileList.appendChild(header);

    items.forEach(item => {
      const isDir = item.type === 'directory' || item.isDirectory;
      const row = document.createElement('div');
      row.className = 'file-row';

      const icon = getFileIcon(item);
      const size = isDir ? '--' : formatSize(item.size);
      const date = item.modified ? formatDate(item.modified) : '--';

      row.innerHTML = `
        <div class="file-icon"><i class="fas ${icon}"></i></div>
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-size">${size}</div>
        <div class="file-date">${date}</div>
        <div class="file-actions">
          ${!isDir ? '<button class="action-btn" data-action="download" title="Download"><i class="fas fa-download"></i></button>' : ''}
          <button class="action-btn" data-action="rename" title="Rename"><i class="fas fa-pencil-alt"></i></button>
          <button class="action-btn danger" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      `;

      // Click name to open folder
      row.querySelector('.file-name').addEventListener('click', () => {
        if (isDir) {
          fetchPath(currentPath + '\\' + item.name);
        }
      });
      if (isDir) {
        row.querySelector('.file-name').style.cursor = 'pointer';
        row.querySelector('.file-name').style.fontWeight = '500';
      }

      // Download button (files only)
      const dlBtn = row.querySelector('[data-action="download"]');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => downloadFile(item));
      }

      row.querySelector('[data-action="rename"]').addEventListener('click', () => renameFile(item));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteFile(item));

      fileList.appendChild(row);
    });
  }

  function getFileIcon(item) {
    const isDir = item.type === 'directory' || item.isDirectory;
    if (isDir) return 'fa-folder';
    const ext = (item.extension || item.name.split('.').pop() || '').toLowerCase();
    const icons = {
      'pdf': 'fa-file-pdf', 'doc': 'fa-file-word', 'docx': 'fa-file-word',
      'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel',
      'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
      'jpg': 'fa-file-image', 'jpeg': 'fa-file-image', 'png': 'fa-file-image',
      'gif': 'fa-file-image', 'svg': 'fa-file-image', 'webp': 'fa-file-image',
      'mp4': 'fa-file-video', 'avi': 'fa-file-video', 'mkv': 'fa-file-video', 'mov': 'fa-file-video',
      'mp3': 'fa-file-audio', 'wav': 'fa-file-audio', 'flac': 'fa-file-audio', 'ogg': 'fa-file-audio',
      'zip': 'fa-file-archive', 'rar': 'fa-file-archive', '7z': 'fa-file-archive', 'tar': 'fa-file-archive',
      'js': 'fa-file-code', 'ts': 'fa-file-code', 'py': 'fa-file-code',
      'html': 'fa-file-code', 'css': 'fa-file-code', 'json': 'fa-file-code',
      'txt': 'fa-file-alt', 'md': 'fa-file-alt', 'log': 'fa-file-alt',
      'exe': 'fa-cog', 'msi': 'fa-cog', 'bat': 'fa-cog'
    };
    return icons[ext] || 'fa-file';
  }

  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function downloadFile(item) {
    const filePath = currentPath + '\\' + item.name;
    const a = document.createElement('a');
    a.href = '/api/files/download?path=' + encodeURIComponent(filePath);
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function renameFile(item) {
    const newName = prompt('Rename to:', item.name);
    if (!newName || newName === item.name) return;

    try {
      const res = await fetch('/api/files/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPath: currentPath + '\\' + item.name,
          newPath: currentPath + '\\' + newName
        })
      });
      if (!res.ok) throw new Error('Rename failed');
      fetchPath(currentPath);
      showNotification('Renamed successfully', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  async function deleteFile(item) {
    if (!confirm('Delete "' + item.name + '"? This cannot be undone.')) return;

    try {
      const res = await fetch('/api/files/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath + '\\' + item.name })
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchPath(currentPath);
      showNotification('Deleted successfully', 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  // New folder
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', async () => {
      const name = prompt('Folder name:');
      if (!name) return;

      try {
        const res = await fetch('/api/files/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentPath + '\\' + name })
        });
        if (!res.ok) throw new Error('Failed to create folder');
        fetchPath(currentPath);
        showNotification('Folder created', 'success');
      } catch (err) {
        showNotification(err.message, 'error');
      }
    });
  }

  // Upload button
  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => {
      const files = uploadInput.files;
      if (files.length) uploadFiles(files);
      uploadInput.value = '';
    });
  }

  // Drag and drop on the whole files tab
  const filesTab = document.getElementById('files-tab');
  if (filesTab) {
    filesTab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dropZone) dropZone.classList.remove('hidden');
    });

    filesTab.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && filesTab.contains(e.relatedTarget)) return;
      if (dropZone) dropZone.classList.add('hidden');
    });

    filesTab.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dropZone) dropZone.classList.add('hidden');
      const files = e.dataTransfer.files;
      if (files.length) uploadFiles(files);
    });
  }

  async function uploadFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    if (uploadProgress) uploadProgress.classList.remove('hidden');
    if (uploadProgressFill) uploadProgressFill.style.width = '0%';
    if (uploadProgressText) uploadProgressText.textContent = '0%';

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload?path=' + encodeURIComponent(currentPath));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round(e.loaded / e.total * 100);
          if (uploadProgressFill) uploadProgressFill.style.width = percent + '%';
          if (uploadProgressText) uploadProgressText.textContent = percent + '%';
        }
      };

      xhr.onload = () => {
        if (uploadProgress) uploadProgress.classList.add('hidden');
        if (xhr.status === 200) {
          fetchPath(currentPath);
          showNotification('Upload complete', 'success');
        } else {
          showNotification('Upload failed', 'error');
        }
      };

      xhr.onerror = () => {
        if (uploadProgress) uploadProgress.classList.add('hidden');
        showNotification('Upload failed: network error', 'error');
      };

      xhr.send(formData);
    } catch (err) {
      if (uploadProgress) uploadProgress.classList.add('hidden');
      showNotification('Upload failed: ' + err.message, 'error');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initialize when files tab is clicked
  document.querySelector('[data-tab="files"]').addEventListener('click', () => {
    setTimeout(() => {
      if (!currentPath && drivesList && !drivesList.children.length) init();
    }, 50);
  });

  init();
})();

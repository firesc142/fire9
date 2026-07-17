const screenshot = require('screenshot-desktop');

let activeMonitor = null;
let monitorList = [];

async function refreshMonitors() {
  try {
    const displays = await screenshot.listDisplays();
    monitorList = displays.map((d, i) => ({
      id: d.id || i,
      name: d.name || `Monitor ${i + 1}`,
      width: d.width || 1920,
      height: d.height || 1080,
      x: d.left || 0,
      y: d.top || 0,
      primary: d.primary || i === 0,
    }));
    if (monitorList.length > 0 && activeMonitor === null) {
      activeMonitor = monitorList[0].id;
    }
  } catch (err) {
    console.error('Failed to list monitors:', err.message);
    monitorList = [{
      id: 0,
      name: 'Primary Monitor',
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      primary: true,
    }];
    activeMonitor = 0;
  }
}

refreshMonitors();

async function getMonitors() {
  if (monitorList.length === 0) await refreshMonitors();
  return monitorList;
}

function getActiveMonitor() {
  return activeMonitor;
}

function setActiveMonitor(id) {
  const found = monitorList.find(m => m.id === id);
  if (found) {
    activeMonitor = id;
    return true;
  }
  return false;
}

function getMonitorBounds(id) {
  const monitor = monitorList.find(m => m.id === id);
  if (monitor) {
    return { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
  }
  return { x: 0, y: 0, width: 1920, height: 1080 };
}

function handleConnection(socket) {
  socket.on('get-monitors', async (callback) => {
    await refreshMonitors();
    const result = {
      monitors: monitorList,
      active: activeMonitor,
    };
    if (typeof callback === 'function') callback(result);
    else socket.emit('monitors-list', result);
  });

  socket.on('set-monitor', (data, callback) => {
    const id = typeof data === 'object' ? data.id : data;
    const success = setActiveMonitor(id);
    const result = { success, active: activeMonitor };
    if (typeof callback === 'function') callback(result);
    else socket.emit('monitor-changed', result);
  });

  socket.on('refresh-monitors', async (callback) => {
    await refreshMonitors();
    const result = { monitors: monitorList, active: activeMonitor };
    if (typeof callback === 'function') callback(result);
    else socket.emit('monitors-list', result);
  });
}

module.exports = { handleConnection, getMonitors, getActiveMonitor, setActiveMonitor, getMonitorBounds };

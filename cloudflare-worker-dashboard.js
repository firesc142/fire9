/**
 * Paperfly Dashboard - Cloudflare Worker
 * 
 * Deploy this to Cloudflare Workers to view your Paperfly logs and metrics
 * 
 * Setup:
 * 1. Create a new Cloudflare Worker
 * 2. Paste this code
 * 3. Set environment variables: API_BASE, API_KEY
 * 4. Deploy
 */

// Configuration - Set in Cloudflare Worker environment
const API_BASE = typeof API_BASE !== 'undefined' ? API_BASE : 'https://your-tunnel-url';
const API_KEY = typeof API_KEY !== 'undefined' ? API_KEY : 'your-api-key';

// HTML Dashboard
const HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperfly - Remote Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      font-size: 24px;
      color: #333;
    }

    .status-badge {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #4caf50;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .header-info {
      text-align: right;
      color: #666;
      font-size: 14px;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }

    .metric-card {
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .metric-label {
      color: #999;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #333;
    }

    .metric-unit {
      font-size: 12px;
      color: #999;
      margin-top: 4px;
    }

    .progress-bar {
      width: 100%;
      height: 6px;
      background: #f0f0f0;
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }

    .stat-card .label {
      color: #999;
      font-size: 12px;
      margin-bottom: 8px;
    }

    .stat-card .value {
      font-size: 28px;
      font-weight: bold;
      color: #667eea;
    }

    .logs-container {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .logs-header {
      background: #f8f9fa;
      padding: 15px;
      border-bottom: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logs-header h2 {
      font-size: 18px;
      margin: 0;
    }

    .filter-controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      padding: 10px 15px;
      background: #f8f9fa;
      border-bottom: 1px solid #ddd;
    }

    .filter-btn {
      padding: 6px 12px;
      border: 1px solid #ddd;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .filter-btn:hover, .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }

    .logs-list {
      max-height: 600px;
      overflow-y: auto;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 12px;
    }

    .log-entry {
      padding: 10px 15px;
      border-bottom: 1px solid #f0f0f0;
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .log-entry:hover {
      background: #f8f9fa;
    }

    .log-time {
      color: #999;
      white-space: nowrap;
      min-width: 130px;
      font-size: 11px;
    }

    .log-category {
      background: #667eea;
      color: white;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      white-space: nowrap;
      font-weight: bold;
      min-width: 60px;
      text-align: center;
    }

    .log-level {
      font-weight: bold;
      min-width: 50px;
      text-align: center;
    }

    .log-level.info { color: #0066cc; }
    .log-level.warn { color: #ff9900; }
    .log-level.error { color: #cc0000; }
    .log-level.debug { color: #666; }

    .log-message {
      flex: 1;
      color: #333;
      word-break: break-word;
    }

    .empty-state {
      padding: 40px;
      text-align: center;
      color: #999;
    }

    .error {
      background: #fee;
      color: #c33;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid #f0f0f0;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
      .header { flex-direction: column; text-align: center; }
      .header-info { margin-top: 10px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1><span class="status-badge"></span>Paperfly Remote Dashboard</h1>
      </div>
      <div class="header-info">
        <div id="machine-name" style="font-weight: bold; color: #333;">Loading...</div>
        <div id="last-update" style="font-size: 12px; margin-top: 5px;">-</div>
      </div>
    </div>

    <div id="error" style="display: none;" class="error"></div>

    <div id="loading" class="loading">
      <div class="spinner"></div>
      <p>Connecting to Paperfly server...</p>
    </div>

    <div id="content" style="display: none;">
      <div class="metrics-grid" id="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">CPU Usage</div>
          <div class="metric-value" id="cpu-value">-</div>
          <div class="progress-bar"><div class="progress-fill" id="cpu-bar" style="width: 0%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Memory Usage</div>
          <div class="metric-value" id="mem-value">-</div>
          <div class="progress-bar"><div class="progress-fill" id="mem-bar" style="width: 0%"></div></div>
          <div class="metric-unit" id="mem-detail">-</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Uptime</div>
          <div class="metric-value" id="uptime-value">-</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Platform</div>
          <div class="metric-value" style="font-size: 14px;" id="platform-value">-</div>
        </div>
      </div>

      <div class="stats-grid" id="stats-grid">
        <div class="stat-card">
          <div class="label">Total Logs</div>
          <div class="value" id="stat-total">0</div>
        </div>
        <div class="stat-card">
          <div class="label">Errors</div>
          <div class="value" id="stat-errors">0</div>
        </div>
        <div class="stat-card">
          <div class="label">Last Hour</div>
          <div class="value" id="stat-hour">0</div>
        </div>
        <div class="stat-card">
          <div class="label">Last Minute</div>
          <div class="value" id="stat-minute">0</div>
        </div>
      </div>

      <div class="logs-container">
        <div class="logs-header">
          <h2>System Logs</h2>
          <div id="log-count" style="color: #666; font-size: 14px;">0 logs</div>
        </div>

        <div class="filter-controls">
          <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">All</button>
          <button class="filter-btn" data-filter="tunnel" onclick="setFilter('tunnel')">Tunnel</button>
          <button class="filter-btn" data-filter="server" onclick="setFilter('server')">Server</button>
          <button class="filter-btn" data-filter="terminal" onclick="setFilter('terminal')">Terminal</button>
          <button class="filter-btn" data-filter="error" onclick="setFilter('error')">Errors</button>
        </div>

        <div class="logs-list" id="logs-list">
          <div class="empty-state">Loading logs...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentFilter = 'all';
    let allLogs = [];
    let allStats = null;

    async function fetchData() {
      try {
        // Show loading
        document.getElementById('loading').style.display = 'block';
        document.getElementById('content').style.display = 'none';
        document.getElementById('error').style.display = 'none';

        // Fetch metrics
        const metricsRes = await fetch('/api/metrics');
        const metricsData = await metricsRes.json();

        if (!metricsData.success) throw new Error('Failed to fetch metrics');

        const metrics = metricsData.data;

        // Fetch logs
        const logsRes = await fetch('/api/logs?limit=100');
        const logsData = await logsRes.json();

        if (!logsData.success) throw new Error('Failed to fetch logs');

        allLogs = logsData.data.logs;

        // Fetch stats
        const statsRes = await fetch('/api/stats');
        const statsData = await statsRes.json();

        if (!statsData.success) throw new Error('Failed to fetch stats');

        allStats = statsData.data;

        // Update UI
        updateMetrics(metrics);
        updateStats(allStats);
        renderLogs();

        // Hide loading, show content
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';

      } catch (err) {
        console.error('Error:', err);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        document.getElementById('error').innerHTML = \`
          <strong>Error:</strong> \${err.message}<br>
          <small>Make sure your Paperfly server is running and API_BASE is correctly configured.</small>
        \`;
      }
    }

    function updateMetrics(metrics) {
      document.getElementById('machine-name').textContent = metrics.machineName;
      document.getElementById('last-update').textContent = 'Updated: ' + new Date(metrics.timestamp).toLocaleTimeString();

      // CPU
      const cpu = Math.min(Math.round(metrics.cpuUsage * 100), 100);
      document.getElementById('cpu-value').textContent = cpu + '%';
      document.getElementById('cpu-bar').style.width = cpu + '%';

      // Memory
      const mem = metrics.memoryPercent;
      document.getElementById('mem-value').textContent = mem + '%';
      document.getElementById('mem-bar').style.width = mem + '%';
      const memMB = Math.round(metrics.usedMemory / 1024 / 1024);
      const totalMB = Math.round(metrics.totalMemory / 1024 / 1024);
      document.getElementById('mem-detail').textContent = memMB + ' MB / ' + totalMB + ' MB';

      // Uptime
      const hours = Math.floor(metrics.uptime / 3600);
      const minutes = Math.floor((metrics.uptime % 3600) / 60);
      document.getElementById('uptime-value').textContent = hours + 'h ' + minutes + 'm';

      // Platform
      document.getElementById('platform-value').textContent = metrics.platform;
    }

    function updateStats(stats) {
      document.getElementById('stat-total').textContent = stats.total;
      document.getElementById('stat-errors').textContent = (stats.byLevel?.error || 0);
      document.getElementById('stat-hour').textContent = stats.recent.lastHour;
      document.getElementById('stat-minute').textContent = stats.recent.lastMinute;
    }

    function renderLogs() {
      let filtered = allLogs;

      if (currentFilter === 'error') {
        filtered = allLogs.filter(l => l.level === 'error');
      } else if (currentFilter !== 'all') {
        filtered = allLogs.filter(l => l.category === currentFilter);
      }

      const logsList = document.getElementById('logs-list');
      document.getElementById('log-count').textContent = filtered.length + ' logs';

      if (filtered.length === 0) {
        logsList.innerHTML = '<div class="empty-state">No logs found</div>';
        return;
      }

      logsList.innerHTML = filtered.map(log => \`
        <div class="log-entry">
          <div class="log-time">\${new Date(log.timestamp).toLocaleTimeString()}</div>
          <div class="log-category">\${log.category.toUpperCase()}</div>
          <div class="log-level \${log.level}">\${log.level.toUpperCase()}</div>
          <div class="log-message">\${escapeHtml(log.message)}</div>
        </div>
      \`).join('');
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderLogs();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Initial fetch
    fetchData();

    // Refresh every 30 seconds
    setInterval(fetchData, 30000);
  </script>
</body>
</html>
`;

// Worker handlers
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Serve HTML for root
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Proxy API requests to Paperfly server
    if (url.pathname.startsWith('/api/')) {
      const paperFlyUrl = API_BASE + url.pathname + url.search;
      
      try {
        const response = await fetch(paperFlyUrl, {
          method: request.method,
          headers: {
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json'
          },
          body: request.body
        });

        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to connect to Paperfly server',
          message: err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

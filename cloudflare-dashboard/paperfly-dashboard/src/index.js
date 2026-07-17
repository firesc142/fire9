/**
 * Paperfly Dashboard — Cloudflare Worker
 *
 * Reads all machines and their recent logs from Supabase using the
 * public REST API (anon key + RLS "public can read" policy — no JWT needed).
 *
 * Required Wrangler vars (wrangler.jsonc → vars, or `wrangler secret put`):
 *   SUPABASE_URL       - e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  - anon/public key from Supabase project settings
 */

// ── Supabase REST helpers ─────────────────────────────────────────────────────

/**
 * Run a Supabase REST query.
 * @param {string} url         Supabase project URL
 * @param {string} anonKey     Supabase anon key
 * @param {string} table       Table name
 * @param {string} [params]    PostgREST query string, e.g. "select=*&order=last_updated.desc"
 * @returns {Promise<any[]>}
 */
async function supabaseSelect(url, anonKey, table, params = 'select=*') {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?${params}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase query on "${table}" failed: HTTP ${res.status}`);
  }
  return res.json();
}

// ── Dashboard HTML ────────────────────────────────────────────────────────────

function buildHtml(machines, logsByMachine, errorMsg) {
  const safeJson = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperfly — Remote Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; padding: 20px; color: #333;
    }
    .container { max-width: 1400px; margin: 0 auto; }

    /* ── Global header ── */
    .global-header {
      background: white; padding: 20px; border-radius: 8px;
      margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex; justify-content: space-between; align-items: center;
    }
    .global-header h1 { font-size: 24px; color: #333; }
    .status-badge {
      display: inline-block; width: 12px; height: 12px;
      border-radius: 50%; background: #4caf50; margin-right: 8px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
    .machine-count { color: #666; font-size: 14px; }

    /* ── Error box ── */
    .error-box {
      background: #fee; color: #c33; padding: 16px;
      border-radius: 8px; margin-bottom: 20px;
    }

    /* ── Machine card ── */
    .machine-card {
      background: white; border-radius: 10px; margin-bottom: 32px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1); overflow: hidden;
    }
    .machine-header {
      background: linear-gradient(90deg, #667eea, #764ba2);
      color: white; padding: 16px 20px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .machine-header h2 { font-size: 18px; margin: 0; }
    .machine-meta { font-size: 12px; opacity: .85; }

    /* ── Metrics grid ── */
    .metrics-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px; padding: 16px;
    }
    .metric-card {
      background: #f8f9fa; padding: 14px; border-radius: 8px;
    }
    .metric-label { color:#999; font-size:11px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
    .metric-value { font-size:22px; font-weight:bold; color:#333; }
    .metric-unit  { font-size:11px; color:#999; margin-top:3px; }
    .progress-bar { width:100%; height:5px; background:#e0e0e0; border-radius:3px; margin-top:7px; overflow:hidden; }
    .progress-fill { height:100%; background:linear-gradient(90deg,#667eea,#764ba2); border-radius:3px; transition:width .3s; }

    /* ── Stats row ── */
    .stats-row {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 12px; padding: 0 16px 16px;
    }
    .stat-card { background:#f8f9fa; padding:12px; border-radius:8px; text-align:center; }
    .stat-card .label { color:#999; font-size:11px; margin-bottom:6px; }
    .stat-card .value { font-size:24px; font-weight:bold; color:#667eea; }

    /* ── Logs ── */
    .logs-section { border-top: 1px solid #eee; }
    .logs-header {
      background: #f8f9fa; padding: 12px 16px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .logs-header h3 { font-size: 15px; margin: 0; }
    .filter-controls { display:flex; gap:8px; flex-wrap:wrap; padding:8px 16px; background:#f8f9fa; border-bottom:1px solid #eee; }
    .filter-btn {
      padding:4px 10px; border:1px solid #ddd; background:white;
      border-radius:4px; cursor:pointer; font-size:11px; transition:all .15s;
    }
    .filter-btn:hover,.filter-btn.active { background:#667eea; color:white; border-color:#667eea; }
    .logs-list { max-height:400px; overflow-y:auto; font-family:'Monaco','Courier New',monospace; font-size:12px; }
    .log-entry { padding:8px 16px; border-bottom:1px solid #f0f0f0; display:flex; gap:8px; align-items:flex-start; }
    .log-entry:hover { background:#f8f9fa; }
    .log-time { color:#999; white-space:nowrap; min-width:120px; font-size:11px; }
    .log-category { background:#667eea; color:white; padding:1px 7px; border-radius:3px; font-size:10px; white-space:nowrap; font-weight:bold; min-width:55px; text-align:center; }
    .log-level { font-weight:bold; min-width:45px; text-align:center; }
    .log-level.info{color:#0066cc} .log-level.warn{color:#ff9900} .log-level.error{color:#cc0000} .log-level.debug{color:#666}
    .log-message { flex:1; color:#333; word-break:break-word; }
    .empty-state { padding:30px; text-align:center; color:#999; }

    /* ── No machines ── */
    .no-machines {
      background: white; border-radius: 8px; padding: 40px;
      text-align: center; color: #666; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    @media(max-width:768px){
      .metrics-grid{grid-template-columns:repeat(2,1fr)}
      .stats-row{grid-template-columns:repeat(2,1fr)}
    }
  </style>
</head>
<body>
<div class="container">

  <div class="global-header">
    <h1><span class="status-badge"></span>Paperfly Remote Dashboard</h1>
    <div class="machine-count" id="machine-count">Loading…</div>
  </div>

  ${errorMsg ? `<div class="error-box"><strong>Error:</strong> ${errorMsg}</div>` : ''}

  <div id="machines-container"></div>

</div>

<script>
  const MACHINES    = ${safeJson(machines)};
  const LOGS_BY_ID  = ${safeJson(logsByMachine)};

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = String(t ?? '');
    return d.innerHTML;
  }

  function fmtUptime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  function computeStats(logs) {
    const now = Date.now();
    let errors = 0, lastHour = 0, lastMinute = 0;
    for (const l of logs) {
      if (l.level === 'error') errors++;
      const t = new Date(l.created_at || l.timestamp).getTime();
      if (now - t < 3_600_000) lastHour++;
      if (now - t < 60_000)   lastMinute++;
    }
    return { total: logs.length, errors, lastHour, lastMinute };
  }

  function renderLogsForMachine(machineId, filter) {
    const allLogs = LOGS_BY_ID[machineId] || [];
    let filtered = allLogs;
    if (filter === 'error') {
      filtered = allLogs.filter(l => l.level === 'error');
    } else if (filter !== 'all') {
      filtered = allLogs.filter(l => l.category === filter);
    }

    const list = document.getElementById('logs-' + machineId);
    const countEl = document.getElementById('logcount-' + machineId);
    if (countEl) countEl.textContent = filtered.length + ' logs';

    if (!list) return;
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state">No logs found</div>';
      return;
    }
    list.innerHTML = filtered.map(l => \`
      <div class="log-entry">
        <div class="log-time">\${new Date(l.created_at || l.timestamp).toLocaleTimeString()}</div>
        <div class="log-category">\${escapeHtml((l.category||'').toUpperCase())}</div>
        <div class="log-level \${escapeHtml(l.level||'')}">\${escapeHtml((l.level||'').toUpperCase())}</div>
        <div class="log-message">\${escapeHtml(l.message||'')}</div>
      </div>
    \`).join('');
  }

  function setFilter(machineId, filter, btn) {
    // Toggle active button within this machine's filter row
    const row = btn.closest('.filter-controls');
    row.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLogsForMachine(machineId, filter);
  }

  function buildMachineCard(m) {
    const id = m.machine_id;
    const logs = LOGS_BY_ID[id] || [];
    const stats = computeStats(logs);
    const cpu = Math.min(Math.round((m.cpu_usage || 0) * 100), 100);
    const mem = m.memory_percent || 0;
    const usedMB  = Math.round((m.used_memory  || 0) / 1024 / 1024);
    const totalMB = Math.round((m.total_memory || 0) / 1024 / 1024);
    const updated = m.last_updated
      ? 'Updated ' + new Date(m.last_updated).toLocaleTimeString()
      : 'No update yet';

    const card = document.createElement('div');
    card.className = 'machine-card';
    card.innerHTML = \`
      <div class="machine-header">
        <h2>\${escapeHtml(m.machine_name || id)}</h2>
        <div class="machine-meta">\${escapeHtml(m.platform || '')} · \${updated}</div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">CPU</div>
          <div class="metric-value">\${cpu}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:\${cpu}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Memory</div>
          <div class="metric-value">\${mem}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:\${mem}%"></div></div>
          <div class="metric-unit">\${usedMB} MB / \${totalMB} MB</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Uptime</div>
          <div class="metric-value" style="font-size:18px">\${fmtUptime(m.uptime || 0)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Node</div>
          <div class="metric-value" style="font-size:16px">\${escapeHtml(m.node_version || '-')}</div>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card"><div class="label">Total Logs</div><div class="value">\${stats.total}</div></div>
        <div class="stat-card"><div class="label">Errors</div><div class="value">\${stats.errors}</div></div>
        <div class="stat-card"><div class="label">Last Hour</div><div class="value">\${stats.lastHour}</div></div>
        <div class="stat-card"><div class="label">Last Minute</div><div class="value">\${stats.lastMinute}</div></div>
      </div>

      <div class="logs-section">
        <div class="logs-header">
          <h3>Logs</h3>
          <div id="logcount-\${escapeHtml(id)}" style="color:#666;font-size:13px;">\${logs.length} logs</div>
        </div>
        <div class="filter-controls">
          <button class="filter-btn active" onclick="setFilter('\${escapeHtml(id)}','all',this)">All</button>
          <button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','tunnel',this)">Tunnel</button>
          <button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','server',this)">Server</button>
          <button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','terminal',this)">Terminal</button>
          <button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','error',this)">Errors</button>
        </div>
        <div class="logs-list" id="logs-\${escapeHtml(id)}">
          <div class="empty-state">No logs</div>
        </div>
      </div>
    \`;
    return card;
  }

  function render() {
    const container = document.getElementById('machines-container');
    const countEl   = document.getElementById('machine-count');

    if (!MACHINES || !MACHINES.length) {
      countEl.textContent = '0 machines';
      container.innerHTML = \`
        <div class="no-machines">
          <p style="font-size:18px;margin-bottom:8px;">No machines connected yet</p>
          <p style="color:#999">Start the Paperfly server on your machine to see data here.</p>
        </div>\`;
      return;
    }

    countEl.textContent = MACHINES.length + ' machine' + (MACHINES.length !== 1 ? 's' : '') + ' online';

    MACHINES.forEach(m => {
      const card = buildMachineCard(m);
      container.appendChild(card);
      renderLogsForMachine(m.machine_id, 'all');
    });
  }

  render();
</script>
</body>
</html>`;
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/' && url.pathname !== '') {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const supabaseUrl = env.SUPABASE_URL;
    const anonKey = env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      const html = buildHtml([], {}, 'SUPABASE_URL and SUPABASE_ANON_KEY must be set as Wrangler environment variables.');
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    try {
      // Fetch all machines sorted by most-recently-updated first
      const machines = await supabaseSelect(
        supabaseUrl, anonKey, 'machines',
        'select=*&order=last_updated.desc',
      );

      // Fetch the 100 most recent logs across all machines in one query
      const logs = await supabaseSelect(
        supabaseUrl, anonKey, 'logs',
        'select=*&order=created_at.desc&limit=200',
      );

      // Group logs by machine_id
      const logsByMachine = {};
      for (const l of logs) {
        const mid = l.machine_id;
        if (!logsByMachine[mid]) logsByMachine[mid] = [];
        if (logsByMachine[mid].length < 100) logsByMachine[mid].push(l);
      }

      const html = buildHtml(machines, logsByMachine, null);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      const html = buildHtml([], {}, err.message);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};

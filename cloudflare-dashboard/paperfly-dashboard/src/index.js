/**
 * Paperfly Dashboard — Cloudflare Worker
 *
 * Routes:
 *   GET  /login   → login page (CIA dark theme)
 *   POST /login   → verify password, set signed session cookie
 *   POST /logout  → clear session cookie
 *   GET  /        → dashboard HTML (auth required)
 *   GET  /api/data → JSON snapshot (auth required)
 *
 * Required Wrangler env vars:
 *   SUPABASE_URL        - e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY   - anon/public key
 *   DASHBOARD_PASSWORD  - login password  (`wrangler secret put DASHBOARD_PASSWORD`)
 */

const COOKIE_NAME = 'paperfly_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── HMAC-SHA256 session tokens ────────────────────────────────────────────────

async function importKey(secret) {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeToken(secret) {
  const key = await importKey(secret);
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = String(expires);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payload}.${sigHex}`;
}

async function verifyToken(secret, token) {
  try {
    const [payload, sigHex] = token.split('.');
    if (!payload || !sigHex) return false;
    const expires = parseInt(payload, 10);
    if (isNaN(expires) || Date.now() > expires) return false;
    const key = await importKey(secret);
    const sigBytes = Uint8Array.from(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  } catch { return false; }
}

function getCookie(request, name) {
  const hdr = request.headers.get('Cookie') || '';
  for (const part of hdr.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function isAuthenticated(request, secret) {
  if (!secret) return false;
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  return verifyToken(secret, token);
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supabaseSelect(url, anonKey, table, params = 'select=*') {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?${params}`;
  const res = await fetch(endpoint, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase "${table}" failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchDashboardData(supabaseUrl, anonKey) {
  const [machines, logs] = await Promise.all([
    supabaseSelect(supabaseUrl, anonKey, 'machines', 'select=*&order=last_updated.desc'),
    supabaseSelect(supabaseUrl, anonKey, 'logs', 'select=*&order=created_at.desc&limit=200'),
  ]);

  const logsByMachine = {};
  for (const l of logs) {
    const mid = l.machine_id;
    if (!logsByMachine[mid]) logsByMachine[mid] = [];
    if (logsByMachine[mid].length < 100) logsByMachine[mid].push(l);
  }

  const statsByMachine = {};
  for (const [mid, mLogs] of Object.entries(logsByMachine)) {
    const now = Date.now();
    const stats = { total: mLogs.length, byCategory: {}, byLevel: {}, recent: { lastHour: 0, lastMinute: 0 } };
    for (const l of mLogs) {
      const t = new Date(l.created_at || l.timestamp).getTime();
      stats.byCategory[l.category] = (stats.byCategory[l.category] || 0) + 1;
      stats.byLevel[l.level] = (stats.byLevel[l.level] || 0) + 1;
      if (now - t < 3_600_000) stats.recent.lastHour++;
      if (now - t < 60_000) stats.recent.lastMinute++;
    }
    statsByMachine[mid] = stats;
  }

  return { machines, logsByMachine, statsByMachine, timestamp: Date.now() };
}

// ── Login page HTML ───────────────────────────────────────────────────────────

function buildLoginHtml(errorMsg = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Paperfly — Secure Access</title>
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root{--bg:#080808;--surface:#111;--surface2:#181818;--orange:#e8650a;
      --danger:#f44336;--text:#d0d0d0;--text-bright:#f4f4f4;--text-muted:#5a5a5a;
      --border:#1e1e1e;--border-bright:#303030;
      --font-mono:'Share Tech Mono','Courier New',monospace;
      --font-title:'Orbitron',sans-serif;--radius:2px;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--font-mono);font-size:13px}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;position:relative;overflow:hidden}
    body::before{content:'';position:absolute;inset:0;
      background:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);
      background-size:44px 44px;animation:gridPan 18s linear infinite}
    body::after{content:'';position:absolute;inset:0;
      background:radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,.8) 100%);pointer-events:none}
    @keyframes gridPan{0%{background-position:0 0}100%{background-position:44px 44px}}
    .card{
      position:relative;z-index:1;background:var(--surface);
      border:1px solid var(--border-bright);padding:48px 40px 40px;
      width:100%;max-width:380px;text-align:center;
      box-shadow:0 4px 30px rgba(0,0,0,.8);
      --corner:16px;clip-path:polygon(0 var(--corner),var(--corner) 0,calc(100% - var(--corner)) 0,100% var(--corner),100% 100%,0 100%);
    }
    .card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)}
    .card::after{content:'[ SECURE ACCESS TERMINAL ]';position:absolute;top:-10px;left:50%;
      transform:translateX(-50%);font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
      background:var(--surface);padding:0 12px;letter-spacing:.16em;white-space:nowrap}
    h1{font-family:var(--font-title);font-size:22px;font-weight:700;letter-spacing:.22em;
      color:var(--text-bright);margin-bottom:6px;text-transform:uppercase}
    .subtitle{color:var(--text-muted);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:30px}
    .field{position:relative;margin-bottom:6px}
    .field::before{content:'▶';position:absolute;left:14px;top:50%;transform:translateY(-50%);
      color:var(--text-muted);font-size:10px;pointer-events:none;z-index:1}
    input[type=password]{
      width:100%;padding:14px 16px 14px 32px;font-size:18px;letter-spacing:8px;text-align:center;
      background:var(--bg);border:1px solid var(--border-bright);border-radius:var(--radius);
      color:var(--text-bright);outline:none;font-family:var(--font-mono);
      transition:border-color .2s,box-shadow .2s;caret-color:var(--text-bright);
    }
    input[type=password]::placeholder{color:#2e2e2e;letter-spacing:6px}
    input[type=password]:focus{border-color:rgba(255,255,255,.5);box-shadow:0 0 0 1px rgba(255,255,255,.15)}
    .error{color:var(--danger);min-height:18px;margin:10px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
    button[type=submit]{
      width:100%;padding:13px;margin-top:8px;
      background:rgba(255,255,255,.92);border:1px solid #fff;border-radius:var(--radius);
      color:#000;font-family:var(--font-mono);font-size:12px;font-weight:700;
      letter-spacing:.18em;text-transform:uppercase;cursor:pointer;
      transition:all .15s;
    }
    button[type=submit]:hover{background:#fff;box-shadow:0 0 16px rgba(255,255,255,.15)}
  </style>
</head>
<body>
<div class="card">
  <h1>◈ PAPERFLY</h1>
  <div class="subtitle">Remote Control Interface</div>
  <form method="POST" action="/login">
    <div class="field">
      <input type="password" name="password" placeholder="••••••" autocomplete="current-password" autofocus required>
    </div>
    <div class="error">${errorMsg ? `⚠ ${errorMsg}` : ''}</div>
    <button type="submit">AUTHENTICATE</button>
  </form>
</div>
</body>
</html>`;
}

// ── Dashboard HTML ────────────────────────────────────────────────────────────

function buildHtml(machines, logsByMachine, statsByMachine, errorMsg) {
  const safeJson = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperfly — Remote Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root{--bg:#080808;--bg2:#0e0e0e;--surface:#111;--surface2:#181818;
      --orange:#e8650a;--danger:#f44336;--warning:#ff9800;--online:#00e676;
      --text:#d0d0d0;--text-bright:#f4f4f4;--text-muted:#5a5a5a;--text-dim:#2e2e2e;
      --border:#1e1e1e;--border-bright:#303030;
      --font-mono:'Share Tech Mono','Courier New',monospace;
      --font-title:'Orbitron',sans-serif;--radius:2px;--shadow:0 4px 30px rgba(0,0,0,.8);}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font-mono);font-size:13px;letter-spacing:.03em}
    ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:var(--bg)}
    ::-webkit-scrollbar-thumb{background:#282828}::-webkit-scrollbar-thumb:hover{background:var(--border-bright)}
    body{padding:16px}.container{max-width:1400px;margin:0 auto}
    .global-header{background:var(--surface);border:1px solid var(--border-bright);padding:16px 20px;
      margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--shadow)}
    .header-left h1{font-family:var(--font-title);font-size:18px;font-weight:700;letter-spacing:.2em;color:var(--text-bright);text-transform:uppercase}
    .header-left h1 span{color:var(--orange)}
    .header-right{display:flex;align-items:center;gap:12px}
    .machine-count{color:var(--text-muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
    .last-updated{color:var(--text-dim);font-size:10px;letter-spacing:.08em;margin-top:3px}
    .hdr-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;
      border:1px solid var(--border-bright);border-radius:var(--radius);
      background:var(--surface2);color:var(--text);cursor:pointer;
      font-family:var(--font-mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;
      transition:all .15s;text-decoration:none}
    .hdr-btn:hover{border-color:rgba(255,255,255,.5);color:var(--text-bright);background:rgba(255,255,255,.05)}
    .hdr-btn:disabled{opacity:.3;cursor:not-allowed}
    .hdr-btn svg{width:13px;height:13px}
    .hdr-btn.spinning svg{animation:spin .7s linear infinite}
    .hdr-btn.logout{border-color:rgba(244,67,54,.4);color:var(--text-muted)}
    .hdr-btn.logout:hover{border-color:var(--danger);color:var(--danger);background:rgba(244,67,54,.06)}
    @keyframes spin{to{transform:rotate(360deg)}}
    .auto-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
      border:1px solid var(--border-bright);border-radius:var(--radius);
      font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
    .auto-dot{width:6px;height:6px;border-radius:50%;background:var(--online);animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .error-box{background:rgba(244,67,54,.08);border:1px solid var(--danger);color:var(--danger);
      padding:12px 16px;margin-bottom:16px;font-size:11px;letter-spacing:.06em}
    .machine-card{background:var(--surface);border:1px solid var(--border-bright);margin-bottom:24px;box-shadow:var(--shadow)}
    .machine-header{background:var(--surface2);border-bottom:1px solid var(--border-bright);
      padding:14px 20px;display:flex;justify-content:space-between;align-items:flex-start;border-left:3px solid var(--orange)}
    .machine-header-left h2{font-family:var(--font-title);font-size:14px;font-weight:700;
      letter-spacing:.18em;color:var(--text-bright);text-transform:uppercase;margin-bottom:4px}
    .machine-meta{font-size:10px;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase}
    .machine-meta span{color:var(--text-dim);margin:0 6px}
    .tunnel-link{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
      border:1px solid var(--border-bright);border-radius:var(--radius);font-size:10px;
      letter-spacing:.08em;text-transform:uppercase;color:var(--online);text-decoration:none;
      transition:all .15s;margin-top:6px}
    .tunnel-link:hover{border-color:var(--online);background:rgba(0,230,118,.06)}
    .tunnel-link.offline{color:var(--text-muted);pointer-events:none}
    .metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:14px}
    .metric-card{background:var(--bg2);border:1px solid var(--border);padding:12px}
    .metric-label{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
    .metric-value{font-size:20px;font-weight:bold;color:var(--text-bright);font-family:var(--font-title)}
    .metric-unit{font-size:10px;color:var(--text-muted);margin-top:3px}
    .progress-bar{width:100%;height:3px;background:var(--border);margin-top:8px;overflow:hidden}
    .progress-fill{height:100%;background:var(--orange);transition:width .3s}
    .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 14px 14px}
    .stat-card{background:var(--bg2);border:1px solid var(--border);padding:12px;text-align:center}
    .stat-card .label{color:var(--text-muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
    .stat-card .value{font-size:22px;font-weight:bold;color:var(--orange);font-family:var(--font-title)}
    .stat-card.errors .value{color:var(--danger)}
    .logs-section{border-top:1px solid var(--border-bright)}
    .logs-header{background:var(--surface2);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)}
    .logs-header h3{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);border-left:2px solid var(--orange);padding-left:8px}
    .log-count{color:var(--text-dim);font-size:10px;letter-spacing:.08em}
    .filter-controls{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px;background:var(--bg2);border-bottom:1px solid var(--border)}
    .filter-btn{padding:3px 10px;border:1px solid var(--border-bright);background:var(--surface);
      border-radius:var(--radius);cursor:pointer;font-family:var(--font-mono);font-size:10px;
      letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);transition:all .15s}
    .filter-btn:hover,.filter-btn.active{border-color:var(--orange);color:var(--orange);background:rgba(232,101,10,.06)}
    .logs-list{max-height:380px;overflow-y:auto;font-family:var(--font-mono);font-size:11px}
    .log-entry{padding:7px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start;transition:background .1s}
    .log-entry:hover{background:rgba(255,255,255,.02)}
    .log-time{color:var(--text-muted);white-space:nowrap;min-width:90px;font-size:10px}
    .log-category{background:var(--surface2);border:1px solid var(--border-bright);padding:1px 6px;
      font-size:9px;white-space:nowrap;font-weight:bold;min-width:55px;text-align:center;color:var(--text-muted);letter-spacing:.06em}
    .log-level{font-weight:bold;min-width:40px;text-align:center;font-size:10px;letter-spacing:.06em}
    .log-level.info{color:#4fc3f7}.log-level.warn{color:var(--warning)}.log-level.error{color:var(--danger)}.log-level.debug{color:var(--text-muted)}
    .log-message{flex:1;color:var(--text);word-break:break-word}
    .empty-state{padding:24px;text-align:center;color:var(--text-dim);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
    .no-machines{background:var(--surface);border:1px solid var(--border-bright);padding:60px;text-align:center}
    .no-machines p{color:var(--text-muted);font-size:12px;letter-spacing:.1em;text-transform:uppercase}
    .no-machines .icon{font-size:40px;color:var(--border-bright);margin-bottom:16px}
    @media(max-width:768px){.metrics-grid{grid-template-columns:repeat(2,1fr)}.stats-row{grid-template-columns:repeat(2,1fr)}.global-header{flex-direction:column;gap:12px}.header-right{width:100%;justify-content:space-between;flex-wrap:wrap}}
  </style>
</head>
<body>
<div class="container">
  <div class="global-header">
    <div class="header-left"><h1><span>◈</span> PAPERFLY CONTROL</h1></div>
    <div class="header-right">
      <div>
        <div class="machine-count" id="machine-count">LOADING…</div>
        <div class="last-updated" id="last-updated"></div>
      </div>
      <div class="auto-badge"><span class="auto-dot"></span>AUTO 30s</div>
      <button class="hdr-btn" id="refresh-btn" onclick="refreshDashboard()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>REFRESH
      </button>
      <form method="POST" action="/logout" style="margin:0">
        <button type="submit" class="hdr-btn logout"><i class="fas fa-sign-out-alt"></i>LOGOUT</button>
      </form>
    </div>
  </div>
  <div id="error-box" style="display:none" class="error-box"></div>
  <div id="machines-container"></div>
</div>
<script>
  let MACHINES    = ${safeJson(machines)};
  let LOGS_BY_ID  = ${safeJson(logsByMachine)};
  let STATS_BY_ID = ${safeJson(statsByMachine)};
  const activeFilters = {};
  function escapeHtml(t){const d=document.createElement('div');d.textContent=String(t??'');return d.innerHTML}
  function fmtUptime(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h+'h '+m+'m'}
  function renderLogsForMachine(machineId,filter){
    const allLogs=LOGS_BY_ID[machineId]||[];
    let f=filter==='error'?allLogs.filter(l=>l.level==='error'):filter!=='all'?allLogs.filter(l=>l.category===filter):allLogs;
    const list=document.getElementById('logs-'+machineId),countEl=document.getElementById('logcount-'+machineId);
    if(countEl)countEl.textContent=f.length+' entries';
    if(!list)return;
    if(!f.length){list.innerHTML='<div class="empty-state">NO ENTRIES FOUND</div>';return}
    list.innerHTML=f.map(l=>\`<div class="log-entry"><div class="log-time">\${new Date(l.created_at||l.timestamp).toLocaleTimeString()}</div><div class="log-category">\${escapeHtml((l.category||'').toUpperCase())}</div><div class="log-level \${escapeHtml(l.level||'')}">\${escapeHtml((l.level||'').toUpperCase())}</div><div class="log-message">\${escapeHtml(l.message||'')}</div></div>\`).join('');
  }
  function setFilter(machineId,filter,btn){
    activeFilters[machineId]=filter;
    btn.closest('.filter-controls').querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');renderLogsForMachine(machineId,filter);
  }
  function buildMachineCard(m){
    const id=m.machine_id,logs=LOGS_BY_ID[id]||[],stats=STATS_BY_ID[id]||{total:logs.length,byLevel:{},recent:{lastHour:0,lastMinute:0}};
    const mem=m.memory_percent||0,usedMB=Math.round((m.used_memory||0)/1024/1024),totalMB=Math.round((m.total_memory||0)/1024/1024);
    const updated=m.last_updated?'UPDATED '+new Date(m.last_updated).toLocaleTimeString():'NO UPDATE';
    const tunnelHtml=m.tunnel_url?\`<a class="tunnel-link" href="\${escapeHtml(m.tunnel_url)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i>\${escapeHtml(m.tunnel_url)}</a>\`:\`<span class="tunnel-link offline"><i class="fas fa-unlink"></i> TUNNEL OFFLINE</span>\`;
    const card=document.createElement('div');card.className='machine-card';card.id='card-'+id;
    card.innerHTML=\`<div class="machine-header"><div class="machine-header-left"><h2>\${escapeHtml(m.machine_name||id)}</h2><div class="machine-meta"><i class="fas fa-circle" style="font-size:6px;color:var(--online)"></i> \${escapeHtml(m.platform||'-')}<span>·</span>\${escapeHtml(m.node_version||'-')}<span>·</span>\${updated}</div>\${tunnelHtml}</div></div><div class="metrics-grid"><div class="metric-card"><div class="metric-label">Memory</div><div class="metric-value">\${mem}%</div><div class="progress-bar"><div class="progress-fill" style="width:\${mem}%"></div></div><div class="metric-unit">\${usedMB} MB / \${totalMB} MB</div></div><div class="metric-card"><div class="metric-label">Uptime</div><div class="metric-value" style="font-size:16px">\${fmtUptime(m.uptime||0)}</div></div></div><div class="stats-row"><div class="stat-card"><div class="label">Total Logs</div><div class="value">\${stats.total}</div></div><div class="stat-card errors"><div class="label">Errors</div><div class="value">\${stats.byLevel?.error||0}</div></div><div class="stat-card"><div class="label">Last Hour</div><div class="value">\${stats.recent.lastHour}</div></div><div class="stat-card"><div class="label">Last Min</div><div class="value">\${stats.recent.lastMinute}</div></div></div><div class="logs-section"><div class="logs-header"><h3><i class="fas fa-stream" style="margin-right:6px;font-size:9px"></i>SYSTEM LOGS</h3><div class="log-count" id="logcount-\${escapeHtml(id)}">\${logs.length} entries</div></div><div class="filter-controls"><button class="filter-btn active" onclick="setFilter('\${escapeHtml(id)}','all',this)">ALL</button><button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','tunnel',this)">TUNNEL</button><button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','server',this)">SERVER</button><button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','terminal',this)">TERMINAL</button><button class="filter-btn" onclick="setFilter('\${escapeHtml(id)}','error',this)">ERRORS</button></div><div class="logs-list" id="logs-\${escapeHtml(id)}"><div class="empty-state">NO LOGS</div></div></div>\`;
    return card;
  }
  function render(){
    const container=document.getElementById('machines-container'),countEl=document.getElementById('machine-count');
    container.innerHTML='';
    if(!MACHINES||!MACHINES.length){countEl.textContent='0 MACHINES';container.innerHTML='<div class="no-machines"><div class="icon"><i class="fas fa-server"></i></div><p>NO MACHINES CONNECTED</p></div>';return}
    countEl.textContent=MACHINES.length+' MACHINE'+(MACHINES.length!==1?'S':'')+' ONLINE';
    MACHINES.forEach(m=>{const card=buildMachineCard(m);container.appendChild(card);renderLogsForMachine(m.machine_id,activeFilters[m.machine_id]||'all')});
  }
  async function refreshDashboard(){
    const btn=document.getElementById('refresh-btn'),errBox=document.getElementById('error-box');
    btn.disabled=true;btn.classList.add('spinning');errBox.style.display='none';
    try{
      const res=await fetch('/api/data');
      if(res.status===401){location.href='/login';return}
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      MACHINES=data.machines;LOGS_BY_ID=data.logsByMachine;STATS_BY_ID=data.statsByMachine;
      render();document.getElementById('last-updated').textContent='SYNCED '+new Date().toLocaleTimeString();
    }catch(err){errBox.textContent='⚠ REFRESH FAILED: '+err.message;errBox.style.display='block'}
    finally{btn.disabled=false;btn.classList.remove('spinning')}
  }
  render();
  document.getElementById('last-updated').textContent='LOADED '+new Date().toLocaleTimeString();
  ${errorMsg ? `document.getElementById('error-box').textContent=${JSON.stringify(errorMsg)};document.getElementById('error-box').style.display='block';` : ''}
  setInterval(refreshDashboard,30000);
</script>
</body>
</html>`;
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.DASHBOARD_PASSWORD || '';
    const sbUrl = env.SUPABASE_URL;
    const anonKey = env.SUPABASE_ANON_KEY;
    const noCreds = !sbUrl || !anonKey;

    // ── GET /login ──
    if (url.pathname === '/login' && request.method === 'GET') {
      return new Response(buildLoginHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── POST /login ──
    if (url.pathname === '/login' && request.method === 'POST') {
      if (!secret) {
        return new Response(buildLoginHtml('DASHBOARD_PASSWORD not configured on server.'), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      const body = await request.formData();
      const password = body.get('password') || '';
      // Constant-time comparison
      const enc = new TextEncoder();
      const a = enc.encode(password);
      const b = enc.encode(secret);
      let match = a.length === b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) match = ((a[i] ?? 0) === (b[i] ?? 0)) && match;

      if (!match) {
        return new Response(buildLoginHtml('INVALID CREDENTIALS'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      const token = await makeToken(secret);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
        },
      });
    }

    // ── POST /logout ──
    if (url.pathname === '/logout' && request.method === 'POST') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/login',
          'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
        },
      });
    }

    // ── Auth gate — all remaining routes require a valid session ──
    if (secret && !(await isAuthenticated(request, secret))) {
      if (url.pathname === '/api/data') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return new Response(null, { status: 302, headers: { Location: '/login' } });
    }

    // ── GET /api/data ──
    if (url.pathname === '/api/data') {
      if (noCreds) return Response.json({ error: 'Supabase not configured' }, { status: 500 });
      try {
        return Response.json(await fetchDashboardData(sbUrl, anonKey), { headers: { 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // ── 404 ──
    if (url.pathname !== '/' && url.pathname !== '') {
      return new Response('Not Found', { status: 404 });
    }

    // ── GET / ──
    if (noCreds) {
      const html = buildHtml([], {}, {}, 'SUPABASE_URL and SUPABASE_ANON_KEY must be configured.');
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    try {
      const { machines, logsByMachine, statsByMachine } = await fetchDashboardData(sbUrl, anonKey);
      return new Response(buildHtml(machines, logsByMachine, statsByMachine, null), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (err) {
      return new Response(buildHtml([], {}, {}, err.message), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  },
};

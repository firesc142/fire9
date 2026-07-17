function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  };
}

function checkApiKey(request, env) {
  const key = request.headers.get('X-API-Key');
  return key && key === env.API_KEY;
}

async function createSessionToken(env) {
  const token = crypto.randomUUID();
  await env.URL_STORE.put(`session:${token}`, 'valid', { expirationTtl: 86400 });
  return token;
}

async function isValidSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return false;
  const val = await env.URL_STORE.get(`session:${match[1]}`);
  return val === 'valid';
}

async function getMachines(env) {
  let index = [];
  try {
    const raw = await env.URL_STORE.get('machines_index');
    if (raw) index = JSON.parse(raw);
  } catch {}
  const machines = [];
  const now = Date.now();
  for (const id of index) {
    const raw = await env.URL_STORE.get(`machine:${id}`);
    if (!raw) continue;
    try {
      const m = JSON.parse(raw);
      const lastSeen = m.updatedAt ? new Date(m.updatedAt).getTime() : 0;
      const online = (now - lastSeen) < 5 * 60 * 1000;
      machines.push({
        id,
        name: m.name || 'Unknown',
        url: m.url || null,
        updatedAt: m.updatedAt,
        online,
        status: online ? (m.status || 'online') : 'offline'
      });
    } catch {}
  }
  return machines;
}

function loginPage(error = '') {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperfly - Login</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap');
    :root {
      --bg-primary: #0a0a0a; --bg-card: #141414; --border-dim: #222222;
      --border-bright: #2a2a2a; --text-primary: #e8e8e8; --text-dim: #5a5a5a;
      --accent-orange: #e8611a; --accent-red: #ef5350;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Rajdhani', sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: var(--bg-card); border: 1px solid var(--border-dim); border-radius: 2px; width: min(100%, 400px); box-shadow: 0 0 60px rgba(0,0,0,0.8); }
    .card-header { border-bottom: 1px solid var(--border-dim); padding: 1.2rem 1.8rem; display: flex; align-items: center; gap: 1rem; }
    .header-bar { width: 3px; height: 20px; background: var(--accent-orange); }
    .title { font-size: 0.9rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
    .subtitle { font-family: 'Share Tech Mono', monospace; font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.08em; margin-top: 0.2rem; }
    .form-group { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.2rem; }
    .field { display: flex; flex-direction: column; gap: 0.5rem; }
    .label { font-family: 'Share Tech Mono', monospace; font-size: 0.62rem; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; }
    .input { background: var(--bg-primary); border: 1px solid var(--border-bright); padding: 0.65rem 0.9rem; color: var(--text-primary); font-family: 'Rajdhani', sans-serif; font-size: 0.9rem; outline: none; }
    .input:focus { border-color: var(--accent-orange); box-shadow: 0 0 0 1px rgba(232,97,26,0.2); }
    .error { font-family: 'Share Tech Mono', monospace; font-size: 0.7rem; color: var(--accent-red); }
    .btn { padding: 0.8rem; background: var(--text-primary); border: 1px solid var(--text-primary); color: #000; font-family: 'Rajdhani', sans-serif; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; }
    .btn:hover { background: #c0c0c0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="header-bar"></div>
      <div><div class="title">Paperfly</div><div class="subtitle">Remote Desktop Control Panel</div></div>
    </div>
    <form class="form-group" method="POST" action="/login">
      ${error ? '<div class="error">' + error + '</div>' : ''}
      <div class="field"><label class="label">Username</label><input class="input" type="text" name="username" required autofocus></div>
      <div class="field"><label class="label">Password</label><input class="input" type="password" name="password" required></div>
      <button type="submit" class="btn">Sign In</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

function dashboardPage(machines) {
  const machineRows = machines.length === 0
    ? '<p class="empty">No machines registered yet. Install Paperfly on a PC to get started.</p>'
    : machines.map(m => {
      const statusClass = m.status === 'connecting' ? 'connecting' : (m.online ? 'online' : 'offline');
      const statusLabel = m.status === 'connecting' ? 'CONNECTING' : (m.online ? 'ONLINE' : 'OFFLINE');
      return `
      <div class="machine">
        <div class="machine-status"><span class="dot ${statusClass}"></span></div>
        <div class="machine-info">
          <div class="machine-name">${m.name}</div>
          <div class="machine-id">${m.id.slice(0, 8)}</div>
        </div>
        <div class="machine-url">${m.url ? '<a href="' + m.url + '" target="_blank">' + m.url + '</a>' : '<span class="no-url">' + (m.status === 'connecting' ? 'Establishing tunnel...' : 'No URL') + '</span>'}</div>
        <div class="machine-meta">${statusLabel} &mdash; ${m.updatedAt ? new Date(m.updatedAt).toLocaleString() : 'never'}</div>
        <button class="btn-sm" onclick="deleteMachine('${m.id}')">Remove</button>
      </div>`;}).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperfly Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap');
    :root {
      --bg-primary: #0a0a0a; --bg-card: #141414; --border-dim: #222222;
      --border-bright: #2a2a2a; --text-primary: #e8e8e8; --text-secondary: #a0a0a0;
      --text-dim: #5a5a5a; --accent-orange: #e8611a; --accent-green: #3ddc84;
      --accent-red: #ef5350; --accent-blue: #4a9eff;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Rajdhani', sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; padding: 2rem; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-dim); }
    .header-bar { width: 3px; height: 24px; background: var(--accent-orange); }
    .header-title { font-size: 1.1rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
    .header-sub { font-family: 'Share Tech Mono', monospace; font-size: 0.65rem; color: var(--text-dim); margin-top: 0.2rem; }
    .nav { display: flex; gap: 1rem; margin-left: auto; }
    .nav a { font-family: 'Share Tech Mono', monospace; font-size: 0.7rem; color: var(--text-secondary); text-decoration: none; letter-spacing: 0.1em; }
    .nav a:hover { color: var(--accent-orange); }
    .section { background: var(--bg-card); border: 1px solid var(--border-dim); margin-bottom: 1.5rem; }
    .section-header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-dim); display: flex; align-items: center; justify-content: space-between; }
    .section-title { font-family: 'Share Tech Mono', monospace; font-size: 0.7rem; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; }
    .section-count { font-family: 'Share Tech Mono', monospace; font-size: 0.65rem; color: var(--accent-orange); }
    .machine-list { padding: 0; }
    .machine { display: grid; grid-template-columns: 30px 1fr 1fr auto auto; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-dim); }
    .machine:last-child { border-bottom: none; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot.online { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
    .dot.connecting { background: #ffa726; box-shadow: 0 0 6px #ffa726; animation: pulse 1.2s infinite; }
    .dot.offline { background: var(--accent-red); box-shadow: 0 0 6px var(--accent-red); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .machine-name { font-weight: 600; font-size: 0.9rem; }
    .machine-id { font-family: 'Share Tech Mono', monospace; font-size: 0.6rem; color: var(--text-dim); }
    .machine-url a { font-family: 'Share Tech Mono', monospace; font-size: 0.7rem; color: var(--accent-blue); text-decoration: none; word-break: break-all; }
    .machine-url a:hover { text-decoration: underline; }
    .no-url { font-family: 'Share Tech Mono', monospace; font-size: 0.7rem; color: var(--text-dim); }
    .machine-meta { font-family: 'Share Tech Mono', monospace; font-size: 0.6rem; color: var(--text-dim); white-space: nowrap; }
    .btn-sm { font-family: 'Share Tech Mono', monospace; font-size: 0.6rem; background: transparent; border: 1px solid var(--border-bright); color: var(--text-secondary); padding: 0.3rem 0.6rem; cursor: pointer; letter-spacing: 0.1em; }
    .btn-sm:hover { border-color: var(--accent-red); color: var(--accent-red); }
    .btn-refresh { border-color: var(--accent-orange); color: var(--accent-orange); }
    .btn-refresh:hover { background: rgba(232,97,26,0.08); border-color: var(--accent-orange); color: var(--accent-orange); }
    .empty { padding: 2rem 1.5rem; font-family: 'Share Tech Mono', monospace; font-size: 0.75rem; color: var(--text-dim); text-align: center; }
    .pin-section { padding: 1.5rem; }
    .pin-form { display: flex; gap: 0.8rem; align-items: center; }
    .pin-input { background: var(--bg-primary); border: 1px solid var(--border-bright); padding: 0.5rem 0.8rem; color: var(--text-primary); font-family: 'Share Tech Mono', monospace; font-size: 0.8rem; width: 120px; outline: none; }
    .pin-input:focus { border-color: var(--accent-orange); }
    .pin-btn { padding: 0.5rem 1rem; background: var(--accent-orange); border: none; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
    .pin-btn:hover { background: #d4550f; }
    .pin-msg { font-family: 'Share Tech Mono', monospace; font-size: 0.65rem; color: var(--accent-green); margin-left: 0.5rem; }
    .last-refresh { font-family: 'Share Tech Mono', monospace; font-size: 0.6rem; color: var(--text-dim); }
    @media (max-width: 700px) {
      .machine { grid-template-columns: 1fr; gap: 0.5rem; }
      .machine-status { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-bar"></div>
      <div><div class="header-title">Paperfly</div><div class="header-sub">Multi-PC Remote Desktop Dashboard</div></div>
      <div class="nav"><a href="/logout">LOGOUT</a></div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">Connected Machines</span>
        <div style="display:flex;align-items:center;gap:0.8rem;">
          <span class="last-refresh" id="lastRefresh"></span>
          <span class="section-count" id="machineCount">${machines.length} registered</span>
          <button class="btn-sm btn-refresh" id="refreshBtn" onclick="refreshMachines()" title="Refresh machine list">&#x21bb; REFRESH</button>
        </div>
      </div>
      <div class="machine-list" id="machineList">${machineRows}</div>
    </div>

    <div class="section">
      <div class="section-header"><span class="section-title">Access PIN</span></div>
      <div class="pin-section">
        <form class="pin-form" id="pinForm">
          <input class="pin-input" type="text" id="pinInput" placeholder="New PIN" pattern="[0-9]{4,8}" required>
          <button type="submit" class="pin-btn">Update PIN</button>
          <span class="pin-msg" id="pinMsg"></span>
        </form>
      </div>
    </div>
  </div>
  <script>
    function showToast(message, type) {
      var existing = document.getElementById('toast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.id = 'toast';
      toast.textContent = message;
      toast.style.cssText = 'position:fixed;top:1.5rem;right:1.5rem;padding:0.7rem 1.2rem;font-family:Share Tech Mono,monospace;font-size:0.75rem;letter-spacing:0.08em;border:1px solid;z-index:9999;animation:fadeIn 0.3s ease;';
      if (type === 'success') {
        toast.style.background = '#1a2e1a';
        toast.style.color = '#3ddc84';
        toast.style.borderColor = '#2a4a2a';
      } else {
        toast.style.background = '#2e1a1a';
        toast.style.color = '#ef5350';
        toast.style.borderColor = '#4a2a2a';
      }
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3000);
    }

    async function deleteMachine(id) {
      if (!confirm('Remove this machine from the dashboard?')) return;
      var res = await fetch('/api/machines/' + id, { method: 'DELETE' });
      if (res.ok) { showToast('Machine removed', 'success'); refreshMachines(); }
      else showToast('Failed to remove machine', 'error');
    }

    function renderMachines(machines) {
      var list = document.getElementById('machineList');
      var count = document.getElementById('machineCount');
      var onlineCount = machines.filter(function(m) { return m.online; }).length;
      count.textContent = onlineCount + '/' + machines.length + ' online';
      if (machines.length === 0) {
        list.innerHTML = '<p class="empty">No machines registered yet. Install Paperfly on a PC to get started.</p>';
        return;
      }
      list.innerHTML = machines.map(function(m) {
        var statusClass = m.online ? (m.status === 'connecting' ? 'connecting' : 'online') : 'offline';
        var statusText = m.online ? (m.status === 'connecting' ? 'CONNECTING' : 'ONLINE') : 'OFFLINE';
        var urlHtml = m.url ? '<a href="' + m.url + '" target="_blank">' + m.url + '</a>' : '<span class="no-url">' + (m.status === 'connecting' ? 'Establishing tunnel...' : 'No URL') + '</span>';
        var meta = statusText + ' \\u2014 ' + (m.updatedAt ? new Date(m.updatedAt).toLocaleString() : 'never');
        return '<div class="machine">' +
          '<div class="machine-status"><span class="dot ' + statusClass + '"></span></div>' +
          '<div class="machine-info"><div class="machine-name">' + m.name + '</div><div class="machine-id">' + m.id.slice(0,8) + '</div></div>' +
          '<div class="machine-url">' + urlHtml + '</div>' +
          '<div class="machine-meta">' + meta + '</div>' +
          '<button class="btn-sm" onclick="deleteMachine(\\x27' + m.id + '\\x27)">Remove</button>' +
        '</div>';
      }).join('');
    }

    async function refreshMachines() {
      var btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      btn.textContent = '...';
      try {
        var res = await fetch('/api/machines');
        if (res.ok) {
          var data = await res.json();
          renderMachines(data.machines);
          document.getElementById('lastRefresh').textContent = 'updated ' + new Date().toLocaleTimeString();
        }
      } catch(e) {
        showToast('Failed to refresh', 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '&#x21bb; REFRESH';
    }

    document.getElementById('pinForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var pin = document.getElementById('pinInput').value;
      var res = await fetch('/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin })
      });
      if (res.ok) showToast('PIN updated successfully', 'success');
      else showToast('Failed to update PIN', 'error');
      document.getElementById('pinInput').value = '';
    });
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // --- API: Push URL (with machine identity) ---
    if (request.method === 'POST' && url.pathname === '/api/url') {
      if (!checkApiKey(request, env)) {
        return new Response('Forbidden', { status: 403 });
      }
      const body = await request.json();
      const tunnelUrl = body.url;
      const machineId = body.machineId;
      const machineName = body.machineName || 'Unknown';
      const status = body.status || 'online';

      if (!machineId && !tunnelUrl) {
        return new Response('Missing machineId or url field', { status: 400 });
      }

      if (machineId) {
        // Single KV write per machine (consolidates 4 separate puts into 1)
        const machineData = {
          url: tunnelUrl || null,
          name: machineName,
          updatedAt: new Date().toISOString(),
          status
        };
        await env.URL_STORE.put(`machine:${machineId}`, JSON.stringify(machineData));

        let index = [];
        try {
          const raw = await env.URL_STORE.get('machines_index');
          if (raw) index = JSON.parse(raw);
        } catch {}
        if (!index.includes(machineId)) {
          index.push(machineId);
          await env.URL_STORE.put('machines_index', JSON.stringify(index));
        }
      }

      // Backward compat: store the latest URL flat
      if (tunnelUrl) {
        await env.URL_STORE.put('tunnel_url', tunnelUrl);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: Machine going offline ---
    if (request.method === 'POST' && url.pathname === '/api/offline') {
      if (!checkApiKey(request, env)) {
        return new Response('Forbidden', { status: 403 });
      }
      const body = await request.json();
      const machineId = body.machineId;
      if (machineId) {
        const machineData = { url: null, name: 'Unknown', updatedAt: '2000-01-01T00:00:00.000Z', status: 'offline' };
        // Preserve machine name from existing data
        try {
          const raw = await env.URL_STORE.get(`machine:${machineId}`);
          if (raw) {
            const existing = JSON.parse(raw);
            machineData.name = existing.name || 'Unknown';
          }
        } catch {}
        await env.URL_STORE.put(`machine:${machineId}`, JSON.stringify(machineData));
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: Get URL (legacy single-machine) ---
    if (request.method === 'GET' && url.pathname === '/api/url') {
      const hasSession = await isValidSession(request, env);
      if (!hasSession && !checkApiKey(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const tunnelUrl = await env.URL_STORE.get('tunnel_url');
      return new Response(JSON.stringify({ url: tunnelUrl }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: List machines ---
    if (request.method === 'GET' && url.pathname === '/api/machines') {
      const hasSession = await isValidSession(request, env);
      if (!hasSession && !checkApiKey(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const machines = await getMachines(env);
      return new Response(JSON.stringify({ machines }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: Delete machine ---
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/machines/')) {
      const hasSession = await isValidSession(request, env);
      if (!hasSession && !checkApiKey(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const machineId = url.pathname.replace('/api/machines/', '');
      await env.URL_STORE.delete(`machine:${machineId}`);

      let index = [];
      try {
        const raw = await env.URL_STORE.get('machines_index');
        if (raw) index = JSON.parse(raw);
      } catch {}
      index = index.filter(id => id !== machineId);
      await env.URL_STORE.put('machines_index', JSON.stringify(index));

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: Get PIN ---
    if (request.method === 'GET' && url.pathname === '/api/pin') {
      if (!checkApiKey(request, env)) {
        return new Response('Forbidden', { status: 403 });
      }
      const pinHash = await env.URL_STORE.get('pin_hash');
      return new Response(JSON.stringify({ pin_hash: pinHash }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- API: Set PIN ---
    if (request.method === 'POST' && url.pathname === '/api/pin') {
      const hasSession = await isValidSession(request, env);
      if (!hasSession && !checkApiKey(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const body = await request.json();
      if (!body.pin || body.pin.length < 4 || body.pin.length > 8) {
        return new Response('PIN must be 4-8 digits', { status: 400 });
      }
      const encoder = new TextEncoder();
      const data = encoder.encode(String(body.pin));
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      await env.URL_STORE.put('pin_hash', hashHex);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // --- Auth: Login page ---
    if (url.pathname === '/login' && request.method === 'GET') {
      return loginPage();
    }

    // --- Auth: Login POST ---
    if (url.pathname === '/login' && request.method === 'POST') {
      const formData = await request.formData();
      const username = formData.get('username');
      const password = formData.get('password');
      if (username === env.AUTH_USERNAME && password === env.AUTH_PASSWORD) {
        const token = await createSessionToken(env);
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
          }
        });
      }
      return loginPage('Invalid credentials');
    }

    // --- Auth: Logout ---
    if (url.pathname === '/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/login',
          'Set-Cookie': 'session=; Path=/; Max-Age=0'
        }
      });
    }

    // --- Dashboard ---
    if (url.pathname === '/' && request.method === 'GET') {
      const hasSession = await isValidSession(request, env);
      if (!hasSession) {
        return Response.redirect(url.origin + '/login', 302);
      }
      const machines = await getMachines(env);
      return dashboardPage(machines);
    }

    return new Response('Not Found', { status: 404 });
  }
};

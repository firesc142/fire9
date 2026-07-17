import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';

const PASSWORD = 'test-secret-pw';
const SUPABASE = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake-key' };
const FULL_ENV = { ...SUPABASE, DASHBOARD_PASSWORD: PASSWORD };
const NO_AUTH = { ...SUPABASE };                     // no password configured
const NO_CREDS = { DASHBOARD_PASSWORD: PASSWORD };   // password but no supabase

const NOW = new Date().toISOString();
const MACHINE = {
	machine_id: 'abc', machine_name: 'MyPC', platform: 'win32',
	memory_percent: 40, used_memory: 4294967296, total_memory: 8589934592,
	uptime: 7200, node_version: 'v20.0.0', load_average: [0, 0, 0],
	tunnel_url: 'https://test-tunnel.trycloudflare.com', last_updated: NOW
};
const LOG = {
	id: 'l1', machine_id: 'abc', machine_name: 'MyPC',
	category: 'server', level: 'info', message: 'up', data: {}, created_at: NOW
};

function mockSupabase({ machines = [], logs = [] } = {}) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u.includes('/machines')) return new Response(JSON.stringify(machines), { status: 200, headers: { 'Content-Type': 'application/json' } });
		if (u.includes('/logs')) return new Response(JSON.stringify(logs), { status: 200, headers: { 'Content-Type': 'application/json' } });
		return new Response('not found', { status: 404 });
	});
}

async function getSessionCookie(env = FULL_ENV) {
	const form = new FormData();
	form.append('password', PASSWORD);
	const res = await worker.fetch(new Request('http://x/login', { method: 'POST', body: form }), env, createExecutionContext());
	const cookie = res.headers.get('Set-Cookie') || '';
	const match = cookie.match(/paperfly_session=([^;]+)/);
	return match ? match[1] : null;
}

function authedRequest(path, token, opts = {}) {
	return new Request(`http://x${path}`, {
		...opts,
		headers: { ...(opts.headers || {}), Cookie: `paperfly_session=${token}` },
	});
}

// ── GET /login ────────────────────────────────────────────────────────────────
describe('GET /login', () => {
	it('returns login page HTML', async () => {
		const res = await worker.fetch(new Request('http://x/login'), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/html');
		const body = await res.text();
		expect(body).toContain('AUTHENTICATE');
		expect(body).toContain('PAPERFLY');
		expect(body).toContain('SECURE ACCESS TERMINAL');
	});
});

// ── POST /login ───────────────────────────────────────────────────────────────
describe('POST /login', () => {
	it('redirects to / with cookie on correct password', async () => {
		const form = new FormData();
		form.append('password', PASSWORD);
		const res = await worker.fetch(new Request('http://x/login', { method: 'POST', body: form }), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/');
		expect(res.headers.get('Set-Cookie')).toContain('paperfly_session=');
		expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
		expect(res.headers.get('Set-Cookie')).toContain('Secure');
	});

	it('returns 401 on wrong password', async () => {
		const form = new FormData();
		form.append('password', 'wrong-pw');
		const res = await worker.fetch(new Request('http://x/login', { method: 'POST', body: form }), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(401);
		const body = await res.text();
		expect(body).toContain('INVALID CREDENTIALS');
	});
});

// ── POST /logout ──────────────────────────────────────────────────────────────
describe('POST /logout', () => {
	it('clears cookie and redirects to /login', async () => {
		const token = await getSessionCookie();
		const res = await worker.fetch(authedRequest('/logout', token, { method: 'POST' }), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/login');
		expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
	});
});

// ── Auth gate ─────────────────────────────────────────────────────────────────
describe('Auth gate', () => {
	it('redirects unauthenticated GET / to /login', async () => {
		const spy = mockSupabase();
		const res = await worker.fetch(new Request('http://x/'), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/login');
		spy.mockRestore();
	});

	it('returns 401 JSON for unauthenticated /api/data', async () => {
		const res = await worker.fetch(new Request('http://x/api/data'), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(401);
		expect((await res.json()).error).toContain('Unauthorized');
	});

	it('allows access when no DASHBOARD_PASSWORD set (open mode)', async () => {
		const spy = mockSupabase();
		const res = await worker.fetch(new Request('http://x/'), NO_AUTH, createExecutionContext());
		expect(res.status).toBe(200);
		spy.mockRestore();
	});
});

// ── GET / (authenticated) ─────────────────────────────────────────────────────
describe('GET / (authenticated)', () => {
	let spy;
	beforeEach(() => { spy = mockSupabase({ machines: [MACHINE], logs: [LOG] }); });
	afterEach(() => spy.mockRestore());

	it('returns dashboard HTML with logout button', async () => {
		const token = await getSessionCookie();
		const res = await worker.fetch(authedRequest('/', token), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('PAPERFLY CONTROL');
		expect(body).toContain('LOGOUT');
		expect(body).toContain('MyPC');
		expect(body).toContain('test-tunnel.trycloudflare.com');
	});

	it('contains auto-refresh interval', async () => {
		const token = await getSessionCookie();
		const res = await worker.fetch(authedRequest('/', token), FULL_ENV, createExecutionContext());
		expect(await res.text()).toContain('30000');
	});
});

// ── GET /api/data (authenticated) ────────────────────────────────────────────
describe('GET /api/data (authenticated)', () => {
	let spy;
	beforeEach(() => { spy = mockSupabase({ machines: [MACHINE], logs: [LOG, { ...LOG, id: 'l2', level: 'error' }] }); });
	afterEach(() => spy.mockRestore());

	it('returns machines, logsByMachine, statsByMachine, timestamp', async () => {
		const token = await getSessionCookie();
		const res = await worker.fetch(authedRequest('/api/data', token), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveProperty('machines');
		expect(data).toHaveProperty('logsByMachine');
		expect(data).toHaveProperty('statsByMachine');
		expect(data).toHaveProperty('timestamp');
		expect(data.machines[0].tunnel_url).toBe('https://test-tunnel.trycloudflare.com');
	});

	it('stats byLevel counts errors correctly', async () => {
		const token = await getSessionCookie();
		const res = await worker.fetch(authedRequest('/api/data', token), FULL_ENV, createExecutionContext());
		const data = await res.json();
		expect(data.statsByMachine['abc'].byLevel.error).toBe(1);
		expect(data.statsByMachine['abc'].total).toBe(2);
	});

	it('returns 500 when supabase not configured', async () => {
		spy.mockRestore();
		const token = await getSessionCookie(NO_CREDS);
		const res = await worker.fetch(authedRequest('/api/data', token), NO_CREDS, createExecutionContext());
		expect(res.status).toBe(500);
	});
});

// ── 404 ───────────────────────────────────────────────────────────────────────
describe('Unknown routes', () => {
	it('returns 404', async () => {
		const res = await worker.fetch(new Request('http://x/unknown'), FULL_ENV, createExecutionContext());
		expect(res.status).toBe(404);
	});
});

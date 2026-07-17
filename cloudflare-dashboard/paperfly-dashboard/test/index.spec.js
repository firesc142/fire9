import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, {
	base64urlEncode,
	convertLogsToArray,
	defaultMetrics,
} from '../src/index.js';

// ── base64urlEncode ───────────────────────────────────────────────────────────

describe('base64urlEncode', () => {
	it('encodes empty buffer to empty string', () => {
		expect(base64urlEncode(new Uint8Array([]))).toBe('');
	});

	it('replaces + with - and / with _', () => {
		// 0xfb = 11111011, produces base64 '+' character; 0xff / 0xfe produce '/'
		const result = base64urlEncode(new Uint8Array([0xfb, 0xff, 0xfe]));
		expect(result).not.toContain('+');
		expect(result).not.toContain('/');
		expect(result).not.toContain('=');
	});

	it('strips padding =', () => {
		const result = base64urlEncode(new Uint8Array([0x01]));
		expect(result).not.toContain('=');
	});

	it('accepts ArrayBuffer', () => {
		const buf = new Uint8Array([65, 66, 67]).buffer; // "ABC"
		const result = base64urlEncode(buf);
		expect(result).toBe('QUJD');
	});
});

// ── convertLogsToArray ────────────────────────────────────────────────────────

describe('convertLogsToArray', () => {
	it('returns [] for null input', () => {
		expect(convertLogsToArray(null)).toEqual([]);
	});

	it('returns [] for non-object inputs', () => {
		expect(convertLogsToArray('string')).toEqual([]);
		expect(convertLogsToArray(42)).toEqual([]);
		expect(convertLogsToArray(undefined)).toEqual([]);
	});

	it('returns [] for array input', () => {
		expect(convertLogsToArray([])).toEqual([]);
		expect(convertLogsToArray([{ timestamp: 1 }])).toEqual([]);
	});

	it('converts an object to an array with id set to key', () => {
		const input = {
			'key-1': { timestamp: '2024-01-01T00:00:00Z', message: 'hello' },
			'key-2': { timestamp: '2024-01-02T00:00:00Z', message: 'world' },
		};
		const result = convertLogsToArray(input);
		expect(result).toHaveLength(2);
		const ids = result.map(e => e.id);
		expect(ids).toContain('key-1');
		expect(ids).toContain('key-2');
	});

	it('sorts descending by timestamp (ISO strings)', () => {
		const input = {
			a: { timestamp: '2024-01-01T00:00:00Z' },
			b: { timestamp: '2024-01-03T00:00:00Z' },
			c: { timestamp: '2024-01-02T00:00:00Z' },
		};
		const result = convertLogsToArray(input);
		expect(result[0].timestamp).toBe('2024-01-03T00:00:00Z');
		expect(result[1].timestamp).toBe('2024-01-02T00:00:00Z');
		expect(result[2].timestamp).toBe('2024-01-01T00:00:00Z');
	});

	it('limits output to 100 entries', () => {
		const input = {};
		for (let i = 0; i < 150; i++) {
			input[`key-${i}`] = { timestamp: i };
		}
		const result = convertLogsToArray(input);
		expect(result).toHaveLength(100);
	});

	it('keeps the 100 most recent when truncating', () => {
		const input = {};
		for (let i = 0; i < 120; i++) {
			input[`key-${i}`] = { timestamp: i };
		}
		const result = convertLogsToArray(input);
		// All returned entries should have timestamp >= 20 (the top 100 out of 120)
		const minTs = Math.min(...result.map(e => e.timestamp));
		expect(minTs).toBeGreaterThanOrEqual(20);
	});
});

// ── defaultMetrics ────────────────────────────────────────────────────────────

describe('defaultMetrics', () => {
	it('returns an object with all expected fields', () => {
		const m = defaultMetrics();
		expect(m.machineId).toBe('unknown');
		expect(m.machineName).toBe('unknown');
		expect(m.timestamp).toBe(0);
		expect(m.cpuUsage).toBe(0);
		expect(m.totalMemory).toBe(0);
		expect(m.freeMemory).toBe(0);
		expect(m.usedMemory).toBe(0);
		expect(m.memoryPercent).toBe(0);
		expect(m.uptime).toBe(0);
		expect(m.platform).toBe('unknown');
		expect(m.nodeVersion).toBe('unknown');
		expect(m.loadAverage).toEqual([0, 0, 0]);
		expect(m.lastUpdated).toBe(0);
	});

	it('returns a fresh object each call (no shared reference)', () => {
		const a = defaultMetrics();
		const b = defaultMetrics();
		a.machineId = 'modified';
		expect(b.machineId).toBe('unknown');
	});
});

// ── Worker routing ────────────────────────────────────────────────────────────

describe('Worker routing', () => {
	it('returns 500 when required secrets are missing', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		// env from cloudflare:test has no secrets set
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).toContain('Missing secrets');
	});

	it('returns 404 for non-root paths when secrets are present', async () => {
		const request = new Request('http://example.com/unknown-path');
		const ctx = createExecutionContext();
		const fakeEnv = {
			FIREBASE_PROJECT_ID: 'proj',
			FIREBASE_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com',
			FIREBASE_PRIVATE_KEY: 'fake-key',
			FIREBASE_DATABASE_URL: 'https://example.firebaseio.com',
			FIREBASE_MACHINE_ID: 'machine-1',
		};
		const response = await worker.fetch(request, fakeEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		const body = await response.text();
		expect(body).toBe('Not Found');
	});
});

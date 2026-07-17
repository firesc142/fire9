'use strict';

/**
 * Supabase logger for Paperfly.
 *
 * Data shapes match server.js REST API exactly:
 *
 *  machines row  ←→  GET /api/v1/dashboard/info  →  data.metrics
 *  logs row      ←→  GET /api/v1/dashboard/logs  →  data.logs[]
 *
 * machines columns:
 *   machine_id, machine_name, platform, tunnel_url,
 *   cpu_usage (0-100 float), memory_percent (0-100 int),
 *   used_memory (bytes), total_memory (bytes),
 *   uptime (seconds), node_version, load_average (float[]),
 *   last_updated (timestamptz)
 *
 * logs columns:
 *   id, machine_id, machine_name, category, level, message, data, created_at
 */

const os = require('os');
const { getSupabaseClient, isSupabaseReady } = require('./supabase-config');
const { getConfig } = require('./config');

// ── Local log buffer (last 100 entries, same as /api/v1/dashboard/logs) ───────

const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// ── CPU usage tracking (delta-based, matches what /info reports as %) ─────────

let _lastCpuSample = process.cpuUsage();   // { user, system } in µs
let _lastCpuTime = process.hrtime.bigint();  // wall-clock nanoseconds

/**
 * Returns CPU usage as a 0-100 float (e.g. 12.5 = 12.5%).
 * Computed as delta CPU time / delta wall time across all logical cores.
 */
function getCpuPercent() {
    const nowCpu = process.cpuUsage();
    const nowTime = process.hrtime.bigint();

    const cpuDeltaUs = (nowCpu.user - _lastCpuSample.user) + (nowCpu.system - _lastCpuSample.system);
    const wallDeltaNs = Number(nowTime - _lastCpuTime);

    _lastCpuSample = nowCpu;
    _lastCpuTime = nowTime;

    if (wallDeltaNs <= 0) return 0;
    // cpuDeltaUs is in microseconds, wallDeltaNs in nanoseconds
    const percent = (cpuDeltaUs * 1000 / wallDeltaNs) * 100;
    return Math.min(Math.round(percent * 10) / 10, 100); // 1 decimal, cap at 100
}

// ── Machine metrics (shape mirrors /api/v1/dashboard/info → data.metrics) ─────

function getMachineMetrics() {
    const config = getConfig();
    const { getTunnelUrl } = (() => {
        try { return require('./tunnel'); } catch { return { getTunnelUrl: () => null }; }
    })();

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
        machineId: config.machineId,
        machineName: config.machineName || os.hostname(),
        tunnelUrl: getTunnelUrl ? getTunnelUrl() : null,
        timestamp: Date.now(),
        cpuUsage: getCpuPercent(),          // 0-100 float
        memoryPercent: Math.round((usedMem / totalMem) * 100),
        usedMemory: usedMem,
        totalMemory: totalMem,
        freeMemory: freeMem,
        uptime: os.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        loadAverage: os.loadavg(),
    };
}

// kept for back-compat
function updateMachineMetrics() {
    return getMachineMetrics();
}

// ── Supabase writes ───────────────────────────────────────────────────────────

async function sendLogToSupabase(entry) {
    const client = getSupabaseClient();
    if (!client) return;
    try {
        const { error } = await client.from('logs').insert({
            id: entry.id,
            machine_id: entry.machineId,
            machine_name: entry.machineName,
            category: entry.category,
            level: entry.level,
            message: entry.message,
            data: entry.data || {},
            created_at: entry.timestamp,   // ISO string, matches server.js timestamp field
        });
        if (error) {
            console.warn('[supabase] Log insert failed:', error.message, error.details || '');
        }
    } catch (err) {
        console.warn('[supabase] Log insert exception:', err.message);
    }
}

async function pushMachineMetrics() {
    const m = getMachineMetrics();
    const client = getSupabaseClient();
    if (!client || !m.machineId) return;

    const row = {
        machine_id: m.machineId,
        machine_name: m.machineName,
        platform: m.platform,
        tunnel_url: m.tunnelUrl,
        cpu_usage: m.cpuUsage,        // 0-100 float
        memory_percent: m.memoryPercent,   // 0-100 int
        used_memory: m.usedMemory,
        total_memory: m.totalMemory,
        uptime: m.uptime,
        node_version: m.nodeVersion,
        load_average: m.loadAverage,
        last_updated: new Date().toISOString(),
    };

    try {
        const { error } = await client.from('machines').upsert(row, { onConflict: 'machine_id' });
        if (error) {
            // tunnel_url column may not exist in older schemas — retry without it
            if (error.message && error.message.includes('tunnel_url')) {
                const { tunnel_url, ...rowWithoutTunnel } = row;
                const { error: error2 } = await client.from('machines').upsert(rowWithoutTunnel, { onConflict: 'machine_id' });
                if (error2) {
                    console.warn('[supabase] Metrics upsert failed:', error2.message, error2.details || '');
                }
            } else {
                console.warn('[supabase] Metrics upsert failed:', error.message, error.details || '');
            }
        }
    } catch (err) {
        console.warn('[supabase] Metrics upsert exception:', err.message);
    }
}

// ── Main log function (shape matches /api/v1/dashboard/logs → data.logs[]) ────

function log(category, message, level = 'info', data = null) {
    const config = getConfig();
    const timestamp = new Date().toISOString();

    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp,                               // used by server.js REST API
        machineId: config.machineId,
        machineName: config.machineName || os.hostname(),
        category,
        level,
        message,
        data: data || {},
    };

    // Local buffer (read by /api/v1/dashboard/logs)
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

    // Supabase (fire-and-forget)
    if (isSupabaseReady()) sendLogToSupabase(entry);

    // Console
    const sym = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[${category}] ${sym} ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
}

function getLocalLogs() {
    return logBuffer;
}

function clearLogs() {
    logBuffer = [];
}

// ── Categories & Levels ───────────────────────────────────────────────────────

const CATEGORIES = {
    TUNNEL: 'tunnel',
    SERVER: 'server',
    AUTH: 'auth',
    SCREEN: 'screen',
    TERMINAL: 'terminal',
    FILES: 'files',
    CLIPBOARD: 'clipboard',
    MONITORS: 'monitors',
    PRIVACY: 'privacy',
};

const LEVELS = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    DEBUG: 'debug',
};

module.exports = {
    log,
    getLocalLogs,
    getMachineMetrics,
    pushMachineMetrics,
    clearLogs,
    updateMachineMetrics,
    CATEGORIES,
    LEVELS,
};

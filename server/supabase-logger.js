/**
 * Supabase logger — replaces firebase-logger.js.
 *
 * Responsibilities:
 *  - Maintain a local in-memory log buffer (last 100 entries)
 *  - Insert log entries into Supabase `logs` table
 *  - Upsert machine metrics into Supabase `machines` table every 30 s
 *  - Expose the same API surface as firebase-logger so server.js needs
 *    only its import lines changed
 */

const os = require('os');
const { getSupabaseClient, isSupabaseReady } = require('./supabase-config');
const { getConfig } = require('./config');

// ── Local buffer ──────────────────────────────────────────────────────────────

const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// ── Metrics ───────────────────────────────────────────────────────────────────

let machineMetrics = null;

function updateMachineMetrics() {
    const config = getConfig();
    machineMetrics = {
        machineId: config.machineId,
        machineName: config.machineName || os.hostname(),
        timestamp: Date.now(),
        cpuUsage: process.cpuUsage().user / 1_000_000,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        usedMemory: os.totalmem() - os.freemem(),
        memoryPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        uptime: os.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        loadAverage: os.loadavg(),
    };
    return machineMetrics;
}

function getMachineMetrics() {
    return updateMachineMetrics();
}

// ── Supabase writes ───────────────────────────────────────────────────────────

async function sendLogToSupabase(entry) {
    const client = getSupabaseClient();
    if (!client) return;

    try {
        await client.from('logs').insert({
            id: entry.id,
            machine_id: entry.machineId,
            machine_name: entry.machineName,
            category: entry.category,
            level: entry.level,
            message: entry.message,
            data: entry.data || {},
            created_at: entry.timestamp,
        });
    } catch (err) {
        // Silently fail — don't spam the console on every log line
    }
}

async function pushMachineMetrics() {
    const m = updateMachineMetrics();
    const client = getSupabaseClient();
    if (!client || !m.machineId) return;

    try {
        await client.from('machines').upsert({
            machine_id: m.machineId,
            machine_name: m.machineName,
            platform: m.platform,
            cpu_usage: m.cpuUsage,
            memory_percent: m.memoryPercent,
            used_memory: m.usedMemory,
            total_memory: m.totalMemory,
            uptime: m.uptime,
            node_version: m.nodeVersion,
            load_average: m.loadAverage,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'machine_id' });
    } catch (err) {
        // Silently fail
    }
}

// ── Main log function ─────────────────────────────────────────────────────────

function log(category, message, level = 'info', data = null) {
    const config = getConfig();
    const timestamp = new Date().toISOString();

    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp,
        machineId: config.machineId,
        machineName: config.machineName || os.hostname(),
        category,
        level,
        message,
        data: data || {},
    };

    // Local buffer
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

    // Remote write (fire-and-forget)
    if (isSupabaseReady()) sendLogToSupabase(entry);

    // Console
    const symbol = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[${category}] ${symbol} ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
}

function getLocalLogs() {
    return logBuffer;
}

function clearLogs() {
    logBuffer = [];
}

// ── Categories & Levels (same constants as before) ────────────────────────────

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

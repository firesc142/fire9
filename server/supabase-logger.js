'use strict';

/**
 * Local logger for PaperCMD.
 * Keeps an in-memory buffer of the last 100 log entries served by the
 * local REST API (/api/v1/dashboard/logs).  No external database writes.
 */

const os = require('os');
const { getConfig } = require('./config');

const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// ── CPU usage (delta-based) ───────────────────────────────────────────────────

let _lastCpuSample = process.cpuUsage();
let _lastCpuTime = process.hrtime.bigint();

function getCpuPercent() {
    const nowCpu = process.cpuUsage();
    const nowTime = process.hrtime.bigint();
    const cpuDeltaUs = (nowCpu.user - _lastCpuSample.user) + (nowCpu.system - _lastCpuSample.system);
    const wallDeltaNs = Number(nowTime - _lastCpuTime);
    _lastCpuSample = nowCpu;
    _lastCpuTime = nowTime;
    if (wallDeltaNs <= 0) return 0;
    return Math.min(Math.round((cpuDeltaUs * 1000 / wallDeltaNs) * 100 * 10) / 10, 100);
}

// ── Machine metrics ───────────────────────────────────────────────────────────

function getMachineMetrics() {
    const config = require('./config').getConfig();
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
        cpuUsage: getCpuPercent(),
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

function updateMachineMetrics() { return getMachineMetrics(); }

// No-op kept so any code that still imports pushMachineMetrics doesn't throw
function pushMachineMetrics() { return Promise.resolve(); }

// ── Log function ──────────────────────────────────────────────────────────────

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
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
    const sym = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[${category}] ${sym} ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
}

function getLocalLogs() { return logBuffer; }
function clearLogs() { logBuffer = []; }

// ── Categories & Levels ───────────────────────────────────────────────────────

const CATEGORIES = {
    TUNNEL: 'tunnel', SERVER: 'server', AUTH: 'auth', SCREEN: 'screen',
    TERMINAL: 'terminal', FILES: 'files', CLIPBOARD: 'clipboard',
    MONITORS: 'monitors', PRIVACY: 'privacy',
};
const LEVELS = { INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug' };

module.exports = { log, getLocalLogs, getMachineMetrics, pushMachineMetrics, clearLogs, updateMachineMetrics, CATEGORIES, LEVELS };

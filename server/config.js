const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');


const CONFIG_DIR = path.join(os.homedir(), '.paperfly');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  machineId: null,
  machineName: os.hostname(),
  pin_hash: 'e5ae86cc55fd690333095a4b02a4da5c1900ac0f768fdf308149127648174d50',
  port: 3000,
  session_secret: crypto.randomUUID(),
  tunnel: {
    subdomain: null,
    url: null
  },
  urlWorker: {
    endpoint: "https://paperfly-url.bluetalefox.workers.dev/api/url",
    apiKey: "9f5f9c9f0b1a4b7ea8c3e1d7f6a2b9c4d8e7f1a3c5b6d9e0f2a4c6b8d1e3f5a"
  }
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function getConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...saved };

    // Deep-merge nested objects so null values in saved config
    // don't clobber valid defaults (e.g. urlWorker.endpoint)
    for (const key of ['tunnel', 'urlWorker']) {
      if (DEFAULT_CONFIG[key] && typeof DEFAULT_CONFIG[key] === 'object') {
        const defaultSection = DEFAULT_CONFIG[key];
        const savedSection = saved[key] || {};
        merged[key] = { ...defaultSection };
        for (const [k, v] of Object.entries(savedSection)) {
          if (v !== null && v !== undefined) {
            merged[key][k] = v;
          }
        }
      }
    }

    // Auto-generate machineId on first run
    if (!merged.machineId) {
      merged.machineId = crypto.randomUUID();
      merged.machineName = merged.machineName || os.hostname();
      saveConfig(merged);
    }

    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function updateConfig(partial) {
  const current = getConfig();
  const merged = { ...current, ...partial };
  if (partial.tunnel) {
    merged.tunnel = { ...current.tunnel, ...partial.tunnel };
  }
  saveConfig(merged);
  return merged;
}

module.exports = { getConfig, saveConfig, updateConfig, CONFIG_DIR, CONFIG_FILE };

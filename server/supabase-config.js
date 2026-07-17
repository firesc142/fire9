/**
 * Supabase client configuration for the local Paperfly server.
 *
 * Reads credentials from environment variables:
 *   SUPABASE_URL          - e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  - service_role key (has full write access)
 *
 * The service_role key bypasses Row Level Security so the server can
 * insert rows without needing an authenticated user.
 *
 * Required Supabase tables (run SUPABASE_SETUP.sql to create them):
 *   machines (machine_id, machine_name, platform, cpu_usage, memory_percent,
 *             used_memory, total_memory, uptime, node_version, load_average,
 *             last_updated)
 *   logs     (id, machine_id, machine_name, category, level, message,
 *             data, created_at)
 */

const path = require('path');
const os = require('os');

// Load .env from multiple locations so the server finds credentials
// whether run via `npm start` (project root) or installed globally via npm i -g.
// ~/.paperfly/.env takes priority (user's configured credentials).
require('dotenv').config({ path: path.join(os.homedir(), '.paperfly', '.env') }); // user home — highest priority
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false }); // project root .env — reliable relative path
require('dotenv').config({ override: false }); // cwd .env — last fallback

const { createClient } = require('@supabase/supabase-js');

let _client = null;
let _initAttempted = false;

function getSupabaseClient() {
    if (_client) return _client;
    if (_initAttempted) return null; // already tried and failed — don't retry on every log call

    _initAttempted = true;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_KEY'].filter(Boolean).join(', ');
        console.warn(`[supabase] Missing env var(s): ${missing} — Supabase persistence disabled. Set them in ~/.paperfly/.env or the project .env file.`);
        return null;
    }

    // Supabase service role keys are JWTs and always start with "eyJ".
    // If the key looks wrong, warn early rather than failing silently on every write.
    if (!key.startsWith('eyJ')) {
        console.warn('[supabase] SUPABASE_SERVICE_KEY does not look like a valid JWT (should start with "eyJ"). Check your Supabase project → Settings → API → service_role key.');
    }

    try {
        _client = createClient(url, key, {
            auth: { persistSession: false }
        });
        console.log('[supabase] Client initialized successfully.');
    } catch (err) {
        console.warn('[supabase] Failed to initialize client:', err.message);
    }

    return _client;
}

/** Reset init state — used in tests or if credentials are updated at runtime. */
function resetSupabaseClient() {
    _client = null;
    _initAttempted = false;
}

function isSupabaseReady() {
    return getSupabaseClient() !== null;
}

module.exports = { getSupabaseClient, isSupabaseReady, resetSupabaseClient };

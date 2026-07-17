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
require('dotenv').config({ override: false }); // project root .env — fallback for dev

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabaseClient() {
    if (_client) return _client;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        return null; // Supabase not configured — server runs without remote logging
    }

    try {
        _client = createClient(url, key, {
            auth: { persistSession: false }
        });
        console.log('[supabase] Client initialized');
    } catch (err) {
        console.warn('[supabase] Failed to initialize client:', err.message);
    }

    return _client;
}

function isSupabaseReady() {
    return getSupabaseClient() !== null;
}

module.exports = { getSupabaseClient, isSupabaseReady };

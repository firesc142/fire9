/**
 * Supabase client configuration for the local Paperfly server.
 *
 * Reads credentials from environment variables:
 *   SUPABASE_URL          - e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  - service_role key (bypasses RLS for writes)
 *
 * Credentials are injected into process.env by the launcher (tray.js / cli.js)
 * or loaded at the top of server.js before this module is required.
 * This module only reads process.env — it never calls dotenv itself.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabaseClient() {
    if (_client) return _client;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — persistence disabled.');
        return null;
    }

    if (!key.startsWith('eyJ')) {
        console.warn('[supabase] SUPABASE_SERVICE_KEY does not look like a valid JWT. Check Supabase → Settings → API → service_role key.');
    }

    try {
        _client = createClient(url, key, { auth: { persistSession: false } });
        console.log('[supabase] Client initialized successfully.');
    } catch (err) {
        console.warn('[supabase] Failed to initialize client:', err.message);
    }

    return _client;
}

function isSupabaseReady() {
    return getSupabaseClient() !== null;
}

/** Reset — for tests or if credentials change at runtime. */
function resetSupabaseClient() {
    _client = null;
}

module.exports = { getSupabaseClient, isSupabaseReady, resetSupabaseClient };

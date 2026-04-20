/**
 * Lazy Supabase client. Requires ./config.js (gitignored) on the page before this script.
 */
function getConfig() {
  const c = window.POKER_TRACKER_CONFIG;
  if (!c?.supabaseUrl || !c?.supabaseAnonKey) {
    throw new Error(
      "Missing Supabase config. Copy js/config.example.js to js/config.js and set your keys."
    );
  }
  if (c.supabaseUrl.includes("YOUR_PROJECT_REF")) {
    throw new Error("Update js/config.js with your real Supabase URL and anon key.");
  }
  return c;
}

let _client;

export async function getSupabase() {
  if (_client) return _client;
  const { createClient } = await import(
    "https://esm.sh/@supabase/supabase-js@2.49.1"
  );
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  _client = createClient(supabaseUrl, supabaseAnonKey);
  return _client;
}

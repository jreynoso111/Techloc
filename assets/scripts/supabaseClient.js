import { SUPABASE_KEY, SUPABASE_URL } from './env.js';

const existingClient = typeof window !== 'undefined' ? window.supabaseClient : null;
const supabaseLibReady = typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function';

if (!supabaseLibReady) {
  console.error(
    'Supabase library not found. Please include the Supabase CDN script before supabaseClient.js.'
  );
}

const supabaseInstance =
  existingClient ||
  (supabaseLibReady && SUPABASE_URL && SUPABASE_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null);

const supabase = existingClient || supabaseInstance || null;

if (typeof window !== 'undefined' && supabase) {
  window.supabaseClient = supabase;
}

export { supabase };
export default supabase;

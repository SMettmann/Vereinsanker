// Public browser configuration for VEREINSFACH.
// The publishable key is designed to be used in client-side applications.
// Access to rows is protected by Supabase Auth + Row Level Security.
const VA_SUPABASE_URL = "https://exginppvomebjinydrrw.supabase.co";
const VA_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kWvfGA8q-T6UeV0M6j3qsg_eDBbhNSI";

window.vaSupabase = supabase.createClient(
  VA_SUPABASE_URL,
  VA_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

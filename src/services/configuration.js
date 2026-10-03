export function validateConfiguration(url, key) {
  if (!url || !key || url.includes('your-project') || key.startsWith('your-')) {
    return 'Supabase is not configured. Copy .env.example to .env, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, run 002_accounts_evidence_upgrade.sql, then restart Vite.';
  }
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return 'VITE_SUPABASE_URL must be a valid Supabase project URL.';
  }
  if (key.startsWith('sb_secret_')) return 'A server secret cannot be used in the browser. Use a publishable or anon key.';
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') return 'Use a browser-safe anon or publishable key, never a service_role key.';
    } catch {
      return 'VITE_SUPABASE_ANON_KEY is not a recognized anon or publishable key.';
    }
  }
  return '';
}




import { createClient } from '@supabase/supabase-js';
import {validateConfiguration} from './configuration';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configurationError = validateConfiguration(url, key);
export const supabase = configurationError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function requireSupabase() {
  if (!supabase) throw new Error(configurationError);
  return supabase;
}


import { createClient } from '@supabase/supabase-js';
import {validateConfiguration} from './configuration';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configurationError = validateConfiguration(url, key);
export const supabase = configurationError ? null : createClient(url, key, {
  global:{fetch:async(input,init)=>{
    const response=await fetch(input,init);
    if([401,403].includes(response.status))window.dispatchEvent(new Event('nigraan-access-denied'));
    return response;
  }},
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function requireSupabase() {
  if (!supabase) throw new Error(configurationError);
  return supabase;
}


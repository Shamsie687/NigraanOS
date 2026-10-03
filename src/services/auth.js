import { requireSupabase } from './supabase';

export async function signIn({ email, password }) {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp({ fullName, email, password }) {
  const { data, error } = await requireSupabase().auth.signUp({
    email, password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      data: {
        full_name: fullName.trim(),
        display_name: fullName.trim(),
      },
    },
  });
  if (error) throw error;
  // A database trigger creates the Citizen profile, including when email
  // confirmation is enabled and no authenticated session is returned yet.
  return data;
}

export async function loadAccount(userId) {
  const client = requireSupabase();
  const { data: profile, error } = await client.from('profiles')
    .select('id, display_name, account_type, created_at').eq('id', userId).single();
  if (error) throw new Error('Unable to load your account profile. ' + error.message);
  const result = await client.from('operations_profiles')
    .select('user_id, organization_name, organization_type, explanation, verification_status')
    .eq('user_id', userId).maybeSingle();
  if (result.error) throw new Error('Unable to load Operations access. Check migration 005 and your connection. ' + result.error.message);
  return { profile, operations:result.data };
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}



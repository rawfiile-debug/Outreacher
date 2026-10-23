import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/** Supabase client acting as the signed-in user (row level security applies). */
export async function createSupabaseServerClient() {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is used only for things a signed-in user must never touch directly:
 * encrypted OAuth tokens and verified Stripe webhooks. Never import this into client code.
 */
export function createSupabaseAdminClient() {
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw new Error('SUPABASE_SECRET_KEY is not set.');
  }
  return createPlainClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signed-out client (publishable key, no cookies). Used only for the public quote link, which goes through two
 *  narrowly scoped database functions that find a quote by the hash of its secret token. */
export function createSupabaseAnonClient() {
  if (!env.supabaseUrl || !env.supabasePublishableKey) throw new Error('Supabase is not configured.');
  return createPlainClient(env.supabaseUrl, env.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

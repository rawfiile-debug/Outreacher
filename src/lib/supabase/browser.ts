'use client';
import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser client acting as the signed-in user. Row level security in the database decides what it can read and
 * change, so it is safe to use for the owner's own records. Shared pages use it signed out (publishable key only),
 * which reaches nothing but the narrow studio_public_* functions.
 */
export function createSupabaseBrowserClient() {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return client;
}

export const moodboardUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/studio-moodboard/${path.split('/').map(encodeURIComponent).join('/')}`;

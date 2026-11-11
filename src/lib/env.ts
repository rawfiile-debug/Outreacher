import 'server-only';

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  supabaseUrl: opt('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: opt('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
};

import 'server-only';

// Central place for server-side configuration. Secrets are only ever read on the server.
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  supabaseUrl: opt('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: opt('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  supabaseSecretKey: opt('SUPABASE_SECRET_KEY'),
  appUrl: (opt('APP_URL') || 'http://localhost:3001').replace(/\/$/, ''),
  // Optional: a Notion internal integration token, shared with the Email Contacts database.
  notionToken: opt('NOTION_TOKEN'),
  notionDatabaseId: opt('NOTION_CONTACTS_DATABASE_ID') || '2e1c086f270780cd843cfd100aa8ec14',
};

export const notionConfigured = Boolean(env.notionToken);

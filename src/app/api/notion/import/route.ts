import { ownerRoute, HttpError, must } from '@/lib/api';
import { env } from '@/lib/env';
import { fromNotion, mergeNotion, type NotionPage } from '@/lib/notion';
import type { Contact } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Pulls every row from the Notion Email Contacts database into the tracker (as the signed-in user, so row level
// security still applies). Safe to run any number of times.
export const POST = ownerRoute(async (_req, { supabase }) => {
  if (!env.notionToken) throw new HttpError(400, 'Notion is not connected yet. Add NOTION_TOKEN in Vercel.');
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${env.notionDatabaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.notionToken}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      cache: 'no-store',
    });
    if (res.status === 401) throw new HttpError(502, 'Notion refused the token. Check NOTION_TOKEN in Vercel.');
    if (res.status === 404) throw new HttpError(502, 'Notion could not find the Email Contacts database. Share it with your integration (••• > Connections).');
    if (!res.ok) throw new HttpError(502, `Notion returned an error (${res.status}). Nothing was changed.`);
    const j = (await res.json()) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
    pages.push(...j.results);
    cursor = j.has_more && j.next_cursor ? j.next_cursor : undefined;
  } while (cursor && pages.length < 5000);

  const existing = must(await supabase.from('studio_contacts').select('id, name, company, role, email, notes, first_emailed_on, stage, notion_page_id')) as Contact[];
  const byNotion = new Map(existing.filter((c) => c.notion_page_id).map((c) => [c.notion_page_id!, c]));
  const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  let created = 0, updated = 0, skipped = 0;
  for (const p of pages) {
    if (p.archived || p.in_trash) { skipped++; continue; }
    const n = fromNotion(p);
    if (!n.name && !n.company && !n.email) { skipped++; continue; }
    const match = byNotion.get(n.notion_page_id) || (n.email ? byEmail.get(n.email) : undefined);
    if (match && match.notion_page_id && match.notion_page_id !== n.notion_page_id) { skipped++; continue; } // same email, different Notion row
    const values = mergeNotion(n, match);
    if (!Object.keys(values).length) continue;
    const r = match
      ? await supabase.from('studio_contacts').update({ ...values, notion_synced_at: new Date().toISOString() }).eq('id', match.id)
      : await supabase.from('studio_contacts').insert({ ...values, notion_synced_at: new Date().toISOString() });
    if (r.error) { skipped++; continue; }
    if (match) updated++; else { created++; if (n.email) byEmail.set(n.email, { ...(values as unknown as Contact) }); }
  }
  return { created, updated, skipped, total: pages.length };
});

import { z } from 'zod';
import { ownerRoute, HttpError, must, readJson } from '@/lib/api';
import { env } from '@/lib/env';

// Ticks "response" on the contact's Notion row when they reply, so Notion stays in step with the tracker.
export const POST = ownerRoute(async (req, { supabase }) => {
  if (!env.notionToken) return { ok: false, reason: 'not_configured' };
  const { id } = z.object({ id: z.string().uuid() }).parse(await readJson(req));
  const c = must(await supabase.from('studio_contacts').select('notion_page_id').eq('id', id).single()) as { notion_page_id: string | null };
  if (!c.notion_page_id) return { ok: false, reason: 'not_linked' };
  const res = await fetch(`https://api.notion.com/v1/pages/${c.notion_page_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.notionToken}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { response: { checkbox: true } } }),
  });
  if (!res.ok) throw new HttpError(502, `Notion did not accept the update (${res.status}).`);
  await supabase.from('studio_contacts').update({ notion_synced_at: new Date().toISOString() }).eq('id', id);
  return { ok: true };
});

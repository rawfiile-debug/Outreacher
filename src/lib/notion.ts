import { parseLooseDate } from './dates';
import type { Contact, Stage } from './types';

// Maps a page from the Notion "Email Contacts" database to a tracker contact. Kept free of network code so it can be
// tested on its own.

type RichText = { plain_text?: string }[];
export type NotionPage = { id: string; archived?: boolean; in_trash?: boolean; properties: Record<string, {
  type?: string; title?: RichText; rich_text?: RichText; email?: string | null; phone_number?: string | null; checkbox?: boolean;
  select?: { name?: string } | null; date?: { start?: string } | null;
}> };

const text = (rt?: RichText) => (rt || []).map((t) => t.plain_text || '').join('').trim();

export type NotionContact = { notion_page_id: string; name: string; company: string; role: string; email: string; notes: string;
  first_emailed_on: string | null; replied: boolean };

export function fromNotion(p: NotionPage, now?: string): NotionContact {
  const pr = p.properties || {};
  const sent = pr['Email sent on'];
  const sentText = sent?.phone_number ?? text(sent?.rich_text) ?? '';
  return {
    notion_page_id: p.id,
    name: text(pr['Contact Name']?.title).slice(0, 200),
    company: text(pr['Company']?.rich_text).slice(0, 200),
    role: text(pr['Role']?.rich_text).slice(0, 200),
    email: (pr['Email Address']?.email || '').trim().toLowerCase().slice(0, 320),
    notes: text(pr['Notes']?.rich_text).slice(0, 4000),
    first_emailed_on: sent?.date?.start?.slice(0, 10) || parseLooseDate(sentText, now),
    replied: Boolean(pr['response']?.checkbox),
  };
}

const ORDER: Stage[] = ['To contact', 'Emailed', 'Followed up', 'Replied', 'Meeting', 'Won'];

/**
 * What to write for one Notion page. New contacts take everything. Existing ones only gain what they are missing,
 * and their stage only ever moves forward (to Emailed if Notion has a sent date, to Replied if Notion is ticked), so
 * nothing changed in the tracker is overwritten by an older Notion value. "Not now" is left alone.
 */
export function mergeNotion(n: NotionContact, existing?: Pick<Contact, 'name' | 'company' | 'role' | 'email' | 'notes' | 'first_emailed_on' | 'stage' | 'notion_page_id'>) {
  const target: Stage = n.replied ? 'Replied' : n.first_emailed_on ? 'Emailed' : 'To contact';
  if (!existing) {
    return { notion_page_id: n.notion_page_id, name: n.name, company: n.company, role: n.role, email: n.email, notes: n.notes,
      first_emailed_on: n.first_emailed_on, stage: target };
  }
  const patch: Record<string, string | null> = {};
  if (!existing.notion_page_id) patch.notion_page_id = n.notion_page_id;
  for (const k of ['name', 'company', 'role', 'email', 'notes'] as const) if (!existing[k] && n[k]) patch[k] = n[k];
  if (!existing.first_emailed_on && n.first_emailed_on) patch.first_emailed_on = n.first_emailed_on;
  if (existing.stage !== 'Not now' && ORDER.indexOf(target) > ORDER.indexOf(existing.stage)) patch.stage = target;
  return patch;
}

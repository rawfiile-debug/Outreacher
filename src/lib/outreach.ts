// Shared types and small helpers for the outreach pages. No network code: unit tested.

export const STAGES = ['To contact', 'Emailed', 'Followed up', 'Replied', 'Meeting', 'Won', 'Not now'] as const;
export type Stage = (typeof STAGES)[number];
export const CATEGORIES = ['Brand', 'Agency', 'Other'] as const;

export type Settings = {
  owner_id: string; enabled: boolean; mode: 'approve' | 'auto'; approve_mode_since: string | null;
  daily_new_limit: number; follow_up_days: number; min_fit: number; targets: string[]; work_library: string;
  sender_name: string; last_run_at: string | null; last_error: string;
};
export type Contact = {
  id: string; company: string; name: string; email: string; website: string; category: string; stage: Stage;
  source: string; research: string; fit_score: number | null; notes: string; created_at: string;
};
export type Email = {
  id: string; contact_id: string; kind: 'first' | 'follow_up'; status: string; to_email: string; subject: string; body: string;
  approved_at: string | null; sent_at: string | null; created_at: string; error: string;
  outreach_contacts: Pick<Contact, 'company' | 'name' | 'website' | 'research' | 'fit_score' | 'category'> | null;
};
export type Activity = { id: number; kind: string; message: string; created_at: string };
export type Suppression = { id: number; value: string; kind: 'email' | 'domain'; reason: string; created_at: string };

/** After two weeks of approving each email, the app suggests switching to automatic. */
export function suggestAuto(s: Pick<Settings, 'mode' | 'approve_mode_since'>, now = new Date()): boolean {
  return s.mode === 'approve' && Boolean(s.approve_mode_since) && now.getTime() - Date.parse(s.approve_mode_since!) >= 14 * 86_400_000;
}

/** "One per line" text box to a clean list: trimmed, no blanks, no repeats, at most 20. */
export function linesToList(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))].slice(0, 20);
}

/** Turns what was typed into a do-not-contact entry: a full address, or a domain (also from "@domain" or a URL). */
export function parseSuppression(input: string): { value: string; kind: 'email' | 'domain' } | null {
  const v = input.trim().toLowerCase().replace(/^mailto:/, '');
  if (/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return { value: v, kind: 'email' };
  const d = v.replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { value: d, kind: 'domain' };
  return null;
}

export const domainOf = (url: string) => {
  try { return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function stageTone(stage: string): string {
  if (stage === 'Replied' || stage === 'Meeting' || stage === 'Won') return 'ok';
  if (stage === 'Emailed' || stage === 'Followed up') return 'info';
  if (stage === 'Not now') return 'bad';
  return '';
}

export const APPLY_AS = [
  { value: 'individual', label: 'An individual artist' },
  { value: 'sole_trader', label: 'A sole trader (RAWFIILE)' },
  { value: 'ycuk', label: 'Through YCUK (organisation)' },
] as const;

export type Profile = {
  owner_id: string; website: string; cv_path: string | null; cv_name: string; cv_text: string; instagram_paths: string[]; instagram_text: string;
  bio: string; clients: string; projects: string; awards: string; equipment: string; apply_as: string[]; extra: string;
  summary: string; summary_built_at: string | null; summary_confirmed: boolean;
};
export type Job = { id: string; kind: string; ref_id: string | null; status: 'queued' | 'running' | 'done' | 'failed'; error: string; created_at: string; finished_at: string | null };

/** A file name that is safe as a storage path: letters, numbers, dots, dashes and underscores only. */
export function safeFileName(full: string): string {
  const name = full.split(/[\\/]/).pop() || '';
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : '';
  return ext ? `${base}.${ext}` : base;
}

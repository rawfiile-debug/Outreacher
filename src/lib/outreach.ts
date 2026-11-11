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

// Grants ------------------------------------------------------------------------------------------------------------
export type Option = { value: string; label: string };
export const GRANT_TYPES: Option[] = [
  { value: 'project', label: 'Project funding' }, { value: 'commission', label: 'Commissions and open calls' },
  { value: 'residency', label: 'Residencies' }, { value: 'equipment', label: 'Equipment' },
  { value: 'business', label: 'Business support' }, { value: 'training', label: 'Training and mentoring' },
  { value: 'travel', label: 'Travel and research' }, { value: 'prize', label: 'Prizes and awards' },
  { value: 'exhibition', label: 'Exhibitions and publishing' },
];
export const GRANT_FOCUS: Option[] = [
  { value: 'photography', label: 'Photography' }, { value: 'film', label: 'Film and video' },
  { value: 'cross_arts', label: 'Cross-arts' }, { value: 'community', label: 'Community and youth' },
  { value: 'fashion', label: 'Fashion' }, { value: 'music', label: 'Music' },
  { value: 'heritage', label: 'Heritage and archives' }, { value: 'diversity', label: 'Under-represented artists' },
];
export const GRANT_LOCATIONS: Option[] = [
  { value: 'london', label: 'London' }, { value: 'uk', label: 'UK-wide' }, { value: 'england', label: 'England' },
  { value: 'international', label: 'International (open to UK)' },
];
export const GRANT_STAGES: Option[] = [
  { value: 'emerging', label: 'Emerging' }, { value: 'mid', label: 'Mid-career' }, { value: 'any', label: 'Any stage' },
];
export const GRANT_MIN_AMOUNTS: Option[] = [
  { value: '0', label: 'Any amount' }, { value: '500', label: '£500 or more' }, { value: '1000', label: '£1,000 or more' },
  { value: '2500', label: '£2,500 or more' }, { value: '5000', label: '£5,000 or more' }, { value: '10000', label: '£10,000 or more' },
];
export const GRANT_STATUSES: Option[] = [
  { value: 'new', label: 'New' }, { value: 'applying', label: 'Applying' }, { value: 'submitted', label: 'Submitted' },
  { value: 'won', label: 'Won' }, { value: 'rejected', label: 'Rejected' }, { value: 'dismissed', label: 'Not for me' },
];
export const ELIGIBILITY: Record<string, { label: string; tone: string }> = {
  eligible: { label: 'Eligible', tone: 'ok' }, check: { label: 'Check', tone: 'warn' }, not_eligible: { label: 'Not eligible', tone: 'bad' },
};
export const labelOf = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

export type Grant = {
  id: string; title: string; funder: string; url: string; grant_type: string; amount: string; amount_max: number | null;
  deadline: string | null; deadline_note: string; location: string; what_it_funds: string; who_can_apply: string;
  eligibility: 'eligible' | 'check' | 'not_eligible'; eligibility_reason: string; fit_score: number | null;
  status: string; notes: string; form_name: string; form_text: string; extra_info: string; draft: string; drafted_at: string | null;
  created_at: string;
};

/** Whole days from today (London) until a yyyy-mm-dd deadline; negative once it has passed. */
export function daysUntil(deadline: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  return Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000);
}

export function deadlineLabel(g: Pick<Grant, 'deadline' | 'deadline_note'>, now = new Date()): string {
  if (!g.deadline) return g.deadline_note || 'Rolling or not stated';
  const d = daysUntil(g.deadline, now);
  const date = new Date(g.deadline + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (d < 0) return `Closed ${date}`;
  if (d === 0) return `Closes today`;
  return `${date} (${d} day${d === 1 ? '' : 's'})`;
}

/** File name for a downloaded draft, e.g. "Developing Your Creative Practice - Michael Clavier". */
export const draftFileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Application'} - Michael Clavier`;

// Gigs --------------------------------------------------------------------------------------------------------------
export const GIG_WORK_TYPES: Option[] = [
  { value: 'fashion', label: 'Fashion and editorial' }, { value: 'events', label: 'Events and nightlife' },
  { value: 'portraits', label: 'Portraits and headshots' }, { value: 'product', label: 'Product and still life' },
  { value: 'music', label: 'Music and artists' }, { value: 'content', label: 'Social and creator content' },
  { value: 'video', label: 'Video and interviews' }, { value: 'brand', label: 'Brand campaigns' },
  { value: 'weddings', label: 'Weddings and private events' },
];
export const GIG_PAY: Option[] = [
  { value: 'paid', label: 'Paid work' }, { value: 'collab', label: 'Collaborations (TFP)' }, { value: 'expenses', label: 'Expenses only' },
];
export const GIG_LOCATIONS: Option[] = [
  { value: 'london', label: 'London' }, { value: 'south_east', label: 'South East' }, { value: 'uk', label: 'Anywhere in the UK' },
  { value: 'remote', label: 'Remote (editing, content)' }, { value: 'international', label: 'Abroad (travel paid)' },
];
export const GIG_SOURCES: Option[] = [
  { value: 'job_boards', label: 'Job boards (Mandy, The Dots, Indeed and more)' }, { value: 'linkedin', label: 'LinkedIn (public posts)' },
  { value: 'reddit', label: 'Reddit' }, { value: 'x', label: 'X (Twitter)' },
  { value: 'facebook', label: 'Facebook (public posts and groups)' }, { value: 'instagram', label: 'Instagram (public posts)' },
];
export const GIG_MIN_BUDGETS: Option[] = [
  { value: '0', label: 'Any budget' }, { value: '100', label: '£100 or more' }, { value: '250', label: '£250 or more' },
  { value: '500', label: '£500 or more' }, { value: '1000', label: '£1,000 or more' },
];
export const GIG_STATUSES: Option[] = [
  { value: 'new', label: 'New' }, { value: 'replied', label: 'Replied' }, { value: 'booked', label: 'Booked' }, { value: 'dismissed', label: 'Not for me' },
];
export type Gig = {
  id: string; title: string; source: string; url: string; poster: string; posted_at: string | null; location: string;
  work_type: string; pay: string; needed: string; how_to_apply: string; fit_score: number | null; fit_reason: string;
  reply: string; status: string; created_at: string;
};

/**
 * Builds a profile summary straight away in the browser, from what Michael typed. No AI and no rewriting: it only
 * arranges his own words under the same headings the hourly run uses, so it is ready the moment he presses the button.
 */
export function instantSummary(p: Pick<Profile, 'website' | 'bio' | 'clients' | 'projects' | 'awards' | 'equipment' | 'extra' | 'apply_as' | 'cv_text' | 'instagram_text'>): string {
  const list = (s: string) => s.split('\n').map((l) => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean).map((l) => `- ${l}`).join('\n');
  const as = p.apply_as.map((v) => APPLY_AS.find((a) => a.value === v)?.label).filter(Boolean).map((l) => `- ${l}`).join('\n');
  const sections: [string, string][] = [
    ['WHO I AM', p.bio.trim()],
    ['SELECTED WORK', list(p.projects)],
    ['CLIENTS AND COLLABORATORS', list(p.clients)],
    ['RECOGNITION', list(p.awards) || 'None listed yet'],
    ['EQUIPMENT', list(p.equipment)],
    ['ALSO', p.extra.trim()],
    ['HOW I CAN APPLY', as],
    ['LINKS', [p.website.trim() && `- Website: ${p.website.trim()}`, '- Instagram: RAWFIILE'].filter(Boolean).join('\n')],
  ];
  const missing: string[] = [];
  if (!p.bio.trim()) missing.push('a short bio');
  if (!p.projects.trim()) missing.push('projects');
  if (!p.clients.trim()) missing.push('clients');
  if (!p.equipment.trim()) missing.push('equipment');
  const notes: string[] = [];
  if (missing.length) notes.push(`- Add ${missing.join(', ')} in the boxes below`);
  if (p.cv_text && !p.bio.trim()) notes.push('- Your CV is uploaded but its details are not copied here; press "Polish with Claude" to pull them in');
  if (p.instagram_text) notes.push('- Instagram screenshot text is only used by "Polish with Claude"');
  sections.push(['TO CHECK', notes.join('\n') || 'Nothing to check']);
  return sections.filter(([, body]) => body).map(([h, body]) => `${h}\n${body}`).join('\n\n').slice(0, 8000);
}

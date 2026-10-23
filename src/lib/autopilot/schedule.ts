// When the autopilot may send, how many, and what to search next. No network code: unit tested.

export type Settings = {
  enabled: boolean; mode: 'approve' | 'auto'; daily_new_limit: number; send_days: number[]; window_start: string; window_end: string;
  follow_up_days: number; min_fit: number; targets: string[]; sender_name: string; portfolio_url: string; require_companies_house: boolean;
  approve_mode_since: string | null; inbox_checked_at: string | null; last_send_at: string | null;
};

/** The wall-clock time in London, which is what "working hours" means here. */
export function londonParts(now: Date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: days.indexOf(p.weekday) };
}

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

export function inSendWindow(s: Pick<Settings, 'send_days' | 'window_start' | 'window_end'>, now: Date): boolean {
  const l = londonParts(now);
  return s.send_days.includes(l.weekday) && l.minutes >= mins(s.window_start) && l.minutes < mins(s.window_end);
}

/** Picks the search with the fewest runs so far (page by page), so every target gets its turn. */
export function nextSearch(targets: string[], log: { query: string; page: number }[]): { query: string; page: number } | null {
  if (!targets.length) return null;
  const pages = new Map<string, number>();
  for (const t of targets) pages.set(t, -1);
  for (const l of log) if (pages.has(l.query)) pages.set(l.query, Math.max(pages.get(l.query)!, l.page));
  const [query, last] = [...pages.entries()].sort((a, b) => a[1] - b[1])[0];
  if (last >= 9) return null; // every target searched 10 pages deep: time for new targets
  return { query, page: last + 1 };
}

/** After two weeks in approval mode, suggest switching to automatic. */
export function suggestAuto(s: Pick<Settings, 'mode' | 'approve_mode_since'>, now: Date): boolean {
  return s.mode === 'approve' && Boolean(s.approve_mode_since) && now.getTime() - Date.parse(s.approve_mode_since!) >= 14 * 86_400_000;
}

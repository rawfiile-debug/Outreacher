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

/**
 * A new mailbox builds trust slowly: 3 first emails a day in its first week, 6 in the second, then the chosen limit.
 * Sending a sudden burst from a fresh address is the quickest way to land in spam.
 */
export function dailyLimit(limit: number, mailboxConnectedAt: string | null, now: Date): number {
  if (!mailboxConnectedAt) return 0;
  const days = (now.getTime() - Date.parse(mailboxConnectedAt)) / 86_400_000;
  return Math.min(limit, days < 7 ? 3 : days < 14 ? 6 : limit);
}

/** Spread the day's emails across the window: wait at least this long between sends (with a little variation). */
export function minutesBetweenSends(s: Pick<Settings, 'window_start' | 'window_end'>, perDay: number, jitter = Math.random()): number {
  const span = mins(s.window_end) - mins(s.window_start);
  const even = span / Math.max(perDay, 1);
  return Math.max(8, Math.round(even * (0.7 + 0.3 * jitter)));
}

export function mayAddMoreToday(sentToday: number, perDay: number) { return sentToday < perDay; }

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

// Dates are plain YYYY-MM-DD strings in UK time, like the database's studio_today().

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

export const formatLongDate = (iso: string | null | undefined) => formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T12:00:00Z') - Date.parse(fromIso + 'T12:00:00Z')) / 86_400_000);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Reads the dates people type into a free-text field ("12/10/2026", "12/10/26", "2026-10-12", "12 Oct 2026",
 * "12th October"). UK order: day first. A date with no year takes the current year, or last year if that would be in
 * the future. Returns null for anything it cannot read with confidence.
 */
export function parseLooseDate(input: string | null | undefined, now = today()): string | null {
  const s = (input || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const nowYear = Number(now.slice(0, 4));
  const valid = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const back = new Date(iso + 'T12:00:00Z');
    return back.getUTCMonth() + 1 === m && back.getUTCDate() === d ? iso : null;
  };
  const year = (y: string | undefined, m: number, d: number) => {
    if (y) return Number(y.length === 2 ? `20${y}` : y);
    const guess = valid(nowYear, m, d);
    return guess && guess > now ? nowYear - 1 : nowYear;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(s);
  if (m) { const d = Number(m[1]), mo = Number(m[2]); return valid(year(m[3], mo, d), mo, d); }
  m = /^(?:[a-z]+ )?(\d{1,2}) ([a-z]{3,})(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3)) + 1; if (mo) { const d = Number(m[1]); return valid(year(m[3], mo, d), mo, d); } }
  m = /^([a-z]{3,}) (\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3)) + 1; if (mo) { const d = Number(m[2]); return valid(year(m[3], mo, d), mo, d); } }
  return null;
}

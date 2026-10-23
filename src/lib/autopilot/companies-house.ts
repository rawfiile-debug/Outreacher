import 'server-only';
import { env } from '@/lib/env';

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\b(limited|ltd|llp|plc|the|group|uk|london)\b/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Looks the business up on the free Companies House register. A match on an active company means it is a company,
 * not a sole trader, which is what UK rules on cold business email expect. Returns null when there is no clear match.
 */
export async function findCompany(name: string): Promise<{ number: string; title: string } | null> {
  if (!env.companiesHouseKey || !name.trim()) return null;
  const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`, {
    headers: { authorization: `Basic ${Buffer.from(`${env.companiesHouseKey}:`).toString('base64')}` }, cache: 'no-store',
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { items?: { company_number: string; title: string; company_status: string }[] };
  const want = norm(name);
  if (want.length < 3) return null;
  const hit = (j.items || []).find((i) => i.company_status === 'active' && (norm(i.title) === want || norm(i.title).startsWith(want) || want.startsWith(norm(i.title))));
  return hit ? { number: hit.company_number, title: hit.title } : null;
}

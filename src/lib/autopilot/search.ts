import 'server-only';
import { env } from '@/lib/env';

export type SearchResult = { url: string; title: string; description: string };

/** Brave Search web results for a query, page by page (20 per page, UK results). */
export async function webSearch(query: string, page = 0): Promise<SearchResult[]> {
  if (!env.braveKey) throw new Error('Web search is not set up (BRAVE_SEARCH_API_KEY).');
  const p = new URLSearchParams({ q: query, count: '20', offset: String(Math.min(page, 9)), country: 'gb', search_lang: 'en', safesearch: 'strict' });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${p}`, {
    headers: { accept: 'application/json', 'X-Subscription-Token': env.braveKey }, cache: 'no-store',
  });
  if (res.status === 429) throw new Error('Search limit reached for now. It will carry on later.');
  if (!res.ok) throw new Error(`Search failed (${res.status}).`);
  const j = (await res.json()) as { web?: { results?: { url: string; title: string; description?: string }[] } };
  return (j.web?.results || []).map((r) => ({ url: r.url, title: r.title, description: (r.description || '').replace(/<[^>]+>/g, '') }));
}

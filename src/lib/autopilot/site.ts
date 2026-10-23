import 'server-only';
import { domainOf, extractEmails } from './emails';

// Reads a business website politely: the home page plus one contact or about page, with short timeouts and size
// limits, identifying itself. Only public http(s) pages on ordinary domain names are fetched.

const UA = 'Mozilla/5.0 (compatible; OutreacherBot/1.0; +https://www.rawfiile.co.uk)';
const MAX_BYTES = 400_000;

async function getPage(url: string, timeoutMs = 8000): Promise<{ url: string; html: string } | null> {
  if (!domainOf(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html') || !domainOf(res.url)) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value); size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
    }
    return { url: res.url, html: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks)) };
  } catch { return null; } finally { clearTimeout(t); }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/header|\/footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
}

export function findContactLink(html: string, base: string): string | null {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const scored = links.map(([, href, label]) => {
    const text = `${href} ${label.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    const s = /contact|get in touch|enquir|work with us|say hello/.test(text) ? 3 : /about|team|studio|who we are/.test(text) ? 1 : 0;
    return { href, s };
  }).filter((l) => l.s > 0 && !/^(mailto|tel|javascript):/i.test(l.href)).sort((a, b) => b.s - a.s);
  for (const l of scored) {
    try {
      const u = new URL(l.href, base);
      if (domainOf(u.href) === domainOf(base)) return u.href;
    } catch { /* ignore bad links */ }
  }
  return null;
}

export type SiteRead = { domain: string; url: string; title: string; text: string; emails: string[] };

export async function readSite(url: string): Promise<SiteRead | null> {
  const domain = domainOf(url);
  if (!domain) return null;
  const home = await getPage(`https://${domain}/`) || await getPage(url);
  if (!home) return null;
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.html)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const desc = (/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(home.html)?.[1] || '').slice(0, 300);
  let emails = extractEmails(home.html);
  let text = `${title}\n${desc}\n${htmlToText(home.html)}`.slice(0, 6000);
  const contact = findContactLink(home.html, home.url);
  if (contact) {
    const page = await getPage(contact, 6000);
    if (page) {
      emails = [...new Set([...emails, ...extractEmails(page.html)])];
      text += `\n\n[${new URL(page.url).pathname}]\n${htmlToText(page.html).slice(0, 2500)}`;
    }
  }
  return { domain, url: home.url, title, text, emails };
}

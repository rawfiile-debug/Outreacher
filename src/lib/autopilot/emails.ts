// Choosing which address on a website to write to, and which sites to skip. No network code: unit tested.

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk', 'yahoo.com',
  'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'btinternet.com', 'sky.com', 'protonmail.com', 'proton.me', 'msn.com', 'mail.com']);

// Addresses that never reach a decision-maker, or that it would be wrong to cold-email.
const BAD_LOCAL = /^(no-?reply|do-?not-?reply|privacy|gdpr|dpo|data|legal|compliance|abuse|postmaster|webmaster|hostmaster|security|careers|jobs|recruitment|hr|accounts|invoices?|billing|finance|payments?|returns|orders|support|help|complaints|unsubscribe|bounces?|newsletter|example|test|user|name|email|your\.?name|you)$/;
const PREFERRED_LOCAL = /^(hello|hi|studio|work|projects|partnerships|collab(oration)?s?|marketing|events|bookings?|enquir(y|ies)|info|contact|team|press|creative|production|office|general)$/;

// Platforms, directories and press: never the business itself.
const SKIP_DOMAINS = ['instagram.com', 'facebook.com', 'linkedin.com', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'pinterest.com',
  'reddit.com', 'medium.com', 'wikipedia.org', 'google.com', 'yelp.com', 'yelp.co.uk', 'tripadvisor.com', 'tripadvisor.co.uk', 'timeout.com',
  'eventbrite.com', 'eventbrite.co.uk', 'designmynight.com', 'opentable.co.uk', 'opentable.com', 'resdiary.com', 'skiddle.com', 'ra.co',
  'dice.fm', 'fatsoma.com', 'theguardian.com', 'bbc.co.uk', 'standard.co.uk', 'londonist.com', 'secretldn.com', 'gov.uk', 'nhs.uk',
  'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk', 'clutch.co', 'sortlist.com', 'sortlist.co.uk', 'thedrum.com',
  'campaignlive.co.uk', 'glassdoor.com', 'glassdoor.co.uk', 'indeed.com', 'indeed.co.uk', 'crunchbase.com', 'trustpilot.com', 'amazon.co.uk',
  'amazon.com', 'etsy.com', 'ebay.co.uk', 'hotels.com', 'booking.com', 'airbnb.com', 'airbnb.co.uk', 'expedia.co.uk', 'squarespace.com', 'wix.com',
  'wordpress.com', 'shopify.com', 'apple.com', 'spotify.com', 'soundcloud.com', 'mixcloud.com', 'vimeo.com', 'behance.net', 'dribbble.com'];

export function domainOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
    return h;
  } catch { return null; }
}

export function isSkippedDomain(domain: string): boolean {
  return SKIP_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

/** Finds email addresses in page text and mailto links, including simple "name [at] domain [dot] com" disguises. */
export function extractEmails(html: string): string[] {
  const decoded = html
    .replace(/&#64;|&#x40;/gi, '@')
    .replace(/\s*(\(at\)|\[at\]|\{at\})\s*/gi, '@')
    .replace(/\s*(\(dot\)|\[dot\]|\{dot\})\s*/gi, '.')
    .replace(/%40/g, '@');
  const found = decoded.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
  const out = new Set<string>();
  for (const raw of found) {
    const e = raw.toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '');
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e) || /@\d+x\./.test(e) || e.length > 120) continue;
    if (/(sentry|wixpress|example\.com|domain\.com|email\.com|yourcompany|godaddy|cloudflare)/.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

export type EmailChoice = { email: string; named: boolean } | null;

/**
 * Picks the best address for this business: on its own domain (or a subdomain of it), never a free webmail address
 * (often a sole trader, which UK rules treat differently), never a privacy, jobs or accounts inbox. A personal
 * work address beats a general one; among general ones hello@ and studio@ beat info@.
 */
export function chooseEmail(emails: string[], domain: string): EmailChoice {
  const root = domain.split('.').slice(-3).join('.');
  const candidates = emails.filter((e) => {
    const [local, host] = e.split('@');
    if (!local || !host || FREE_MAIL.has(host) || BAD_LOCAL.test(local)) return false;
    return host === domain || host.endsWith('.' + domain) || domain.endsWith('.' + host) || host === root;
  });
  if (!candidates.length) return null;
  const score = (e: string) => {
    const local = e.split('@')[0];
    if (PREFERRED_LOCAL.test(local)) return ['hello', 'hi', 'studio', 'work', 'projects', 'partnerships'].includes(local) ? 2 : 1;
    if (/^[a-z]+([._-][a-z]+)?$/.test(local) && local.length <= 30) return 3; // looks like a person: jo, jo.bloggs
    return 0;
  };
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  return { email: best, named: score(best) === 3 };
}

export const isFreeMail = (email: string) => FREE_MAIL.has(email.split('@')[1] || '');

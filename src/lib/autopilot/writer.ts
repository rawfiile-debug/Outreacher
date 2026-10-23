import 'server-only';
import { env } from '@/lib/env';
import { CLIENTS_LINE, finishFirstEmail, type Draft } from './compose';

export type Assessment = {
  is_business: boolean; is_london: boolean; business_type: string; company_name: string; contact_name: string;
  fit: number; reason: string; summary: string; subject: string; body: string;
};

const SYSTEM = `You help Michael Clavier, a London photographer and videographer who trades as RAWFIILE, find paid work.
He shoots editorial fashion and portraits on medium format film (Mamiya RB67), 35mm film (Canon F-1) and digital, covers events and nightlife, and makes short-form video content and interviews. Past clients include ${CLIENTS_LINE}.

You will read the text of one business's website and decide if it is worth emailing, then write the first email.

Good fits: businesses in or around London that regularly need photos or short video: event and nightlife promoters, venues, bars and clubs, hotels and restaurant groups, fashion, beauty and lifestyle brands, creative, PR and social media agencies, artist management, independent magazines.
Poor fits: large corporations with in-house studios, other photographers or videographers, directories, news sites, charities with no budget signs, anything outside the UK, sole individuals' personal pages.

Writing rules for the email (follow every one):
- British English. Plain text. 70 to 130 words in the body. Two or three short paragraphs.
- Open with "Hi <first name>," if a real person's name is clearly on the site, otherwise "Hi there,".
- Introduce him as Michael, never Mikey. Do not write a sign-off or his name at the end: it is added for you.
- Say one specific, true thing you noticed about this business from the website (an event series, a new collection, a venue, a campaign). Never invent anything.
- Say plainly how he could help them, connected to that detail. Mention the past clients briefly, once.
- Not salesy: no hype, no exclamation marks, no "I hope this finds you well", no "synergy", no pressure, no long dashes. Never mention price, rates, packages or discounts.
- End with one easy question, such as whether they have anything coming up he could help with.
- Subject: short and specific to them, under 8 words, no clickbait.

Reply with JSON only, no other text:
{"is_business": true/false, "is_london": true/false, "business_type": "...", "company_name": "...", "contact_name": "first and last name of the person to address, or empty",
 "fit": 0-10, "reason": "one sentence on the fit", "summary": "one sentence describing the business",
 "subject": "...", "body": "..."}`;

export async function askClaude(system: string, user: string, maxTokens = 900): Promise<string> {
  if (!env.anthropicKey) throw new Error('The email writer is not set up (ANTHROPIC_API_KEY).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('The Anthropic API key was refused.');
  if (!res.ok) throw new Error(`The email writer returned an error (${res.status}).`);
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

export function parseAssessment(text: string): Assessment | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Partial<Assessment>;
    if (typeof o.fit !== 'number' || typeof o.body !== 'string' || typeof o.subject !== 'string') return null;
    return {
      is_business: Boolean(o.is_business), is_london: Boolean(o.is_london), business_type: String(o.business_type || '').slice(0, 80),
      company_name: String(o.company_name || '').slice(0, 200), contact_name: String(o.contact_name || '').slice(0, 120),
      fit: Math.max(0, Math.min(10, Math.round(o.fit))), reason: String(o.reason || '').slice(0, 300), summary: String(o.summary || '').slice(0, 300),
      subject: o.subject, body: o.body,
    };
  } catch { return null; }
}

/** Reads one site, judges the fit and writes the first email, then runs it through the house rules. */
export async function assessAndWrite(site: { domain: string; url: string; text: string }, toEmail: string, opts: { senderName: string; portfolioUrl: string }):
  Promise<{ assessment: Assessment; email: Draft | null; rejected?: string }> {
  const user = `Website: ${site.url}\nEmail address we would write to: ${toEmail}\n\nWebsite text:\n${site.text.slice(0, 7000)}`;
  let a: Assessment | null = null;
  for (let attempt = 0; attempt < 2 && !a; attempt++) a = parseAssessment(await askClaude(SYSTEM, user));
  if (!a) throw new Error('The email writer did not return a usable answer.');
  const checked = finishFirstEmail({ subject: a.subject, body: a.body }, opts);
  return checked.ok ? { assessment: a, email: checked.email } : { assessment: a, email: null, rejected: checked.reason };
}

// Rules every outgoing email must pass, whoever (or whatever) wrote it. No network code: unit tested.

export const OPT_OUT_LINE = "If this isn't relevant, just reply 'no thanks' and I won't get in touch again.";
export const CLIENTS_LINE = 'The Royal Foundation, Viberoom, YCUK and Noxy Brothers';

/** No long dashes (Michael's rule): an aside becomes a comma, a range a hyphen. */
export function noLongDashes(s: string): string {
  return s.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[—―]\s*/g, ', ').replace(/\s*–\s*/g, ', ').replace(/,\s*,/g, ',');
}

const PRICE = /£\s?\d|\$\s?\d|\b\d+\s?(gbp|pounds)\b|\b(day rate|hourly rate|our rates|my rates|pricing|price list|discount|special offer|per hour)\b/i;

export type Draft = { subject: string; body: string };
export type Checked = { ok: true; email: Draft } | { ok: false; reason: string };

/**
 * Cleans a first email and checks it: short subject, no price, no placeholders left in, signed "Michael Clavier"
 * (introducing himself as Michael, never Mikey), the portfolio link present, and the opt-out line at the end.
 */
export function finishFirstEmail(d: Draft, opts: { senderName: string; portfolioUrl: string }): Checked {
  let subject = noLongDashes(d.subject.replace(/[\r\n]+/g, ' ').trim()).replace(/^(re|fwd?):\s*/i, '').slice(0, 90);
  let body = noLongDashes(d.body.replace(/\r\n/g, '\n').trim());
  if (!subject || subject.length < 3) return { ok: false, reason: 'no subject' };
  if (/\[[^\]]*\]|\{[^}]*\}|<[^>]+>|lorem ipsum/i.test(subject + body)) return { ok: false, reason: 'unfilled placeholder' };
  if (PRICE.test(subject + ' ' + body)) return { ok: false, reason: 'mentions price' };
  if (/\bmikey\b/i.test(body)) body = body.replace(/\bMikey\b/g, 'Michael');
  // Strip any sign-off the writer added, then add the one true sign-off and the opt-out line.
  body = body.replace(/\n+(best|best wishes|kind regards|regards|thanks|many thanks|cheers|all the best|warmly),?\s*\n[\s\S]*$/i, '').trim();
  body = body.replace(/\n+michael( clavier)?\s*$/i, '').trim();
  if (!body.includes(opts.portfolioUrl.replace(/^https:\/\//, '').replace(/\/$/, ''))) body += `\n\nYou can see my work here: ${opts.portfolioUrl}`;
  const words = body.split(/\s+/).length;
  if (words < 40) return { ok: false, reason: 'too short' };
  if (words > 190) return { ok: false, reason: 'too long' };
  body = `${body}\n\nBest,\n${opts.senderName}\n\n${OPT_OUT_LINE}`;
  return { ok: true, email: { subject, body } };
}

/**
 * The one follow-up, sent in the same thread a couple of weeks later. A short version of the five line method:
 * an open question they can't answer with a flat no, then an easy, small call to action. Easy to ignore.
 */
export function followUpEmail(opts: { firstName: string; company: string; firstSubject: string; senderName: string; portfolioUrl: string }): Draft {
  const subject = /^re:/i.test(opts.firstSubject) ? opts.firstSubject : `Re: ${opts.firstSubject}`;
  const body = [
    `Hi ${opts.firstName || 'there'},`,
    '',
    `Just bringing this back up in case it got buried. How open would ${opts.company || 'you'} be to trying something small together on your next shoot or campaign?`,
    '',
    "If it's not the right time, no problem at all. If it is, would a 10-minute call next week suit?",
    '',
    `My work is here if it's useful: ${opts.portfolioUrl}`,
    '',
    'Best,',
    opts.senderName,
    '',
    OPT_OUT_LINE,
  ].join('\n');
  return { subject, body: noLongDashes(body) };
}

export type ReplyKind = 'opt_out' | 'auto_reply' | 'bounce' | 'reply';

/** Sorts an incoming message about an outreach email into what it means. */
export function classifyReply(m: { from: string; subject: string; snippet: string; autoSubmitted?: string }): ReplyKind {
  const from = m.from.toLowerCase();
  const subject = m.subject.toLowerCase();
  const text = `${subject} ${m.snippet}`.toLowerCase();
  if (/mailer-daemon|postmaster@|mail delivery (sub)?system/.test(from) || /delivery status notification|undeliverable|delivery has failed|address not found|returned mail|mail delivery failed/.test(subject)) return 'bounce';
  if ((m.autoSubmitted && m.autoSubmitted.toLowerCase() !== 'no') || /out of (the )?office|automatic reply|auto-?reply|autoreply|on annual leave|away from (my|the) (desk|office)|thank you for (your email|contacting)/.test(text)) return 'auto_reply';
  if (/unsubscribe|remove me|take me off|stop (emailing|contacting)|don'?t (email|contact)|do not (email|contact)|no thanks|no thank you|not interested|please remove/.test(text)) return 'opt_out';
  return 'reply';
}

export const firstNameOf = (name: string) => (name || '').trim().split(/\s+/)[0]?.replace(/[^A-Za-z'\-]/g, '') || '';

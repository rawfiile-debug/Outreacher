import type { Contact } from './types';

// The one follow-up email, two weeks after the first. Short, no price, signed as Michael, opened in Gmail as a draft
// so it can be adjusted before sending. Follows the five line method: an open question, then a small, easy ask.
export function followUpEmail(c: Pick<Contact, 'name' | 'company' | 'email'>, sender = 'Michael Clavier') {
  const first = (c.name || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Following up${c.company ? `, ${c.company}` : ''}`;
  const body = [
    `Hi ${first},`,
    '',
    `Just bringing my email from a couple of weeks ago back up in case it got buried. How open would ${c.company || 'you'} be to trying something small together on your next shoot or campaign?`,
    '',
    "If it's not the right time, no problem at all. If it is, would a 10-minute call next week suit?",
    '',
    'My work is here if it helps: www.rawfiile.co.uk',
    'IG: RAWFIILE',
    '',
    'Best,',
    sender,
  ].join('\n');
  return { subject, body };
}

/** Opens a Gmail compose window with everything filled in; nothing is sent until you press Send. */
export function gmailComposeUrl(to: string, subject: string, body: string) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${p.toString()}`;
}

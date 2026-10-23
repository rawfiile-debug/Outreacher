import type { Contact } from './types';

// The one follow-up email, two weeks after the first. Short, no price, signed as Michael, opened in Gmail as a draft
// so it can be adjusted before sending.
export function followUpEmail(c: Pick<Contact, 'name' | 'company' | 'email'>, sender = 'Michael Clavier') {
  const first = (c.name || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Following up${c.company ? `, ${c.company}` : ''}`;
  const body = [
    `Hi ${first},`,
    '',
    `Just bringing my email from a couple of weeks ago back to the top of your inbox in case it got buried. I'd love to help with any photo or video work you have coming up${c.company ? ` at ${c.company}` : ''}, whether that's events, editorial or short-form content.`,
    '',
    'My recent work is here if it helps: https://www.rawfiile.co.uk',
    '',
    "No worries at all if the timing isn't right.",
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

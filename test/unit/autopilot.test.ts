import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { chooseEmail, domainOf, extractEmails, isSkippedDomain } from '@/lib/autopilot/emails';
import { classifyReply, finishFirstEmail, followUpEmail, noLongDashes, OPT_OUT_LINE } from '@/lib/autopilot/compose';
import { findContactLink, htmlToText } from '@/lib/autopilot/site';
import { parseAssessment } from '@/lib/autopilot/writer';

describe('finding the right address', () => {
  it('reads domains safely', () => {
    expect(domainOf('https://www.Example.co.uk/about')).toBe('example.co.uk');
    for (const bad of ['http://localhost:3000', 'http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://intranet/', 'http://db.internal/']) expect(domainOf(bad)).toBeNull();
  });
  it('skips platforms, directories and press', () => {
    expect(isSkippedDomain('instagram.com')).toBe(true);
    expect(isSkippedDomain('uk.linkedin.com')).toBe(true);
    expect(isSkippedDomain('timeout.com')).toBe(true);
    expect(isSkippedDomain('northernlights.studio')).toBe(false);
  });
  it('finds addresses in text, mailto links and simple disguises, ignoring image names', () => {
    const html = '<a href="mailto:Hello@Studio.co.uk">x</a> jo [at] studio [dot] co [dot] uk logo@2x.png sentry@abc.ingest.sentry.io info&#64;studio.co.uk';
    expect(extractEmails(html).sort()).toEqual(['hello@studio.co.uk', 'info@studio.co.uk', 'jo@studio.co.uk']);
  });
  it('prefers a person, then hello@, then info@, on the business domain only', () => {
    expect(chooseEmail(['info@studio.co.uk', 'hello@studio.co.uk', 'jo.bloggs@studio.co.uk'], 'studio.co.uk')).toEqual({ email: 'jo.bloggs@studio.co.uk', named: true });
    expect(chooseEmail(['info@studio.co.uk', 'hello@studio.co.uk'], 'studio.co.uk')).toEqual({ email: 'hello@studio.co.uk', named: false });
    expect(chooseEmail(['bookings@events.studio.co.uk'], 'studio.co.uk')?.email).toBe('bookings@events.studio.co.uk');
  });
  it('never picks free webmail, other domains, or privacy, jobs and accounts inboxes', () => {
    expect(chooseEmail(['someone@gmail.com', 'privacy@studio.co.uk', 'careers@studio.co.uk', 'accounts@studio.co.uk', 'noreply@studio.co.uk', 'hi@other.com'], 'studio.co.uk')).toBeNull();
  });
});

describe('reading a website', () => {
  it('turns HTML into plain text without scripts or styles', () => {
    expect(htmlToText('<style>a{}</style><h1>Night&nbsp;Club</h1><script>x()</script><p>Fri &amp; Sat</p>')).toBe('Night Club\nFri & Sat');
  });
  it('finds the contact page on the same site only', () => {
    const html = '<a href="/menu">Menu</a><a href="https://instagram.com/x">Contact us on IG</a><a href="/get-in-touch">Get in touch</a>';
    expect(findContactLink(html, 'https://venue.co.uk/')).toBe('https://venue.co.uk/get-in-touch');
  });
});

const opts = { senderName: 'Michael Clavier', portfolioUrl: 'https://www.rawfiile.co.uk' };
const goodBody = `Hi Sam,

I saw your Friday series at the arches is back for winter. The crowd shots on your Instagram look great, and I think a proper set of photos and a few short vertical edits from one night would give you plenty to promote the rest of the run.

I'm Michael, a London photographer and videographer. I've shot events and content for The Royal Foundation, Viberoom, YCUK and Noxy Brothers.

Do you have anything coming up I could help with?

Best,
Michael Clavier`;

describe('the house rules for first emails', () => {
  it('replaces the sign-off with the real one, adds the portfolio and the opt-out line, and removes long dashes', () => {
    const r = finishFirstEmail({ subject: 'Your Friday series — photos', body: goodBody.replace('for winter.', 'for winter — nice.') }, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email.subject).toBe('Your Friday series, photos');
    expect(r.email.body).not.toMatch(/[—―]/);
    expect(r.email.body).toContain('https://www.rawfiile.co.uk');
    expect(r.email.body.endsWith(`Best,\nMichael Clavier\n\n${OPT_OUT_LINE}`)).toBe(true);
    expect(r.email.body.match(/Michael Clavier/g)).toHaveLength(1);
  });
  it('refuses price talk, placeholders and odd lengths', () => {
    expect(finishFirstEmail({ subject: 'Photos for you', body: goodBody.replace('Do you', 'My day rate is £650. Do you') }, opts)).toEqual({ ok: false, reason: 'mentions price' });
    expect(finishFirstEmail({ subject: 'Hi there', body: goodBody.replace('Sam', '[First name]') }, opts)).toEqual({ ok: false, reason: 'unfilled placeholder' });
    expect(finishFirstEmail({ subject: 'Hi there', body: 'Hi, can I take photos?' }, opts)).toEqual({ ok: false, reason: 'too short' });
  });
  it('never calls him Mikey', () => {
    const r = finishFirstEmail({ subject: 'Photos for your launch', body: goodBody.replace("I'm Michael", "I'm Mikey") }, opts);
    expect(r.ok && r.email.body.includes('Mikey')).toBe(false);
  });
  it('turns ranges into hyphens and asides into commas', () => {
    expect(noLongDashes('9–17 June — Peckham')).toBe('9-17 June, Peckham');
  });
});

describe('the follow-up', () => {
  it('replies in thread, stays short, no price, ends with the opt-out', () => {
    const f = followUpEmail({ firstName: 'Sam', company: 'Arches Club', firstSubject: 'Your Friday series', ...opts });
    expect(f.subject).toBe('Re: Your Friday series');
    expect(f.body.startsWith('Hi Sam,')).toBe(true);
    expect(f.body).not.toMatch(/£|rate/i);
    expect(f.body.trim().endsWith(OPT_OUT_LINE)).toBe(true);
    expect(f.body.split(/\s+/).length).toBeLessThan(90);
  });
});

describe('reading replies', () => {
  const m = (from: string, subject: string, snippet: string, autoSubmitted?: string) => classifyReply({ from, subject, snippet, autoSubmitted });
  it('tells bounces, out-of-office, opt-outs and real replies apart', () => {
    expect(m('Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)', 'Address not found')).toBe('bounce');
    expect(m('Sam <sam@arches.co.uk>', 'Automatic reply: Your Friday series', 'I am out of the office until Monday')).toBe('auto_reply');
    expect(m('Sam <sam@arches.co.uk>', 'Re: Your Friday series', 'Thanks', 'auto-replied')).toBe('auto_reply');
    expect(m('Sam <sam@arches.co.uk>', 'Re: Your Friday series', 'No thanks, we have someone already')).toBe('opt_out');
    expect(m('Sam <sam@arches.co.uk>', 'Re: Your Friday series', 'Please remove me from your list')).toBe('opt_out');
    expect(m('Sam <sam@arches.co.uk>', 'Re: Your Friday series', 'Hi Michael, yes! Can you do 14 Nov?')).toBe('reply');
  });
});

describe('the writer’s answer', () => {
  it('reads JSON even with text around it, and rejects junk', () => {
    const a = parseAssessment('Here you go: {"is_business":true,"is_london":true,"business_type":"club","company_name":"Arches","contact_name":"Sam Lee","fit":8.4,"reason":"r","summary":"s","subject":"x","body":"y"} done');
    expect(a).toMatchObject({ fit: 8, company_name: 'Arches', contact_name: 'Sam Lee' });
    expect(parseAssessment('no json here')).toBeNull();
    expect(parseAssessment('{"fit":"high"}')).toBeNull();
  });
});

import { dailyLimit, inSendWindow, londonParts, minutesBetweenSends, nextSearch, suggestAuto } from '@/lib/autopilot/schedule';

describe('when and how much to send', () => {
  const s = { send_days: [1, 2, 3, 4, 5], window_start: '09:30', window_end: '16:30' };
  it('uses London time, including British Summer Time', () => {
    expect(londonParts(new Date('2026-07-01T08:45:00Z'))).toMatchObject({ date: '2026-07-01', minutes: 9 * 60 + 45, weekday: 3 });
    expect(londonParts(new Date('2026-12-01T08:45:00Z'))).toMatchObject({ minutes: 8 * 60 + 45 });
  });
  it('only sends on weekdays inside the window', () => {
    expect(inSendWindow(s, new Date('2026-10-26T10:00:00Z'))).toBe(true); // Mon 10:00 GMT
    expect(inSendWindow(s, new Date('2026-10-26T08:00:00Z'))).toBe(false); // Mon 08:00
    expect(inSendWindow(s, new Date('2026-10-26T16:45:00Z'))).toBe(false); // Mon 16:45
    expect(inSendWindow(s, new Date('2026-10-25T11:00:00Z'))).toBe(false); // Sunday
  });
  it('warms a new mailbox up: 3 a day, then 6, then the full limit', () => {
    const now = new Date('2026-11-30T12:00:00Z');
    expect(dailyLimit(10, null, now)).toBe(0);
    expect(dailyLimit(10, '2026-11-28T12:00:00Z', now)).toBe(3);
    expect(dailyLimit(10, '2026-11-20T12:00:00Z', now)).toBe(6);
    expect(dailyLimit(10, '2026-11-01T12:00:00Z', now)).toBe(10);
    expect(dailyLimit(4, '2026-11-20T12:00:00Z', now)).toBe(4);
  });
  it('spreads sends across the day', () => {
    expect(minutesBetweenSends(s, 10, 1)).toBe(42);
    expect(minutesBetweenSends(s, 10, 0)).toBe(29);
    expect(minutesBetweenSends(s, 100, 0)).toBe(8);
  });
  it('takes turns between targets, page by page, and stops when they are used up', () => {
    const t = ['a', 'b'];
    expect(nextSearch(t, [])).toEqual({ query: 'a', page: 0 });
    expect(nextSearch(t, [{ query: 'a', page: 0 }])).toEqual({ query: 'b', page: 0 });
    expect(nextSearch(t, [{ query: 'a', page: 0 }, { query: 'b', page: 0 }])).toEqual({ query: 'a', page: 1 });
    expect(nextSearch(['a'], [{ query: 'a', page: 9 }])).toBeNull();
  });
  it('suggests automatic mode after two weeks of approving', () => {
    expect(suggestAuto({ mode: 'approve', approve_mode_since: '2026-10-01T00:00:00Z' }, new Date('2026-10-16T00:00:00Z'))).toBe(true);
    expect(suggestAuto({ mode: 'approve', approve_mode_since: '2026-10-10T00:00:00Z' }, new Date('2026-10-16T00:00:00Z'))).toBe(false);
    expect(suggestAuto({ mode: 'auto', approve_mode_since: '2026-10-01T00:00:00Z' }, new Date('2026-10-16T00:00:00Z'))).toBe(false);
  });
});

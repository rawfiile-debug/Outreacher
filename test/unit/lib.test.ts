import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, parseLooseDate } from '@/lib/dates';
import { followUpEmail, gmailComposeUrl } from '@/lib/followup';
import { validToken } from '@/lib/share';

describe('parseLooseDate', () => {
  const now = '2026-10-23';
  it.each([
    ['12/10/2026', '2026-10-12'], ['12/10/26', '2026-10-12'], ['2026-10-12', '2026-10-12'], ['3.9.2026', '2026-09-03'],
    ['12 Oct 2026', '2026-10-12'], ['12th October', '2026-10-12'], ['Mon 5 October 2026', '2026-10-05'], ['October 5', '2026-10-05'],
    ['12/10', '2026-10-12'], ['25/12', '2025-12-25'], ['  1st Sept 2026 ', '2026-09-01'],
  ])('reads %s', (input, out) => expect(parseLooseDate(input, now)).toBe(out));
  it.each(['', 'last week', '31/02/2026', '13/13/2026', '07700 900000', 'sent'])('refuses %s', (input) => expect(parseLooseDate(input, now)).toBeNull());
});

describe('date maths', () => {
  it('adds days across months and counts the gap', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(daysBetween('2026-10-16', '2026-10-23')).toBe(7);
  });
});

describe('follow-up email', () => {
  it('uses the first name, never mentions a price, and signs as Michael Clavier', () => {
    const { subject, body } = followUpEmail({ name: 'Ada Lovelace', company: 'Agency One', email: 'a@x.test' });
    expect(subject).toBe('Following up, Agency One');
    expect(body.startsWith('Hi Ada,')).toBe(true);
    expect(body).not.toMatch(/£|\bprice|\brate/i);
    expect(body.trim().endsWith('Michael Clavier')).toBe(true);
    expect(body).not.toMatch(/[—―]/);
  });
  it('builds a Gmail compose link that only opens a draft', () => {
    const u = new URL(gmailComposeUrl('a@x.test', 'Hi & bye', 'Line 1\nLine 2'));
    expect(u.hostname).toBe('mail.google.com');
    expect(u.searchParams.get('view')).toBe('cm');
    expect(u.searchParams.get('su')).toBe('Hi & bye');
    expect(u.searchParams.get('body')).toBe('Line 1\nLine 2');
  });
});

describe('share tokens', () => {
  it('only accepts 43-character base64url tokens', () => {
    expect(validToken('A'.repeat(43))).toBe(true);
    expect(validToken('A'.repeat(42))).toBe(false);
    expect(validToken('A'.repeat(42) + '/')).toBe(false);
  });
});

import { fromNotion, mergeNotion, type NotionPage } from '@/lib/notion';

describe('Notion import', () => {
  const page = (props: Record<string, unknown>): NotionPage => ({ id: '2e1c086f-2707-80cd-843c-fd100aa8ec14', properties: props as NotionPage['properties'] });
  const full = page({
    'Contact Name': { title: [{ plain_text: 'Ada ' }, { plain_text: 'Lovelace' }] }, Company: { rich_text: [{ plain_text: 'Agency One' }] },
    'Email Address': { email: 'Ada@AgencyOne.com ' }, Role: { rich_text: [{ plain_text: 'Producer' }] },
    'Email sent on': { phone_number: '14/10/2026' }, Notes: { rich_text: [] }, response: { checkbox: false },
  });
  it('reads the Email Contacts columns, including the free-text sent date', () => {
    expect(fromNotion(full, '2026-10-23')).toEqual({ notion_page_id: full.id, name: 'Ada Lovelace', company: 'Agency One', role: 'Producer',
      email: 'ada@agencyone.com', notes: '', first_emailed_on: '2026-10-14', replied: false });
  });
  it('creates new contacts at the right stage', () => {
    expect(mergeNotion(fromNotion(full, '2026-10-23'))).toMatchObject({ stage: 'Emailed', first_emailed_on: '2026-10-14' });
    expect(mergeNotion({ ...fromNotion(full), replied: true })).toMatchObject({ stage: 'Replied' });
    expect(mergeNotion({ ...fromNotion(full), first_emailed_on: null })).toMatchObject({ stage: 'To contact' });
  });
  it('only fills gaps and moves stages forward on existing contacts', () => {
    const n = { ...fromNotion(full, '2026-10-23'), replied: true };
    const existing = { name: 'Ada L', company: '', role: 'Producer', email: 'ada@agencyone.com', notes: 'Met at a launch', first_emailed_on: '2026-10-13', stage: 'Followed up' as const, notion_page_id: null };
    expect(mergeNotion(n, existing)).toEqual({ notion_page_id: n.notion_page_id, company: 'Agency One', stage: 'Replied' });
    expect(mergeNotion({ ...n, replied: false }, { ...existing, stage: 'Won', notion_page_id: n.notion_page_id, company: 'X' })).toEqual({});
    expect(mergeNotion(n, { ...existing, stage: 'Not now', notion_page_id: n.notion_page_id, company: 'X' })).toEqual({});
  });
});

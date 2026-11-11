import { describe, expect, it } from 'vitest';
import { domainOf, linesToList, parseSuppression, stageTone, suggestAuto } from '../src/lib/outreach';

describe('suggestAuto', () => {
  const now = new Date('2026-11-30T12:00:00Z');
  it('suggests automatic after two weeks of approving', () => {
    expect(suggestAuto({ mode: 'approve', approve_mode_since: '2026-11-11T10:00:00Z' }, now)).toBe(true);
  });
  it('waits until two weeks have passed', () => {
    expect(suggestAuto({ mode: 'approve', approve_mode_since: '2026-11-20T10:00:00Z' }, now)).toBe(false);
  });
  it('never suggests when already automatic', () => {
    expect(suggestAuto({ mode: 'auto', approve_mode_since: '2026-10-01T10:00:00Z' }, now)).toBe(false);
  });
});

describe('linesToList', () => {
  it('trims, drops blanks and repeats', () => {
    expect(linesToList(' a \n\nb\na\n')).toEqual(['a', 'b']);
  });
  it('keeps at most 20', () => {
    expect(linesToList(Array.from({ length: 30 }, (_, i) => `t${i}`).join('\n'))).toHaveLength(20);
  });
});

describe('parseSuppression', () => {
  it('reads an address', () => expect(parseSuppression(' Jo@Brand.com ')).toEqual({ value: 'jo@brand.com', kind: 'email' }));
  it('reads a domain in several forms', () => {
    for (const v of ['brand.com', '@brand.com', 'https://www.brand.com/contact']) expect(parseSuppression(v)).toEqual({ value: 'brand.com', kind: 'domain' });
  });
  it('rejects nonsense', () => expect(parseSuppression('hello')).toBeNull());
});

describe('domainOf and stageTone', () => {
  it('finds the domain', () => {
    expect(domainOf('https://www.Brand.co.uk/x')).toBe('brand.co.uk');
    expect(domainOf('brand.com')).toBe('brand.com');
  });
  it('colours stages', () => {
    expect(stageTone('Replied')).toBe('ok');
    expect(stageTone('Not now')).toBe('bad');
  });
});

import { safeFileName } from '../src/lib/outreach';
describe('safeFileName', () => {
  it('cleans names', () => {
    expect(safeFileName('My CV (2026) final.PDF')).toBe('My-CV-2026-final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('é.png')).toBe('e.png');
  });
});

import { daysUntil, deadlineLabel, draftFileName } from '../src/lib/outreach';
describe('deadlines', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  it('counts days in London', () => {
    expect(daysUntil('2026-11-20', now)).toBe(9);
    expect(daysUntil('2026-11-10', now)).toBe(-1);
  });
  it('labels them', () => {
    expect(deadlineLabel({ deadline: '2026-11-12', deadline_note: '' }, now)).toBe('12 Nov 2026 (1 day)');
    expect(deadlineLabel({ deadline: '2026-11-11', deadline_note: '' }, now)).toBe('Closes today');
    expect(deadlineLabel({ deadline: null, deadline_note: '' }, now)).toBe('Rolling or not stated');
    expect(deadlineLabel({ deadline: '2026-11-01', deadline_note: '' }, now)).toMatch(/^Closed/);
  });
  it('makes safe file names', () => expect(draftFileName('DYCP: Round 3/4')).toBe('DYCP Round 3 4 - Michael Clavier'));
});

import { toBlocks } from '../src/lib/download';
describe('toBlocks', () => {
  it('finds headings and paragraphs', () => {
    const b = toBlocks('Q1: Tell us about your project\nI want to photograph...\n\nSecond para here.\n\nBUDGET\n£2,000 on film');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'para', 'heading', 'para']);
    expect(b[0].text).toBe('Q1: Tell us about your project');
  });
});

import { instantSummary } from '../src/lib/outreach';
describe('instantSummary', () => {
  const base = { website: 'https://www.rawfiile.co.uk', bio: "I'm Michael.", clients: 'Viberoom\n- YCUK', projects: 'From the Concrete: lookbook', awards: '', equipment: 'Mamiya RB67', extra: '', apply_as: ['individual', 'ycuk'], cv_text: '', instagram_text: '' };
  it('arranges his own words under headings', () => {
    const s = instantSummary(base);
    expect(s).toContain("WHO I AM\nI'm Michael.");
    expect(s).toContain('CLIENTS AND COLLABORATORS\n- Viberoom\n- YCUK');
    expect(s).toContain('RECOGNITION\nNone listed yet');
    expect(s).toContain('- Through YCUK (organisation)');
    expect(s).toContain('TO CHECK\nNothing to check');
    expect(s).not.toContain('ALSO');
  });
  it('lists what is missing', () => {
    expect(instantSummary({ ...base, bio: '', clients: '' })).toContain('Add a short bio, clients');
  });
});

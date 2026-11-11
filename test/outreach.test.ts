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

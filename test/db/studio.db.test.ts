import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, pool } from './helpers';

let owner: string;
let intruder: string;
const q1 = (uid: string, sql: string, params: unknown[] = []) => asUser(uid, async (db) => (await db.query(sql, params)).rows[0]);
const qa = (uid: string, sql: string, params: unknown[] = []) => asUser(uid, async (db) => (await db.query(sql, params)).rows);
const asAnon = async <T>(fn: (c: import('pg').PoolClient) => Promise<T>) => {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); await c.query('set local role anon');
    const out = await fn(c); await c.query('commit'); return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
};
const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const daysAgo = (n: number) => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  owner = await createUser();
  intruder = await createUser();
  await asUser(owner, (db) => db.query(`select ensure_settings(); update business_settings set trading_name = 'RAWFIILE' where owner_id = auth.uid()`));
});
afterAll(async () => { await pool.end(); });

describe('outreach contacts', () => {
  it('stamps dates as a contact moves along, and flags one follow-up a week after the first email', async () => {
    const c = await q1(owner, `insert into studio_contacts(name, company, email) values ('Ada', 'Agency One', 'ada@agency.test') returning *`);
    expect(c).toMatchObject({ stage: 'To contact', first_emailed_on: null });
    const e = await q1(owner, `update studio_contacts set stage = 'Emailed' where id = $1 returning first_emailed_on`, [c.id]);
    expect(e.first_emailed_on).toBe(today());
    expect(await q1(owner, 'select follow_up_due from studio_contact_list where id = $1', [c.id])).toEqual({ follow_up_due: false });
    await q1(owner, `update studio_contacts set first_emailed_on = $2 where id = $1 returning id`, [c.id, daysAgo(7)]);
    expect(await q1(owner, 'select follow_up_due, follow_up_on from studio_contact_list where id = $1', [c.id])).toEqual({ follow_up_due: true, follow_up_on: today() });
    const f = await q1(owner, `update studio_contacts set stage = 'Followed up' where id = $1 returning followed_up_on`, [c.id]);
    expect(f.followed_up_on).toBe(today());
    expect((await q1(owner, 'select follow_up_due from studio_contact_list where id = $1', [c.id])).follow_up_due).toBe(false);
    const r = await q1(owner, `update studio_contacts set stage = 'Replied' where id = $1 returning replied_on, first_emailed_on`, [c.id]);
    expect(r).toEqual({ replied_on: today(), first_emailed_on: daysAgo(7) });
  });

  it('refuses a blank contact and a duplicate email', async () => {
    await expect(q1(owner, `insert into studio_contacts(name) values ('') returning id`)).rejects.toThrow(/has_name/);
    await q1(owner, `insert into studio_contacts(name, email) values ('One', 'dupe@x.test') returning id`);
    await expect(q1(owner, `insert into studio_contacts(name, email) values ('Two', 'DUPE@x.test') returning id`)).rejects.toThrow(/duplicate key/);
    // Someone else can hold the same email in their own tracker.
    expect(await q1(intruder, `insert into studio_contacts(name, email) values ('Mine', 'dupe@x.test') returning name`)).toEqual({ name: 'Mine' });
  });

  it('keeps every account’s contacts private', async () => {
    const c = await q1(owner, `insert into studio_contacts(name) values ('Private person') returning id`);
    expect(await qa(intruder, 'select id from studio_contacts where id = $1', [c.id])).toEqual([]);
    expect(await qa(intruder, 'select id from studio_contact_list where id = $1', [c.id])).toEqual([]);
    expect(await qa(intruder, `update studio_contacts set notes = 'x' where id = $1 returning id`, [c.id])).toEqual([]);
    await expect(q1(intruder, `insert into studio_contacts(owner_id, name) values ($1, 'Planted') returning id`, [owner])).rejects.toThrow(/row-level security/);
    await expect(asAnon((db) => db.query('select * from studio_contacts'))).rejects.toThrow(/permission denied/);
  });
});

describe('call sheets', () => {
  it('shares a call sheet read-only by link, without private notes, and the link can be switched off', async () => {
    const s = await q1(owner, `insert into studio_call_sheets(title, shoot_date, call_time, location_name, private_notes, crew, schedule)
      values ('Lookbook day', '2026-11-20', '08:30', 'Peckham studio', 'Client is late payer', $1, $2) returning id`,
      [JSON.stringify([{ name: 'Erikah', role: 'Production assistant', phone: '07000 000000' }]), JSON.stringify([{ time: '09:00', item: 'First look' }])]);
    const h = hash();
    await q1(owner, 'select studio_set_share($1, $2, $3) as at', ['call_sheet', s.id, h]);
    const v = await asAnon(async (db) => (await db.query('select studio_public_call_sheet($1) as v', [h])).rows[0].v);
    expect(v).toMatchObject({ from: 'RAWFIILE', title: 'Lookbook day', call_time: '08:30', location_name: 'Peckham studio', crew: [{ name: 'Erikah' }] });
    expect(JSON.stringify(v)).not.toContain('late payer');
    expect(v.id).toBeUndefined();
    await q1(owner, 'select studio_set_share($1, $2, null) as at', ['call_sheet', s.id]);
    expect(await asAnon(async (db) => (await db.query('select studio_public_call_sheet($1) as v', [h])).rows[0].v)).toBeNull();
    await expect(q1(intruder, 'select studio_set_share($1, $2, $3) as at', ['call_sheet', s.id, hash()])).rejects.toThrow(/Not found/);
  });

  it('refuses bad crew data and non-https map links', async () => {
    await expect(q1(owner, `insert into studio_call_sheets(crew) values ('{"a":1}') returning id`)).rejects.toThrow(/crew_check/);
    await expect(q1(owner, `insert into studio_call_sheets(map_url) values ('javascript:alert(1)') returning id`)).rejects.toThrow(/map_url_check/);
  });
});

describe('briefs and moodboards', () => {
  it('shares a brief with its moodboard, takes client comments and a one-time sign-off', async () => {
    const b = await q1(owner, `insert into studio_briefs(title, client_name, objective, palette, private_notes) values ('Spring drop', 'Brand Co', 'Launch the range', '{"#18263D","#F4F2EE"}', 'budget tight') returning id`);
    const img = `${owner}/${b.id}/${randomUUID()}.jpg`;
    await q1(owner, `insert into studio_brief_items(brief_id, kind, storage_path, caption, position) values ($1, 'image', $2, 'Soft window light', 0) returning id`, [b.id, img]);
    await q1(owner, `insert into studio_brief_items(brief_id, kind, url, position) values ($1, 'link', 'https://example.com/ref', 1) returning id`, [b.id]);
    await q1(owner, `insert into studio_brief_comments(brief_id, owner_id, author_name, body) values ($1, $2, 'Michael', 'First draft up') returning id`, [b.id, owner]);
    const h = hash();
    await q1(owner, 'select studio_set_share($1, $2, $3) as at', ['brief', b.id, h]);
    const view = () => asAnon(async (db) => (await db.query('select studio_public_brief($1) as v', [h])).rows[0].v);
    const v = await view();
    expect(v).toMatchObject({ title: 'Spring drop', palette: ['#18263D', '#F4F2EE'], items: [{ kind: 'image', storage_path: img }, { kind: 'link' }],
      comments: [{ author_name: 'Michael', from_client: false }] });
    expect(JSON.stringify(v)).not.toContain('budget tight');

    await asAnon((db) => db.query('select studio_public_brief_comment($1, $2, $3)', [h, 'Jo', 'Love the light. Can we add a street look?']));
    await expect(asAnon((db) => db.query('select studio_public_brief_comment($1, $2, $3)', [h, 'Jo', '   ']))).rejects.toThrow(/Write a comment/);
    await asAnon((db) => db.query('select studio_public_brief_approve($1, $2)', [h, 'Jo Client']));
    await expect(asAnon((db) => db.query('select studio_public_brief_approve($1, $2)', [h, 'Jo Client']))).rejects.toThrow(/already been signed off/);
    const after = await view();
    expect(after.approved_by).toBe('Jo Client');
    expect(after.comments.map((c: { from_client: boolean }) => c.from_client)).toEqual([false, true, true]);
    await expect(asAnon((db) => db.query('select studio_public_brief_comment($1, $2, $3)', ['e'.repeat(64), 'X', 'hi']))).rejects.toThrow(/not valid/);
  });

  it('stops anyone forging client comments or attaching another account’s images', async () => {
    const b = await q1(owner, `insert into studio_briefs(title) values ('Guarded') returning id`);
    await expect(q1(owner, `insert into studio_brief_comments(brief_id, owner_id, author_name, body, from_client) values ($1, $2, 'Fake', 'x', true) returning id`, [b.id, owner]))
      .rejects.toThrow(/row-level security/);
    await expect(q1(owner, `insert into studio_brief_items(brief_id, kind, storage_path) values ($1, 'image', $2) returning id`, [b.id, `${intruder}/${b.id}/${randomUUID()}.jpg`]))
      .rejects.toThrow(/image_owner/);
    await expect(q1(intruder, `insert into studio_brief_items(brief_id, owner_id, kind, caption) values ($1, $2, 'note', 'x') returning id`, [b.id, intruder]))
      .rejects.toThrow(/foreign key|brief_same_owner/);
    await expect(q1(owner, `insert into studio_briefs(palette) values ('{"red"}') returning id`)).rejects.toThrow(/palette_check/);
    expect(await qa(intruder, 'select id from studio_briefs where id = $1', [b.id])).toEqual([]);
  });

  it('starts a call sheet from a brief', async () => {
    const b = await q1(owner, `insert into studio_briefs(title, client_name, shoot_date, styling, locations) values ('Night run', 'Club X', '2026-12-05', 'Black tailoring', 'Brixton arches') returning id`);
    const s = await q1(owner, 'select * from studio_call_sheet_from_brief($1)', [b.id]);
    expect(s).toMatchObject({ brief_id: b.id, title: 'Night run', client_name: 'Club X', shoot_date: '2026-12-05', wardrobe: 'Black tailoring' });
    expect(s.notes).toContain('Brixton arches');
    await expect(q1(intruder, 'select * from studio_call_sheet_from_brief($1)', [b.id])).rejects.toThrow(/Brief not found/);
  });
});

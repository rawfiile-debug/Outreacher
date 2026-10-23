import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, pool } from './helpers';

let owner: string;
let intruder: string;
const q1 = (uid: string, sql: string, params: unknown[] = []) => asUser(uid, async (db) => (await db.query(sql, params)).rows[0]);
const qa = (uid: string, sql: string, params: unknown[] = []) => asUser(uid, async (db) => (await db.query(sql, params)).rows);
// The scheduler runs as the server (service role), which bypasses row level security.
const asServer = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

let contactId: string;
beforeAll(async () => {
  owner = await createUser();
  intruder = await createUser();
  contactId = (await q1(owner, `insert into studio_contacts(name, company, email, source, domain) values ('Ada', 'Agency', 'ada@agency.test', 'autopilot', 'agency.test') returning id`)).id;
});
afterAll(async () => { await pool.end(); });

describe('autopilot settings', () => {
  it('starts switched off, in approval mode, 10 a day, 14-day follow-up', async () => {
    const s = await q1(owner, 'insert into studio_autopilot default values returning *');
    expect(s).toMatchObject({ enabled: false, mode: 'approve', daily_new_limit: 10, follow_up_days: 14, send_days: [1, 2, 3, 4, 5] });
    await expect(q1(owner, 'update studio_autopilot set daily_new_limit = 500 returning 1')).rejects.toThrow(/daily_new_limit/);
    expect(await qa(intruder, 'select * from studio_autopilot')).toEqual([]);
  });
});

describe('email queue', () => {
  it('lets the owner edit and approve a pending email, but never mark one sent or change who it goes to', async () => {
    const e = await asServer(`insert into studio_emails(owner_id, contact_id, kind, to_email, subject, body) values ($1, $2, 'first', 'ada@agency.test', 'Hello', 'Hi Ada') returning id`, [owner, contactId]);
    expect((await q1(owner, `update studio_emails set body = 'Hi Ada, edited', status = 'approved', approved_at = now() where id = $1 returning status`, [e.id])).status).toBe('approved');
    await expect(q1(owner, `update studio_emails set status = 'sent' where id = $1 returning id`, [e.id])).rejects.toThrow(/row-level security/);
    await expect(q1(owner, `update studio_emails set to_email = 'someone@else.test' where id = $1 returning id`, [e.id])).rejects.toThrow(/permission denied/);
    await expect(q1(owner, `insert into studio_emails(contact_id, kind, to_email, subject, body) values ($1, 'first', 'x@y.test', 's', 'b') returning id`, [contactId])).rejects.toThrow(/permission denied/);
    // Once sent (by the server) it is history and cannot be edited.
    await asServer(`update studio_emails set status = 'sent', sent_at = now() where id = $1`, [e.id]);
    expect(await qa(owner, `update studio_emails set body = 'changed' where id = $1 returning id`, [e.id])).toEqual([]);
    expect(await qa(intruder, 'select id from studio_emails where id = $1', [e.id])).toEqual([]);
  });

  it('allows only one first email and one follow-up per contact', async () => {
    const c = (await q1(owner, `insert into studio_contacts(name, email) values ('Once', 'once@x.test') returning id`)).id;
    await asServer(`insert into studio_emails(owner_id, contact_id, kind, to_email, subject, body) values ($1, $2, 'first', 'once@x.test', 's', 'b')`, [owner, c]);
    await expect(asServer(`insert into studio_emails(owner_id, contact_id, kind, to_email, subject, body) values ($1, $2, 'first', 'once@x.test', 's', 'b')`, [owner, c])).rejects.toThrow(/one_per_kind/);
  });
});

describe('mailbox tokens', () => {
  it('are never readable from the app; the owner only sees which address is connected', async () => {
    await asServer(`insert into studio_mailboxes(owner_id, email, refresh_token_enc) values ($1, 'michael@rawfiile.test', 'v1.secret')`, [owner]);
    await expect(q1(owner, 'select refresh_token_enc from studio_mailboxes')).rejects.toThrow(/permission denied/);
    expect(await q1(owner, 'select email from studio_mailbox_status')).toEqual({ email: 'michael@rawfiile.test' });
    expect(await qa(intruder, 'select email from studio_mailbox_status')).toEqual([]);
    await q1(owner, 'select studio_disconnect_mailbox() as x');
    expect(await asServer('select count(*)::int as n from studio_mailboxes where owner_id = $1', [owner])).toEqual({ n: 0 });
  });
});

describe('do-not-contact list', () => {
  it('matches a whole domain or one address, per account', async () => {
    await q1(owner, `insert into studio_suppressions(value, kind, reason) values ('blocked.test', 'domain', 'manual'), ('solo@ok.test', 'email', 'opt_out') returning id`);
    const check = (o: string, e: string) => asServer('select studio_is_suppressed($1, $2) as s', [o, e]).then((r) => r.s);
    expect(await check(owner, 'Anyone@Blocked.test')).toBe(true);
    expect(await check(owner, 'solo@ok.test')).toBe(true);
    expect(await check(owner, 'other@ok.test')).toBe(false);
    expect(await check(intruder, 'solo@ok.test')).toBe(false);
    await expect(q1(owner, `insert into studio_suppressions(value, kind) values ('UPPER@x.test', 'email') returning id`)).rejects.toThrow(/check/);
    await expect(q1(owner, 'select studio_is_suppressed($1, $2) as s', [owner, 'x@y.test'])).rejects.toThrow(/permission denied/);
  });
});

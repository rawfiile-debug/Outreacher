import pg, { Pool, PoolClient } from 'pg';
pg.types.setTypeParser(1082, (v: string) => v); // keep DATE as 'YYYY-MM-DD' like PostgREST does
import { randomUUID } from 'node:crypto';

// Connects as the postgres superuser, then switches to the `authenticated` role with JWT claims inside each
// transaction, exactly like PostgREST does for a signed-in Supabase user. RLS therefore applies in these tests.
export const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:54322/postgres',
  max: 60,
});

export async function createUser(email = `${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, email, aud, role, instance_id) values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
    [id, email],
  );
  return id;
}

export async function asUser<T>(uid: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function addClient(uid: string, name: string, email = 'accounts@example.test') {
  return asUser(uid, async (c) => {
    const r = await c.query(`insert into clients(name, email, billing_address) values ($1, $2, 'London') returning *`, [name, email]);
    return r.rows[0];
  });
}

export async function saveInvoice(uid: string, payload: Record<string, unknown>) {
  return asUser(uid, async (c) => (await c.query('select * from save_invoice($1::jsonb)', [JSON.stringify(payload)])).rows[0]);
}

export const line = (description: string, quantity: number, unit_price_pence: number) => ({ description, quantity, unit_price_pence });

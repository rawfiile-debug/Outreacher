import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type OwnerContext = { supabase: SupabaseClient; user: User };

/**
 * Every signed-in account gets its own workspace. Data access is additionally restricted
 * by Postgres row-level security using auth.uid(); never rely on this session check alone.
 */
export async function requireOwner(): Promise<OwnerContext> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Please sign in again.');
  return { supabase, user: data.user };
}

/** Blocks cross-site form posts: state-changing requests must come from this app's own origin. */
function assertSameOrigin(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser clients (no cookies sent cross-site anyway)
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, 'Cross-site request blocked.');
  }
}

type PgLikeError = { code?: string; message?: string; details?: string; hint?: string };

/** Turns database errors into clear HTTP responses (messages come from our own SQL functions). */
export function mapDbError(err: PgLikeError): HttpError {
  const msg = err.message || 'Database error';
  switch (err.code) {
    case '23505': return new HttpError(409, msg.includes('already used') ? msg : 'That value is already in use.', 'duplicate');
    case '22023': case '23514': case '22P02': case '22007': case '22008':
      return new HttpError(400, err.code === '22023' ? msg : 'Some values are not valid. Please check the form.', 'invalid');
    case 'P0002': case 'PGRST116': return new HttpError(404, msg === 'JSON object requested, multiple (or no) rows returned' ? 'Not found.' : msg, 'not_found');
    case 'P0001': return new HttpError(409, msg, 'conflict');
    case '28000': case 'PGRST301': return new HttpError(401, 'Please sign in again.');
    case '42501': return new HttpError(403, 'You do not have access to that.');
    default:
      if (/cannot be (changed|deleted|edited)|Payments cannot|voided payment/.test(msg)) return new HttpError(409, msg, 'conflict');
      console.error('Unhandled database error', err);
      return new HttpError(500, 'Something went wrong saving to the database. Nothing was changed.');
  }
}

/** Throws a mapped HttpError if a Supabase call failed, otherwise returns the data. */
export function must<T>(res: { data: T | null; error: PgLikeError | null }): T {
  if (res.error) throw mapDbError(res.error);
  if (res.data === null) throw new HttpError(404, 'Not found.');
  return res.data;
}

type Handler<P> = (req: NextRequest, ctx: OwnerContext & { params: P }) => Promise<Response | unknown>;

/** Wraps an owner-only route: same-origin check, auth, JSON response, consistent error handling. */
export function ownerRoute<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const owner = await requireOwner();
      const params = (await routeCtx?.params) ?? ({} as P);
      const result = await handler(req, { ...owner, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return NextResponse.json({ error: `${where}${first?.message || 'Invalid input'}`, code: 'invalid', issues: e.issues }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: 'Unexpected server error. Nothing was changed.' }, { status: 500 });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

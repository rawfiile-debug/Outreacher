import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { runTick } from '@/lib/autopilot/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Called every ten minutes by the scheduler in Supabase (pg_cron). Needs the shared secret.
export async function GET(req: NextRequest) {
  const given = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(env.cronSecret || '');
  if (!env.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const report = await runTick({ budgetMs: 45_000 });
  return NextResponse.json({ ok: true, report }, { headers: { 'cache-control': 'no-store' } });
}

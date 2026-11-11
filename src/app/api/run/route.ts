import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Starts the "Outreacher hourly" Claude scheduled task straight away, so a button press is handled in minutes
// rather than at the next scheduled run. Uses the task's own API trigger (a per-task token from
// claude.ai/code/routines), which is part of Michael's Claude plan: no API key, nothing extra to pay.
// Only a signed-in user can call it, and the token never leaves the server.

const KINDS = new Set(['build_profile', 'draft_grant', 'find_grants', 'check_gigs']);
let lastFire = 0;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const url = process.env.OUTREACHER_RUN_URL?.trim();
  const token = process.env.OUTREACHER_RUN_TOKEN?.trim();
  if (!url || !token) return NextResponse.json({ ok: false, queued: true, error: 'not_configured' }, { status: 200 });
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[A-Za-z0-9_]+\/fire$/.test(url)) {
    return NextResponse.json({ ok: false, queued: true, error: 'OUTREACHER_RUN_URL does not look like a routine fire address.' }, { status: 200 });
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = KINDS.has(body.kind || '') ? body.kind! : 'jobs';

  // One start every 20 seconds at most: queued jobs are picked up together, so extra starts would only cost usage.
  const now = Date.now();
  if (now - lastFire < 20_000) return NextResponse.json({ ok: true, started: false, note: 'A run was just started; it will pick this up too.' });
  lastFire = now;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
    },
    body: JSON.stringify({ text: `ON DEMAND (${kind}): Michael pressed a button in Outreacher. Do STEP 1 (queued jobs) only, then finish.` }),
  }).catch(() => null);
  if (!res || !res.ok) {
    lastFire = 0;
    const detail = res ? `${res.status}` : 'no response';
    return NextResponse.json({ ok: false, queued: true, error: `Could not start Claude (${detail}). It will run at the next scheduled time instead.` }, { status: 200 });
  }
  return NextResponse.json({ ok: true, started: true });
}

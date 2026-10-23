import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, HttpError, readJson } from '@/lib/api';
import { createSupabaseAnonClient } from '@/lib/supabase/server';
import { sha256HexServer } from '@/lib/share-server';
import { validToken } from '@/lib/share';

const schema = z.object({ action: z.enum(['comment', 'approve']), name: z.string().trim().min(1).max(100), body: z.string().max(2000).optional().default('') });

// A client comment or sign-off through the brief link. The token is the only key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (origin && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked.');
    const { token } = await params;
    if (!validToken(token)) throw new HttpError(404, 'This link is not valid.');
    const b = schema.parse(await readJson(req));
    const hash = sha256HexServer(token);
    const db = createSupabaseAnonClient();
    const { error } = b.action === 'comment'
      ? await db.rpc('studio_public_brief_comment', { p_token_hash: hash, p_name: b.name, p_body: b.body })
      : await db.rpc('studio_public_brief_approve', { p_token_hash: hash, p_name: b.name });
    if (error) throw new HttpError(error.code === 'P0002' ? 404 : 400, error.message);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}

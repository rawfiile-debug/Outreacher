import { NextResponse, type NextRequest } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { requireOwner } from '@/lib/api';
import { autopilotReady, env } from '@/lib/env';
import { sign } from '@/lib/crypto';
import { authUrl } from '@/lib/autopilot/gmail';

// Starts connecting the outreach mailbox. ?hint= suggests which Google account to pick.
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireOwner();
    if (!autopilotReady.mailbox) return NextResponse.redirect(new URL('/autopilot?mailbox_error=' + encodeURIComponent('Google sign-in is not set up on the server yet.'), req.url));
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const res = NextResponse.redirect(authUrl(state, createHash('sha256').update(verifier).digest('base64url'), req.nextUrl.searchParams.get('hint') || undefined));
    res.cookies.set('mb_oauth', sign(JSON.stringify({ state, verifier, uid: user.id, t: Date.now() })), {
      httpOnly: true, secure: env.appUrl.startsWith('https://'), sameSite: 'lax', path: '/api/mailbox', maxAge: 600,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL('/login?next=/autopilot', req.url));
  }
}

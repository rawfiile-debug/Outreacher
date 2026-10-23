import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner } from '@/lib/api';
import { verifySigned } from '@/lib/crypto';
import { exchangeCode, saveMailbox, SCOPES } from '@/lib/autopilot/gmail';

export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/autopilot?${q}`, req.url));
    r.cookies.set('mb_oauth', '', { path: '/api/mailbox', maxAge: 0 });
    return r;
  };
  try {
    const { user } = await requireOwner();
    const sp = req.nextUrl.searchParams;
    if (sp.get('error')) throw new Error(sp.get('error') === 'access_denied' ? 'You cancelled the Google screen, so no mailbox was connected.' : `Google returned: ${sp.get('error')}`);
    const raw = verifySigned(req.cookies.get('mb_oauth')?.value);
    if (!raw) throw new Error('The connection attempt expired. Please try again.');
    const st = JSON.parse(raw) as { state: string; verifier: string; uid: string; t: number };
    if (st.state !== sp.get('state') || st.uid !== user.id || Date.now() - st.t > 600_000) throw new Error('The connection attempt could not be verified. Please try again.');
    const tokens = await exchangeCode(sp.get('code') || '', st.verifier);
    const granted = (tokens.scope || '').split(' ');
    const missing = SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s));
    if (missing.length) throw new Error('Both the send and read permissions are needed. Please tick both boxes on the Google screen.');
    if (!tokens.refresh_token) throw new Error('Google did not give a long-lived permission. Remove Outreacher at myaccount.google.com/permissions and connect again.');
    const email = await saveMailbox(user.id, tokens);
    return back(`mailbox=${encodeURIComponent(email)}`);
  } catch (e) {
    return back(`mailbox_error=${encodeURIComponent(e instanceof Error ? e.message : 'Something went wrong. Nothing was saved.')}`);
  }
}

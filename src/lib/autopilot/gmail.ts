import 'server-only';
import { randomBytes } from 'node:crypto';
import { env } from '@/lib/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

// The outreach mailbox. Permissions, kept to what the job needs:
//   gmail.send     - send the first emails and follow-ups
//   gmail.readonly - see replies, out-of-office messages and bounces to those emails
//   openid email   - show which address is connected
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const redirectUri = () => `${env.appUrl}/api/mailbox/callback`;

export function authUrl(state: string, challenge: string, loginHint?: string) {
  const p = new URLSearchParams({ client_id: env.googleClientId!, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
  if (loginHint) p.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type Tok = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; error?: string; error_description?: string };

export async function exchangeCode(code: string, verifier: string): Promise<Tok> {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: env.googleClientId!, client_secret: env.googleClientSecret!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }) });
  const j = (await res.json()) as Tok;
  if (!res.ok || j.error) throw new Error(`Google did not accept the sign-in: ${j.error_description || j.error || res.status}`);
  return j;
}

export async function saveMailbox(ownerId: string, t: Tok) {
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
  const email = info.ok ? ((await info.json()) as { email?: string }).email || '' : '';
  const { error } = await createSupabaseAdminClient().from('studio_mailboxes').upsert({
    owner_id: ownerId, email, refresh_token_enc: encryptSecret(t.refresh_token!), access_token_enc: encryptSecret(t.access_token),
    access_token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), scopes: (t.scope || '').split(' '),
    connected_at: new Date().toISOString(), last_error: '',
  }, { onConflict: 'owner_id' });
  if (error) throw new Error('Could not store the mailbox connection securely.');
  return email;
}

export type Mailbox = { owner_id: string; email: string; connected_at: string };

export async function accessToken(ownerId: string): Promise<{ token: string; mailbox: Mailbox }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('studio_mailboxes').select('*').eq('owner_id', ownerId).maybeSingle();
  if (!data) throw new Error('No outreach mailbox is connected.');
  const mailbox = { owner_id: data.owner_id, email: data.email, connected_at: data.connected_at };
  if (data.access_token_enc && data.access_token_expires_at && new Date(data.access_token_expires_at) > new Date()) {
    return { token: decryptSecret(data.access_token_enc), mailbox };
  }
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.googleClientId!, client_secret: env.googleClientSecret!, refresh_token: decryptSecret(data.refresh_token_enc), grant_type: 'refresh_token' }) });
  const j = (await res.json()) as Tok;
  if (!res.ok || !j.access_token) {
    const msg = j.error === 'invalid_grant' ? 'Google has disconnected the outreach mailbox. Connect it again on the Autopilot page.' : `Google token error (${j.error || res.status}).`;
    await admin.from('studio_mailboxes').update({ last_error: msg }).eq('owner_id', ownerId);
    throw new Error(msg);
  }
  await admin.from('studio_mailboxes').update({ access_token_enc: encryptSecret(j.access_token), last_error: '',
    access_token_expires_at: new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() }).eq('owner_id', ownerId);
  return { token: j.access_token, mailbox };
}

async function gmail<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Gmail error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`);
const clean = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** Builds a plain-text email. Follow-ups carry In-Reply-To and References so they sit in the same thread. */
export function buildMessage(o: { fromName: string; fromEmail: string; to: string; subject: string; body: string; inReplyTo?: string | null }): { raw: string; messageId: string } {
  const domain = o.fromEmail.split('@')[1] || 'rawfiile.co.uk';
  const messageId = `<${Date.now().toString(36)}.${randomBytes(9).toString('hex')}@${domain}>`;
  const headers = [
    `From: ${encodeHeader(clean(o.fromName))} <${clean(o.fromEmail)}>`,
    `To: ${clean(o.to)}`,
    `Subject: ${encodeHeader(clean(o.subject))}`,
    `Message-ID: ${messageId}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
    `List-Unsubscribe: <mailto:${clean(o.fromEmail)}?subject=unsubscribe>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(o.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return { raw: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url'), messageId };
}

export async function sendMessage(token: string, raw: string, threadId?: string | null) {
  return gmail<{ id: string; threadId: string }>(token, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
}

export type InboxMessage = { id: string; threadId: string; from: string; subject: string; snippet: string; autoSubmitted: string; internalDate: number };

/** Messages that arrived after a time, newest first, with just the headers needed to understand them. */
export async function inboxSince(token: string, afterUnix: number, max = 40): Promise<InboxMessage[]> {
  const q = encodeURIComponent(`after:${afterUnix} -from:me -in:chats`);
  const list = await gmail<{ messages?: { id: string }[] }>(token, `/messages?q=${q}&maxResults=${max}&includeSpamTrash=false`);
  const out: InboxMessage[] = [];
  for (const m of list.messages || []) {
    const g = await gmail<{ id: string; threadId: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } }>(
      token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Auto-Submitted`);
    const h = (n: string) => g.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || '';
    out.push({ id: g.id, threadId: g.threadId, from: h('From'), subject: h('Subject'), snippet: g.snippet || '', autoSubmitted: h('Auto-Submitted'), internalDate: Number(g.internalDate) });
  }
  return out;
}

export const addressOf = (from: string) => (/<([^>]+)>/.exec(from)?.[1] || from).trim().toLowerCase();

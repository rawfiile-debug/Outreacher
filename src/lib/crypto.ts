import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { env } from '@/lib/env';

// AES-256-GCM encryption for OAuth tokens before they are written to the database.
// TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (generate with: openssl rand -base64 32).

function key(): Buffer {
  const raw = env.tokenEncryptionKey;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised encrypted value');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** HMAC signature for short-lived values such as the OAuth state cookie. */
export function sign(value: string): string {
  const mac = createHmac('sha256', key()).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifySigned(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(sign(value).slice(i + 1));
  const given = Buffer.from(signed.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}

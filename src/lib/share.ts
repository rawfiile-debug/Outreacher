// Share links: 32 random bytes in the URL, only the SHA-256 hash stored in the database (as FRAME's quote links).
// Made in the browser, so the token never touches the server at all; it is shown to the owner when created.

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeShareToken(): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await sha256Hex(token) };
}

/** Only well-formed tokens are looked up at all. */
export const validToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

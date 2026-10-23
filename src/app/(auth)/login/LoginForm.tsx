'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message); return; }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch {
      setError('Could not reach the sign-in service. Check your connection.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="form-grid" style={{ gridTemplateColumns: '1fr', marginTop: 14 }}>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : null} Sign in</button>
      <p className="small">Forgotten it? Reset your password from FRAME&apos;s sign-in page; the same password then works here.</p>
    </form>
  );
}

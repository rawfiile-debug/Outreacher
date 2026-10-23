'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type C = { author_name: string; body: string; from_client: boolean; created_at: string };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

export function BriefConversation({ token, from, approvedAt, approvedBy, comments }: { token: string; from: string; approvedAt: string | null; approvedBy: string; comments: C[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function post(action: 'comment' | 'approve') {
    setError('');
    if (name.trim().length < (action === 'approve' ? 2 : 1)) { setError('Add your name first.'); return; }
    if (action === 'comment' && !body.trim()) { setError('Write a comment first.'); return; }
    if (action === 'approve' && !confirm('Sign off this brief? It tells ' + from + ' you are happy to go ahead with it.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/public/briefs/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, name: name.trim(), body: body.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || 'Could not send. Please try again.'); return; }
      setBody(''); router.refresh();
    } catch { setError('Could not reach the server. Please try again.'); }
    finally { setBusy(false); }
  }
  return (
    <section className="brief br-talk">
      <h2>Comments</h2>
      {comments.length ? <ul className="br-comments">{comments.map((c, i) => (
        <li key={i} className={c.from_client ? 'client' : 'owner'}><div className="small">{c.author_name} · {when(c.created_at)}</div><p>{c.body}</p></li>
      ))}</ul> : <p className="small">No comments yet. Ask a question or suggest a change below.</p>}
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="field"><label htmlFor="bc-name">Your name</label><input id="bc-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="bc-body">Comment</label><textarea id="bc-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      </div>
      <div className="inline-actions" style={{ marginTop: 10 }}>
        <button type="button" className="primary" disabled={busy} onClick={() => post('comment')}>Send comment</button>
        {approvedAt ? null : <button type="button" disabled={busy} onClick={() => post('approve')}>Sign off this brief</button>}
      </div>
      {approvedAt ? <div className="notice ok" style={{ marginTop: 12 }}>Signed off by {approvedBy} on {when(approvedAt)}.</div> : null}
    </section>
  );
}

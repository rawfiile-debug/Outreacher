'use client';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { makeShareToken } from '@/lib/share';
import { useToast } from './Toast';

/**
 * Creates, replaces or switches off a private share link. The link is only shown right after it is made (the
 * database keeps just its fingerprint), so replacing it is how you get a fresh one to send.
 */
export function SharePanel({ kind, id, sharedAt, path, what, onChange }: {
  kind: 'call_sheet' | 'brief'; id: string; sharedAt: string | null; path: 's' | 'b'; what: string; onChange: (sharedAt: string | null) => void;
}) {
  const toast = useToast();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  async function make() {
    if (sharedAt && !confirm('Make a new link? The old one stops working, so anyone who has it will need the new one.')) return;
    setBusy(true);
    try {
      const { token, hash } = await makeShareToken();
      const { data, error } = await createSupabaseBrowserClient().rpc('studio_set_share', { p_kind: kind, p_id: id, p_token_hash: hash });
      if (error) throw new Error(error.message);
      const url = `${window.location.origin}/${path}/${token}`;
      setLink(url); onChange(data as string);
      try { await navigator.clipboard.writeText(url); toast('Link created and copied'); } catch { toast('Link created'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create the link', 'error'); }
    finally { setBusy(false); }
  }
  async function off() {
    if (!confirm(`Switch off the link? Anyone who has it will no longer see this ${what}.`)) return;
    setBusy(true);
    try {
      const { error } = await createSupabaseBrowserClient().rpc('studio_set_share', { p_kind: kind, p_id: id, p_token_hash: null });
      if (error) throw new Error(error.message);
      setLink(''); onChange(null); toast('Link switched off');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not switch it off', 'error'); }
    finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <h2>Share</h2>
      {link ? (<>
        <p className="small">Send this to the people who need it. Anyone with the link can open this {what}{kind === 'brief' ? ', comment on it and sign it off' : ''}.</p>
        <div className="inline-actions"><input readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); toast('Link copied'); }}>Copy</button>
          <a className="btn" href={link} target="_blank" rel="noopener">Open</a></div>
      </>) : sharedAt ? (
        <p className="small">A link is switched on (made {new Date(sharedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })}). For security it is only shown when made; make a new one if you need to send it again.</p>
      ) : <p className="small">Not shared yet. Make a private link to send{kind === 'call_sheet' ? ' to the crew and talent' : ' to the client'}.</p>}
      <div className="inline-actions" style={{ marginTop: 10 }}>
        <button type="button" className={sharedAt ? '' : 'primary'} onClick={make} disabled={busy}>{sharedAt ? 'Make a new link' : 'Create share link'}</button>
        {sharedAt ? <button type="button" className="quiet danger" onClick={off} disabled={busy}>Switch off link</button> : null}
      </div>
    </div>
  );
}

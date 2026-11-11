'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { suggestAuto, when, type Activity, type Email, type Settings } from '@/lib/outreach';

type Data = { s: Settings | null; pending: Email[]; queued: Email[]; sentToday: number; replies: number; activity: Activity[] };
const WITH_CONTACT = '*, outreach_contacts(company, name, website, research, fit_score, category)';
const ICON: Record<string, string> = { found: '◎', sent: '✉', follow_up: '↺', replied: '★', opt_out: '⦸', bounce: '!', error: '!', info: 'i' };

function londonMidnight(): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  return new Date(`${d}T00:00:00`).toISOString();
}

export default function TodayPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });

  const { data, setData, error, reload } = useQuery<Data>(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [s, pending, queued, sent, replies, act] = await Promise.all([
      supabase.from('outreach_settings').select('*').maybeSingle(),
      supabase.from('outreach_emails').select(WITH_CONTACT).eq('status', 'pending').order('created_at').limit(50),
      supabase.from('outreach_emails').select(WITH_CONTACT).eq('status', 'approved').order('approved_at').limit(50),
      supabase.from('outreach_emails').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', londonMidnight()),
      supabase.from('outreach_activity').select('id', { count: 'exact', head: true }).eq('kind', 'replied').gte('created_at', weekAgo),
      supabase.from('outreach_activity').select('*').order('created_at', { ascending: false }).limit(25),
    ]);
    return { s: must(s) as Settings | null, pending: must(pending) as Email[], queued: must(queued) as Email[],
      sentToday: sent.count ?? 0, replies: replies.count ?? 0, activity: must(act) as Activity[] };
  }, []);

  useEffect(() => { // first visit: create the settings row (switched off)
    if (data && !data.s) supabase.from('outreach_settings').insert({}).select('*').single()
      .then(({ data: row }: { data: unknown }) => { if (row) setData({ ...data, s: row as Settings }); });
  }, [data, setData, supabase]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast(ok); setEditing(null); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(''); }
  }
  // Every change is limited to emails still in the expected state, so one already sending is never touched.
  async function change(e: Email, from: string, patch: Record<string, unknown>) {
    const rows = must(await supabase.from('outreach_emails').update(patch).eq('id', e.id).eq('status', from).select('id')) as { id: string }[];
    if (!rows.length) throw new Error('This email has already gone out, so it can no longer be changed.');
  }
  const approve = (e: Email) => run(e.id, () => change(e, 'pending', { status: 'approved', approved_at: new Date().toISOString(), ...(editing === e.id ? draft : {}) }), 'Approved. It goes out in the next sending slot.');
  const skip = (e: Email, from: string) => {
    if (!confirm(`Skip ${e.outreach_contacts?.company || e.to_email}? This email will not be sent.`)) return;
    run(e.id, async () => {
      await change(e, from, { status: 'skipped' });
      if (e.kind === 'first') await supabase.from('outreach_contacts').update({ stage: 'Not now' }).eq('id', e.contact_id);
    }, 'Skipped');
  };
  const saveEdit = (e: Email, from: string) => run(e.id, () => change(e, from, draft), 'Changes saved');
  const sendBack = (e: Email) => run(e.id, () => change(e, 'approved', { status: 'pending', approved_at: null }), 'Moved back to waiting');

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data?.s) return <div className="skeleton">Loading…</div>;
  const s = data.s;

  const card = (e: Email, from: 'pending' | 'approved') => {
    const c = e.outreach_contacts;
    const isEditing = editing === e.id;
    return (
      <div className="card" key={e.id}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{c?.company || e.to_email}</strong>
          <span className="small">{e.kind === 'follow_up' ? 'Follow-up' : `First email${c?.fit_score != null ? `, fit ${c.fit_score}/10` : ''}`}</span>
        </div>
        <div className="meta">To {e.to_email}{c?.website ? <> · <a href={c.website} target="_blank" rel="noreferrer">website</a></> : null}</div>
        {c?.research && from === 'pending' ? <div className="small">{c.research}</div> : null}
        {isEditing ? (
          <div className="form-grid" style={{ gridTemplateColumns: '1fr', margin: '10px 0' }}>
            <div className="field"><label>Subject</label><input value={draft.subject} onChange={(ev) => setDraft({ ...draft, subject: ev.target.value })} /></div>
            <div className="field"><label>Email</label><textarea rows={14} value={draft.body} onChange={(ev) => setDraft({ ...draft, body: ev.target.value })} /></div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 10 }}><span className="small">Subject:</span> {e.subject}</div>
            <div className="email-body">{e.body}</div>
          </>
        )}
        <div className="row">
          {from === 'pending' ? <button className="primary" disabled={!!busy} onClick={() => approve(e)}>{isEditing ? 'Save and approve' : 'Approve'}</button> : null}
          {isEditing
            ? <>{from === 'approved' ? <button className="primary" disabled={!!busy} onClick={() => saveEdit(e, from)}>Save</button> : null}<button className="quiet" onClick={() => setEditing(null)}>Cancel</button></>
            : <button disabled={!!busy} onClick={() => { setEditing(e.id); setDraft({ subject: e.subject, body: e.body }); }}>Edit</button>}
          {from === 'approved' ? <button className="quiet" disabled={!!busy} onClick={() => sendBack(e)}>Send back</button> : null}
          <button className="quiet danger" disabled={!!busy} onClick={() => skip(e, from)}>Skip</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader crumb="Outreach" title="Today" sub="Approve new emails, see what went out and who replied." />

      {!s.enabled ? <div className="notice warn">Autopilot is off, so nothing is being found or sent. <Link href="/settings">Switch it on in Settings</Link>.</div> : null}
      {s.last_error ? <div className="notice error">Last run had a problem: {s.last_error}</div> : null}
      {suggestAuto(s) ? <div className="notice ok">You have been approving each email for two weeks. Happy with them? <Link href="/settings">Switch to automatic sending</Link>.</div> : null}

      <div className="stats">
        <div className="stat"><div className="label">Waiting for you</div><div className="value">{data.pending.length}</div></div>
        <div className="stat"><div className="label">Queued to send</div><div className="value">{data.queued.length}</div></div>
        <div className="stat"><div className="label">Sent today</div><div className="value">{data.sentToday}<span className="small"> / 7</span></div></div>
        <div className="stat"><div className="label">Replies this week</div><div className="value">{data.replies}</div></div>
      </div>

      <section className="panel">
        <div className="section-head"><h2>Waiting for approval</h2><span className="small">{s.mode === 'auto' ? 'Automatic mode: new emails skip this step.' : 'Nothing sends until you approve it.'}</span></div>
        {data.pending.length ? data.pending.map((e) => card(e, 'pending')) : <div className="empty">Nothing waiting. New emails appear here after the morning run.</div>}
      </section>

      {data.queued.length ? (
        <section className="panel">
          <div className="section-head"><h2>Queued to send</h2><span className="small">Sent on weekdays, at most 7 a day. You can still change these.</span></div>
          {data.queued.map((e) => card(e, 'approved'))}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head"><h2>Activity</h2>{s.last_run_at ? <span className="small">Last run {when(s.last_run_at)}</span> : null}</div>
        {data.activity.length ? (
          <ul className="timeline">
            {data.activity.map((a) => <li key={a.id}><span aria-hidden>{ICON[a.kind] || '·'}</span> {a.message}<div className="when">{when(a.created_at)}</div></li>)}
          </ul>
        ) : <div className="empty">No activity yet.</div>}
      </section>
    </>
  );
}

'use client';
import { Suspense, useEffect, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { suggestAuto, type Settings } from '@/lib/autopilot/schedule';

type Email = { id: string; contact_id: string; kind: 'first' | 'follow_up'; status: string; to_email: string; subject: string; body: string; sent_at: string | null; created_at: string; approved_at: string | null; error: string;
  studio_contacts: { name: string; company: string; website: string; research: string; fit_score: number | null; category: string } | null };
type Activity = { id: number; kind: string; message: string; created_at: string };
type Suppression = { id: number; value: string; kind: string; reason: string; created_at: string };
type Data = { s: (Settings & { owner_id: string; last_tick_at: string | null; last_error: string }) | null;
  pending: Email[]; approved: Email[]; sentToday: number; activity: Activity[]; suppressions: Suppression[] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
const ICON: Record<string, string> = { found: '◎', sent: '✉', follow_up: '↺', replied: '★', opt_out: '⦸', bounce: '!', skipped: '–', error: '!', info: 'i' };

function AutopilotInner() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState('');
  const { data, setData, error, reload } = useQuery<Data>(async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [s, pending, approved, sent, act, sup] = await Promise.all([
      supabase.from('studio_autopilot').select('*').maybeSingle(),
      supabase.from('studio_emails').select('*, studio_contacts(name, company, website, research, fit_score, category)').eq('status', 'pending').order('created_at').limit(50),
      supabase.from('studio_emails').select('*, studio_contacts(name, company, website, research, fit_score, category)').eq('status', 'approved').order('approved_at').limit(50),
      supabase.from('studio_emails').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', today.toISOString()),
      supabase.from('studio_activity').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('studio_suppressions').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    return { s: must(s) as Data['s'], pending: must(pending) as Email[], approved: must(approved) as Email[],
      sentToday: sent.count ?? 0, activity: must(act) as Activity[], suppressions: must(sup) as Suppression[] };
  }, []);

  useEffect(() => { // first visit: create the settings row (switched off)
    if (data && !data.s) supabase.from('studio_autopilot').insert({}).select('*').single().then(({ data: row }: { data: unknown }) => { if (row) setData({ ...data, s: row as Data['s'] }); });
  }, [data, setData, supabase]);

  async function run(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try { await fn(); if (ok) toast(ok); await reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); } finally { setBusy(''); }
  }
  const save = (patch: Partial<Settings & { enabled: boolean }>, ok?: string) => run('settings', async () => {
    must(await supabase.from('studio_autopilot').update(patch).eq('owner_id', data!.s!.owner_id).select('owner_id').single());
  }, ok);

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data?.s) return <div className="skeleton">Loading…</div>;
  const s = data.s;

  async function setMode(mode: 'approve' | 'auto') {
    if (mode === 'auto' && !confirm(`Switch to automatic? New emails will send without asking you${data!.pending.length ? `, including the ${data!.pending.length} waiting now` : ''}. You can switch back at any time.`)) return;
    await run('mode', async () => {
      must(await supabase.from('studio_autopilot').update({ mode, approve_mode_since: mode === 'approve' ? new Date().toISOString() : s.approve_mode_since }).eq('owner_id', s.owner_id).select('owner_id').single());
      if (mode === 'auto' && data!.pending.length) must(await supabase.from('studio_emails').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('status', 'pending').select('id'));
    }, mode === 'auto' ? 'Automatic sending is on' : 'Back to approving each email');
  }
  const decide = (e: Email, status: 'approved' | 'skipped', edits?: { subject: string; body: string }) => run(e.id, async () => {
    must(await supabase.from('studio_emails').update({ status, ...(status === 'approved' ? { approved_at: new Date().toISOString() } : {}), ...(edits || {}) }).eq('id', e.id).select('id').single());
    if (status === 'skipped') await supabase.from('studio_contacts').update({ stage: 'Not now', notes: 'Skipped in the Autopilot queue.' }).eq('id', e.contact_id);
  }, status === 'approved' ? 'Approved. It will go out in the next sending slot.' : 'Skipped');

  // Queued (approved) emails can still be changed until the scheduled run picks them up. Every update is
  // limited to rows that are still 'approved', so an email that is being sent or has gone out is never touched.
  const GONE = 'This email is already being sent or has gone out, so it can no longer be changed.';
  const changeQueued = (e: Email, patch: Record<string, unknown>, ok: string) => run(e.id, async () => {
    const rows = must(await supabase.from('studio_emails').update(patch).eq('id', e.id).eq('status', 'approved').select('id')) as { id: string }[];
    if (!rows.length) throw new Error(GONE);
    if (patch.status === 'skipped' && e.kind === 'first') await supabase.from('studio_contacts').update({ stage: 'Not now', notes: 'Removed from the Autopilot queue.' }).eq('id', e.contact_id);
  }, ok);
  const saveQueued = (e: Email, edits: { subject: string; body: string }) => changeQueued(e, edits, 'Changes saved. It is still queued to send.');
  const unqueue = (e: Email) => changeQueued(e, { status: 'pending', approved_at: null }, 'Moved back to Approve emails');
  const removeQueued = (e: Email) => {
    if (confirm(`Remove the email to ${e.studio_contacts?.company || e.to_email} from the queue? It will not be sent.`))
      changeQueued(e, { status: 'skipped' }, 'Removed from the queue');
  };

  return (
    <>
      <PageHeader crumb="AUTOPILOT" title="Autopilot" sub="Finds London businesses that need photos and video, writes to them, follows up once, and stops when they reply." />

      <div className="panel">
        <h2>How it runs</h2>
        <p className="small">Claude does the work as a scheduled task on your existing plan: no API keys and nothing extra to pay for. Every weekday at about 06:40 it checks rawfiile@gmail.com for replies, sends the emails you have approved and any follow-ups that are due, and finds new businesses for you to approve. At about 13:40 it checks replies again and sends anything you approved since the morning. Emails go from rawfiile@gmail.com, at most 7 a day in total.</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Status</div><div className="value" style={{ fontSize: 22 }}>{s.enabled ? (s.mode === 'auto' ? 'Automatic' : 'Approving') : 'Off'}</div>
          <div className="hint">{s.last_tick_at ? `Last run ${when(s.last_tick_at)}` : 'Not run yet'}</div></div>
        <div className="stat"><div className="label">Waiting for you</div><div className="value">{data.pending.length}</div><div className="hint">first emails to approve</div></div>
        <div className="stat"><div className="label">Queued to send</div><div className="value">{data.approved.length}</div><div className="hint">sent at the next run</div></div>
        <div className="stat"><div className="label">Sent today</div><div className="value">{data.sentToday}</div><div className="hint">7 a day at most</div></div>
      </div>
      {s.last_error ? <div className="notice error">Last run stopped: {s.last_error}</div> : null}
      {suggestAuto(s, new Date()) ? (
        <div className="notice ok">You have been approving emails for two weeks. If you are happy with them, switch to automatic so they send without you. <button type="button" onClick={() => setMode('auto')}>Switch to automatic</button></div>
      ) : null}

      <div className="two-col">
        <div>
          <div className="panel">
            <div className="section-head"><div><h2>Approve emails</h2><p className="sub">{s.mode === 'auto' ? 'Automatic mode: new emails send without waiting here.' : 'Read, edit if you like, then approve. Approved emails go out at the next run (about 06:40 or 13:40 on weekdays).'}</p></div>
              {data.pending.length > 1 ? <button type="button" className="primary" disabled={!!busy} onClick={() => {
                if (confirm(`Approve all ${data.pending.length} emails as written?`)) run('all', async () => { must(await supabase.from('studio_emails').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('status', 'pending').select('id')); }, 'All approved');
              }}>Approve all ({data.pending.length})</button> : null}</div>
            {data.pending.length ? data.pending.map((e) => <QueueItem key={e.id} e={e} busy={busy === e.id} onApprove={(ed) => decide(e, 'approved', ed)} onSkip={() => decide(e, 'skipped')} />)
              : <p className="small">{s.enabled ? 'Nothing waiting. New businesses appear here after each morning run.' : 'Switch Autopilot on to start finding businesses.'}</p>}
          </div>
          <div className="panel">
            <h2>Queued to send</h2>
            <p className="sub">Approved emails waiting for the next run. Open one to read it, change it, move it back to approval or take it out of the queue.</p>
            {data.approved.length ? data.approved.map((e) => <QueuedItem key={e.id} e={e} busy={busy === e.id}
              onSave={(ed) => saveQueued(e, ed)} onUnqueue={() => unqueue(e)} onRemove={() => removeQueued(e)} />)
              : <p className="small">Nothing queued.</p>}
          </div>
          <div className="panel">
            <h2>Activity</h2>
            {data.activity.length ? <ul className="activity">{data.activity.map((a) => (
              <li key={a.id} className={`act-${a.kind}`}><span className="act-ico" aria-hidden>{ICON[a.kind] || '·'}</span><div><div>{a.message}</div><div className="small">{when(a.created_at)}</div></div></li>
            ))}</ul> : <p className="small">Nothing yet.</p>}
          </div>
        </div>
        <div>
          <div className="panel">
            <h2>Autopilot</h2>
            <label className="check big"><input type="checkbox" checked={s.enabled} disabled={!!busy}
              onChange={(e) => save({ enabled: e.target.checked, ...(e.target.checked && !s.approve_mode_since ? { approve_mode_since: new Date().toISOString() } : {}) }, e.target.checked ? 'Autopilot is on' : 'Autopilot is off')} /> Autopilot on</label>
            <div className="seg" role="group" aria-label="Mode" style={{ marginTop: 12 }}>
              <button type="button" className={s.mode === 'approve' ? 'on' : ''} onClick={() => s.mode !== 'approve' && setMode('approve')}>Approve each email</button>
              <button type="button" className={s.mode === 'auto' ? 'on' : ''} onClick={() => s.mode !== 'auto' && setMode('auto')}>Automatic</button>
            </div>
            <p className="small" style={{ marginTop: 8 }}>Follow-ups always send on their own, {s.follow_up_days} days after the first email, unless the person has replied.</p>
            <p className="small">Sending from <strong>rawfiile@gmail.com</strong>.</p>
          </div>
          <SettingsForm s={s} busy={busy === 'settings'} onSave={(p) => save(p, 'Settings saved')} />
          <DoNotContact list={data.suppressions} onChange={reload} />
        </div>
      </div>
    </>
  );
}

function QueueItem({ e, busy, onApprove, onSkip }: { e: Email; busy: boolean; onApprove: (edits?: { subject: string; body: string }) => void; onSkip: () => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(e.subject);
  const [body, setBody] = useState(e.body);
  const c = e.studio_contacts;
  const changed = subject !== e.subject || body !== e.body;
  return (
    <div className="queue-item">
      <div className="qi-head">
        <div><strong>{c?.company || e.to_email}</strong>{c?.name ? ` · ${c.name}` : ''}
          <div className="small">{e.to_email}{c?.website ? <> · <a href={c.website} target="_blank" rel="noopener noreferrer">website ↗</a></> : null}{c?.fit_score != null ? ` · fit ${c.fit_score}/10` : ''}{c?.category ? ` · ${c.category}` : ''}</div></div>
      </div>
      {c?.research ? <p className="small qi-why">{c.research}</p> : null}
      {editing ? (<>
        <div className="field"><label>Subject</label><input value={subject} onChange={(ev) => setSubject(ev.target.value)} maxLength={200} /></div>
        <div className="field" style={{ marginTop: 8 }}><label>Email</label><textarea rows={12} value={body} onChange={(ev) => setBody(ev.target.value)} /></div>
      </>) : (
        <div className="qi-email"><div className="qi-subject">{subject}</div><pre>{body}</pre></div>
      )}
      <div className="inline-actions" style={{ marginTop: 10 }}>
        <button type="button" className="primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => onApprove(changed ? { subject: subject.trim(), body: body.trim() } : undefined)}>{busy ? <span className="spinner" /> : null} Approve{changed ? ' with edits' : ''}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</button>
        <button type="button" className="quiet" disabled={busy} onClick={onSkip}>Skip this business</button>
      </div>
    </div>
  );
}

function QueuedItem({ e, busy, onSave, onUnqueue, onRemove }: { e: Email; busy: boolean; onSave: (edits: { subject: string; body: string }) => void; onUnqueue: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(e.subject);
  const [body, setBody] = useState(e.body);
  const c = e.studio_contacts;
  useEffect(() => { setEditing(false); setSubject(e.subject); setBody(e.body); }, [e.subject, e.body]); // saved: show the stored version
  const changed = subject.trim() !== e.subject || body.trim() !== e.body;
  return (
    <div className="queue-item">
      <div className="qi-head">
        <div><strong>{c?.company || e.to_email}</strong>{c?.name ? ` · ${c.name}` : ''}
          <div className="small">{e.kind === 'follow_up' ? 'Follow-up' : 'First email'} · {e.to_email}{e.approved_at ? ` · approved ${when(e.approved_at)}` : ''}</div>
          {!open ? <div className="small qi-subject" style={{ marginTop: 4 }}>{e.subject}</div> : null}</div>
        <button type="button" className="quiet" onClick={() => { setOpen(!open); setEditing(false); setSubject(e.subject); setBody(e.body); }} aria-expanded={open}>{open ? 'Hide' : 'View'}</button>
      </div>
      {open ? (<>
        {c?.research ? <p className="small qi-why">{c.research}</p> : null}
        {editing ? (<>
          <div className="field"><label>Subject</label><input value={subject} onChange={(ev) => setSubject(ev.target.value)} maxLength={200} /></div>
          <div className="field" style={{ marginTop: 8 }}><label>Email</label><textarea rows={14} value={body} onChange={(ev) => setBody(ev.target.value)} maxLength={5000} /></div>
        </>) : (
          <div className="qi-email"><div className="qi-subject">{e.subject}</div><pre>{e.body}</pre></div>
        )}
        <div className="inline-actions" style={{ marginTop: 10 }}>
          {editing ? (<>
            <button type="button" className="primary" disabled={busy || !changed || !subject.trim() || !body.trim()} onClick={() => onSave({ subject: subject.trim(), body: body.trim() })}>{busy ? <span className="spinner" /> : null} Save changes</button>
            <button type="button" disabled={busy} onClick={() => { setEditing(false); setSubject(e.subject); setBody(e.body); }}>Cancel</button>
          </>) : <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
          {e.kind === 'first' ? <button type="button" disabled={busy} onClick={onUnqueue}>Back to approval</button> : null}
          <button type="button" className="quiet" disabled={busy} onClick={onRemove}>Remove from queue</button>
        </div>
      </>) : null}
    </div>
  );
}

function SettingsForm({ s, busy, onSave }: { s: Settings; busy: boolean; onSave: (p: Partial<Settings>) => void }) {
  const [f, setF] = useState(() => ({ ...s, targetsText: s.targets.join('\n') }));
  useEffect(() => { setF({ ...s, targetsText: s.targets.join('\n') }); }, [s]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const targets = f.targetsText.split('\n').map((t) => t.trim()).filter(Boolean);
  return (
    <div className="panel">
      <h2>Settings</h2>
      <div className="form-grid">
        <div className="field full"><label htmlFor="ap-targets">Who to look for (one search per line)</label>
          <textarea id="ap-targets" rows={5} value={f.targetsText} onChange={(e) => set('targetsText', e.target.value)} />
          <span className="hint">Written like a web search, e.g. &ldquo;streetwear brands in East London&rdquo;. Each is worked through ten pages deep.</span></div>
        <div className="field"><label htmlFor="ap-limit">New businesses a day</label><input id="ap-limit" type="number" min={1} max={7} value={f.daily_new_limit} onChange={(e) => set('daily_new_limit', Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />
          <span className="hint">Up to 7. Follow-ups count towards the 7-a-day total, so new emails make way for them.</span></div>
        <div className="field"><label htmlFor="ap-fu">Follow up after (days)</label><input id="ap-fu" type="number" min={3} max={60} value={f.follow_up_days} onChange={(e) => set('follow_up_days', Number(e.target.value))} /></div>
        <div className="field full"><label>Days</label><div className="seg small-seg">{DAYS.map((d, i) => (
          <button key={d} type="button" className={f.send_days.includes(i) ? 'on' : ''} onClick={() => set('send_days', f.send_days.includes(i) ? f.send_days.filter((x) => x !== i) : [...f.send_days, i].sort())}>{d}</button>))}</div></div>
        <div className="field"><label htmlFor="ap-fit">Lowest fit to contact (0 to 10)</label><input id="ap-fit" type="number" min={0} max={10} value={f.min_fit} onChange={(e) => set('min_fit', Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="ap-name">Sign emails as</label><input id="ap-name" value={f.sender_name} onChange={(e) => set('sender_name', e.target.value)} /></div>
        <div className="field full"><label htmlFor="ap-work">My work to mention (one project per line)</label>
          <textarea id="ap-work" rows={7} value={f.work_library} onChange={(e) => set('work_library', e.target.value)} />
          <span className="hint">Autopilot mentions the one closest to each business. Only list finished work you are happy to be asked about.</span></div>
        <div className="field full"><label htmlFor="ap-url">Portfolio link</label><input id="ap-url" value={f.portfolio_url} onChange={(e) => set('portfolio_url', e.target.value)} /></div>
        <label className="check full"><input type="checkbox" checked={f.require_companies_house} onChange={(e) => set('require_companies_house', e.target.checked)} /> Only contact businesses found on Companies House (limited companies)</label>
      </div>
      <button type="button" className="primary" style={{ marginTop: 12 }} disabled={busy || !targets.length || !f.send_days.length || !/^https:\/\//.test(f.portfolio_url)}
        onClick={() => onSave({ targets, daily_new_limit: f.daily_new_limit, follow_up_days: f.follow_up_days, window_start: f.window_start, window_end: f.window_end,
          send_days: f.send_days, min_fit: f.min_fit, sender_name: f.sender_name.trim() || 'Michael Clavier', portfolio_url: f.portfolio_url.trim(), work_library: f.work_library.trim(), require_companies_house: f.require_companies_house })}>Save settings</button>
    </div>
  );
}

function DoNotContact({ list, onChange }: { list: Suppression[]; onChange: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const supabase = createSupabaseBrowserClient();
  async function add() {
    const v = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const kind = v.includes('@') ? 'email' : 'domain';
    if (!/^[^\s@]+(@[^\s@]+)?\.[a-z]{2,}$/.test(v)) { toast('Enter an email address or a website like example.co.uk', 'error'); return; }
    const { error } = await supabase.from('studio_suppressions').insert({ value: v, kind, reason: 'manual' });
    if (error && error.code !== '23505') { toast(error.message, 'error'); return; }
    setValue(''); onChange(); toast('Added to the do-not-contact list');
  }
  const label: Record<string, string> = { manual: 'added by you', opt_out: 'asked not to be contacted', bounce: 'bounced', replied_no: 'declined' };
  return (
    <div className="panel">
      <h2>Do not contact</h2>
      <p className="small">Never emailed, whatever the search finds. Opt-outs and bounces are added on their own.</p>
      <div className="inline-actions"><input className="filter" style={{ flex: 1 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@company.com or company.com" />
        <button type="button" onClick={add} disabled={!value.trim()}>Add</button></div>
      {list.length ? <ul className="dnc">{list.map((s) => (
        <li key={s.id}><span>{s.value} <span className="small">· {label[s.reason] || s.reason}</span></span>
          {s.reason === 'manual' ? <button type="button" className="quiet" aria-label={`Remove ${s.value}`} onClick={async () => { await supabase.from('studio_suppressions').delete().eq('id', s.id); onChange(); }}>✕</button> : null}</li>
      ))}</ul> : null}
    </div>
  );
}

export default function AutopilotPage() {
  return <Suspense fallback={<div className="skeleton">Loading…</div>}><AutopilotInner /></Suspense>;
}

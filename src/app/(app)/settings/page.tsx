'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { linesToList, parseSuppression, suggestAuto, when, type Settings, type Suppression } from '@/lib/outreach';

type Data = { s: Settings | null; sup: Suppression[] };
const REASON: Record<string, string> = { manual: 'added by you', opt_out: 'said no thanks', bounce: 'bounced' };

export default function SettingsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ daily_new_limit: 5, follow_up_days: 14, min_fit: 6, targets: '', work_library: '' });
  const [block, setBlock] = useState('');

  const { data, setData, error, reload } = useQuery<Data>(async () => {
    const [s, sup] = await Promise.all([
      supabase.from('outreach_settings').select('*').maybeSingle(),
      supabase.from('outreach_suppressions').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    return { s: must(s) as Settings | null, sup: must(sup) as Suppression[] };
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!data.s) {
      supabase.from('outreach_settings').insert({}).select('*').single()
        .then(({ data: row }: { data: unknown }) => { if (row) setData({ ...data, s: row as Settings }); });
      return;
    }
    const s = data.s;
    setForm({ daily_new_limit: s.daily_new_limit, follow_up_days: s.follow_up_days, min_fit: s.min_fit, targets: s.targets.join('\n'), work_library: s.work_library });
  }, [data, setData, supabase]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast(ok); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(false); }
  }
  const update = async (patch: Partial<Settings>) => must(await supabase.from('outreach_settings').update(patch).eq('owner_id', data!.s!.owner_id).select('owner_id').single());

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data?.s) return <div className="skeleton">Loading…</div>;
  const s = data.s;

  async function setMode(mode: 'approve' | 'auto') {
    if (mode === s.mode) return;
    if (mode === 'auto' && !confirm('Switch to automatic? New first emails will send without asking you, including any waiting now. You can switch back at any time.')) return;
    await act(async () => {
      must(await supabase.from('outreach_settings').update({ mode, approve_mode_since: mode === 'approve' ? new Date().toISOString() : s.approve_mode_since }).eq('owner_id', s.owner_id).select('owner_id').single());
      if (mode === 'auto') must(await supabase.from('outreach_emails').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('status', 'pending').select('id'));
    }, mode === 'auto' ? 'Automatic sending is on' : 'Back to approving each email');
  }
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    const targets = linesToList(form.targets);
    if (!targets.length) { toast('Add at least one search target', 'error'); return; }
    act(async () => { await update({ daily_new_limit: form.daily_new_limit, follow_up_days: form.follow_up_days, min_fit: form.min_fit, targets, work_library: form.work_library.trim() }); }, 'Settings saved');
  };
  const addBlock = (ev: React.FormEvent) => {
    ev.preventDefault();
    const entry = parseSuppression(block);
    if (!entry) { toast('Enter an email address or a domain like brand.com', 'error'); return; }
    act(async () => { must(await supabase.from('outreach_suppressions').insert({ ...entry, reason: 'manual' }).select('id')); setBlock(''); }, 'Added to do not contact');
  };
  const unblock = (x: Suppression) => {
    if (!confirm(`Allow ${x.value} to be emailed again?`)) return;
    act(async () => { must(await supabase.from('outreach_suppressions').delete().eq('id', x.id).select('id')); }, 'Removed');
  };
  const num = (k: 'daily_new_limit' | 'follow_up_days' | 'min_fit') => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <>
      <PageHeader crumb="Outreach" title="Settings" sub={s.last_run_at ? `Autopilot last ran ${when(s.last_run_at)}.` : 'Autopilot has not run yet.'} />

      <section className="panel">
        <div className="section-head">
          <div><h2>Autopilot</h2><p className="sub">Runs on weekdays at about 06:40 and 13:40 from rawfiile@gmail.com. At most 7 emails a day.</p></div>
          <label className="check"><input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => act(() => update({ enabled: e.target.checked }), e.target.checked ? 'Autopilot is on' : 'Autopilot is off')} /> {s.enabled ? 'On' : 'Off'}</label>
        </div>
        <div className="segmented" role="group" aria-label="Sending mode">
          <button className={s.mode === 'approve' ? 'on' : ''} disabled={busy} onClick={() => setMode('approve')}>Approve each email</button>
          <button className={s.mode === 'auto' ? 'on' : ''} disabled={busy} onClick={() => setMode('auto')}>Automatic</button>
        </div>
        <p className="small" style={{ marginTop: 10 }}>
          {s.mode === 'approve' ? 'New first emails wait on the Today page until you approve them. Follow-ups send on their own.' : 'Everything sends without asking. Replies, opt-outs and bounces still stop it straight away.'}
          {suggestAuto(s) ? ' You have been approving for two weeks: you may be ready for automatic.' : ''}
        </p>
      </section>

      <form className="panel" onSubmit={save}>
        <div className="section-head"><h2>What to look for</h2></div>
        <div className="form-grid">
          <div className="field"><label>New businesses a day</label><input type="number" min={1} max={7} value={form.daily_new_limit} onChange={num('daily_new_limit')} /></div>
          <div className="field"><label>Follow up after (days)</label><input type="number" min={3} max={60} value={form.follow_up_days} onChange={num('follow_up_days')} /><span className="hint">One follow-up, in the same thread, then it stops.</span></div>
          <div className="field"><label>Lowest fit to email (0 to 10)</label><input type="number" min={0} max={10} value={form.min_fit} onChange={num('min_fit')} /></div>
          <div className="field full"><label>Search targets, one per line</label><textarea rows={7} value={form.targets} onChange={(e) => setForm({ ...form, targets: e.target.value })} /><span className="hint">Start a line with &quot;dream brand:&quot; (for example &quot;dream brand: Wingstop UK&quot;) to reach a big brand through the agency behind its latest campaign.</span></div>
          <div className="field full"><label>My work to mention</label><textarea rows={6} value={form.work_library} onChange={(e) => setForm({ ...form, work_library: e.target.value })} /><span className="hint">Your own projects, one per line. Emails only mention work listed here.</span></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}><button className="primary" disabled={busy}>Save</button></div>
      </form>

      <section className="panel">
        <div className="section-head"><div><h2>Do not contact</h2><p className="sub">Never emailed, checked before every send. Opt-outs and bounces are added automatically.</p></div></div>
        <form className="row" onSubmit={addBlock} style={{ marginBottom: 14 }}>
          <input className="filter" style={{ maxWidth: 300 }} placeholder="name@brand.com or brand.com" value={block} onChange={(e) => setBlock(e.target.value)} />
          <button disabled={busy}>Add</button>
        </form>
        {data.sup.length ? (
          <ul className="timeline">
            {data.sup.map((x) => <li key={x.id} className="row" style={{ justifyContent: 'space-between' }}><span>{x.value} <span className="small">({REASON[x.reason] || x.reason})</span></span><button className="quiet" disabled={busy} onClick={() => unblock(x)}>Remove</button></li>)}
          </ul>
        ) : <div className="empty">Nobody on the list yet.</div>}
      </section>
    </>
  );
}

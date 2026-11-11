'use client';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { MultiSelect } from '@/components/MultiSelect';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  GIG_LOCATIONS, GIG_MIN_BUDGETS, GIG_PAY, GIG_SOURCES, GIG_STATUSES, GIG_WORK_TYPES, labelOf, when, type Gig,
} from '@/lib/outreach';

type Prefs = { gigs_enabled: boolean; gig_work_types: string[]; gig_pay: string[]; gig_locations: string[]; gig_sources: string[]; gig_min_budget: number; gig_alert_fit: number };
type Data = { prefs: (Prefs & { owner_id: string; gigs_checked_at: string | null }) | null; gigs: Gig[] };
const COLS = 'owner_id, gigs_enabled, gig_work_types, gig_pay, gig_locations, gig_sources, gig_min_budget, gig_alert_fit, gigs_checked_at';

export default function GigsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [tab, setTab] = useState('new');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { data, error, reload } = useQuery<Data>(async () => {
    const [s, g] = await Promise.all([
      supabase.from('outreach_settings').select(COLS).maybeSingle(),
      supabase.from('outreach_gigs').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    return { prefs: must(s) as Data['prefs'], gigs: must(g) as Gig[] };
  }, []);
  useEffect(() => {
    if (!data?.prefs) return;
    const p = data.prefs;
    setPrefs({ gigs_enabled: p.gigs_enabled, gig_work_types: p.gig_work_types, gig_pay: p.gig_pay, gig_locations: p.gig_locations, gig_sources: p.gig_sources, gig_min_budget: p.gig_min_budget, gig_alert_fit: p.gig_alert_fit });
  }, [data]);

  const groups = useMemo(() => {
    const all = data?.gigs || [];
    return Object.fromEntries(GIG_STATUSES.map((s) => [s.value, all.filter((g) => g.status === s.value)])) as Record<string, Gig[]>;
  }, [data]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast(ok); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(false); }
  }
  const savePrefs = (patch?: Partial<Prefs>) => act(async () => {
    const next = { ...prefs!, ...patch };
    if (!next.gig_work_types.length || !next.gig_pay.length || !next.gig_locations.length || !next.gig_sources.length) throw new Error('Pick at least one option in each box.');
    must(await supabase.from('outreach_settings').update(next).eq('owner_id', data!.prefs!.owner_id).select('owner_id').single());
  }, patch && 'gigs_enabled' in patch ? (patch.gigs_enabled ? 'Gig alerts are on' : 'Gig alerts are off') : 'Saved. The next hourly run uses these.');
  const setStatus = (g: Gig, status: string) => act(async () => { must(await supabase.from('outreach_gigs').update({ status }).eq('id', g.id).select('id').single()); }, `Marked ${labelOf(GIG_STATUSES, status).toLowerCase()}`);
  const copyReply = async (g: Gig) => { try { await navigator.clipboard.writeText(g.reply); toast('Reply copied'); } catch { toast('Could not copy. Select the text instead.', 'error'); } };

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data) return <div className="skeleton">Loading…</div>;
  if (!data.prefs || !prefs) return <div className="notice">Open Settings once to set Outreacher up, then come back.</div>;
  const set = (k: keyof Prefs) => (v: string[]) => setPrefs({ ...prefs, [k]: v });
  const list = groups[tab] || [];

  return (
    <>
      <PageHeader crumb="Outreach" title="Gigs" sub="People looking for a photographer or videographer. Checked every hour, 8am to 8pm. Strong matches come as a push notification." />

      <section className="panel">
        <div className="section-head">
          <div><h2>What I&apos;m looking for</h2><p className="sub">{data.prefs.gigs_checked_at ? `Last checked ${when(data.prefs.gigs_checked_at)}.` : 'Not checked yet.'}</p></div>
          <label className="check"><input type="checkbox" checked={prefs.gigs_enabled} disabled={busy} onChange={(e) => savePrefs({ gigs_enabled: e.target.checked })} /> Alerts {prefs.gigs_enabled ? 'on' : 'off'}</label>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <MultiSelect label="Type of work" options={GIG_WORK_TYPES} value={prefs.gig_work_types} onChange={set('gig_work_types')} />
          <MultiSelect label="Pay" options={GIG_PAY} value={prefs.gig_pay} onChange={set('gig_pay')} />
          <MultiSelect label="Location" options={GIG_LOCATIONS} value={prefs.gig_locations} onChange={set('gig_locations')} />
          <MultiSelect label="Where to look" options={GIG_SOURCES} value={prefs.gig_sources} onChange={set('gig_sources')} />
          <div className="field"><label>Minimum budget (when stated)</label>
            <select value={String(prefs.gig_min_budget)} onChange={(e) => setPrefs({ ...prefs, gig_min_budget: Number(e.target.value) })}>
              {GIG_MIN_BUDGETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
          <div className="field"><label>Notify me when the fit is at least</label>
            <select value={String(prefs.gig_alert_fit)} onChange={(e) => setPrefs({ ...prefs, gig_alert_fit: Number(e.target.value) })}>
              {[5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n} out of 10</option>)}
            </select></div>
        </div>
        <p className="small" style={{ marginTop: 10 }}>LinkedIn, Facebook and Instagram are only searched where posts are public, so private groups are missed.</p>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" disabled={busy} onClick={() => savePrefs()}>Save</button></div>
      </section>

      <section className="panel">
        <div className="tabs">{GIG_STATUSES.map((t) => <button key={t.value} className={tab === t.value ? 'on' : ''} onClick={() => setTab(t.value)}>{t.label} ({groups[t.value].length})</button>)}</div>
        {list.length ? list.map((g) => (
          <div key={g.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{g.title}</strong>
              {g.fit_score != null ? <span className={`status ${g.fit_score >= 7 ? 'ok' : g.fit_score >= 5 ? 'warn' : ''}`}>Fit {g.fit_score}/10</span> : null}
            </div>
            <div className="meta">{[g.source, g.poster, g.location, g.pay, g.posted_at ? `posted ${new Date(g.posted_at + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '', `found ${when(g.created_at)}`].filter(Boolean).join(' · ')}</div>
            <p style={{ margin: '0 0 8px' }}>{g.needed}</p>
            {g.how_to_apply ? <p className="small">How to respond: {g.how_to_apply}</p> : null}
            {open === g.id ? (
              <>
                {g.fit_reason ? <p className="small">{g.fit_reason}</p> : null}
                {g.reply ? <div className="email-body">{g.reply}</div> : null}
              </>
            ) : null}
            <div className="row">
              <a className="btn primary" href={g.url} target="_blank" rel="noreferrer">Open post</a>
              {g.reply ? <button onClick={() => copyReply(g)}>Copy reply</button> : null}
              <button className="quiet" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? 'Hide' : 'Show reply'}</button>
              <select className="filter" style={{ width: 'auto', marginLeft: 'auto' }} value={g.status} disabled={busy} onChange={(e) => setStatus(g, e.target.value)}>
                {GIG_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
        )) : <div className="empty">{data.gigs.length ? 'Nothing here.' : 'No gigs found yet. The hourly run checks from 8am to 8pm.'}</div>}
      </section>
    </>
  );
}

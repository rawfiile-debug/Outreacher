'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { MultiSelect } from '@/components/MultiSelect';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { runNow } from '@/lib/run';
import {
  ELIGIBILITY, GRANT_FOCUS, GRANT_LOCATIONS, GRANT_MIN_AMOUNTS, GRANT_STAGES, GRANT_STATUSES, GRANT_TYPES,
  daysUntil, deadlineLabel, labelOf, when, type Grant, type Job,
} from '@/lib/outreach';

type Prefs = { grant_types: string[]; grant_focus: string[]; grant_locations: string[]; grant_stages: string[]; grant_min_amount: number };
type Data = { prefs: (Prefs & { owner_id: string; grants_searched_at: string | null }) | null; grants: Grant[]; job: Job | null; profileReady: boolean };
const TABS = [
  { key: 'eligible', label: 'Eligible' }, { key: 'check', label: 'To check' }, { key: 'applying', label: 'Applying' },
  { key: 'done', label: 'Submitted and decided' }, { key: 'not', label: 'Not eligible or not for me' },
];
const isOpen = (g: Grant) => !g.deadline || daysUntil(g.deadline) >= 0;

export default function GrantsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [tab, setTab] = useState('eligible');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useQuery<Data>(async () => {
    const [s, g, job, p] = await Promise.all([
      supabase.from('outreach_settings').select('owner_id, grant_types, grant_focus, grant_locations, grant_stages, grant_min_amount, grants_searched_at').maybeSingle(),
      supabase.from('outreach_grants').select('*').order('deadline', { ascending: true, nullsFirst: false }).limit(500),
      supabase.from('outreach_jobs').select('*').eq('kind', 'find_grants').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('outreach_profile').select('summary').maybeSingle(),
    ]);
    const prof = must(p) as { summary: string } | null;
    return { prefs: must(s) as Data['prefs'], grants: must(g) as Grant[], job: must(job) as Job | null, profileReady: Boolean(prof?.summary) };
  }, []);
  useEffect(() => { if (data?.prefs) { const { owner_id: _o, grants_searched_at: _g, ...rest } = data.prefs; void _o; void _g; setPrefs(rest); } }, [data]);

  const groups = useMemo(() => {
    const all = data?.grants || [];
    return {
      eligible: all.filter((g) => g.status === 'new' && g.eligibility === 'eligible' && isOpen(g)),
      check: all.filter((g) => g.status === 'new' && g.eligibility === 'check' && isOpen(g)),
      applying: all.filter((g) => g.status === 'applying'),
      done: all.filter((g) => ['submitted', 'won', 'rejected'].includes(g.status)),
      not: all.filter((g) => g.status === 'dismissed' || (g.status === 'new' && (g.eligibility === 'not_eligible' || !isOpen(g)))),
    } as Record<string, Grant[]>;
  }, [data]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(false); }
  }
  const queueSearch = async () => {
    const res = await supabase.from('outreach_jobs').insert({ kind: 'find_grants' }).select('id');
    if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
    toast((await runNow('find_grants')).message);
  };
  const savePrefs = () => act(async () => {
    if (!prefs!.grant_types.length || !prefs!.grant_focus.length || !prefs!.grant_locations.length) throw new Error('Pick at least one option in each box.');
    must(await supabase.from('outreach_settings').update(prefs!).eq('owner_id', data!.prefs!.owner_id).select('owner_id').single());
    await queueSearch();
  }, '');

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data) return <div className="skeleton">Loading…</div>;
  if (!data.prefs || !prefs) return <div className="notice">Open Settings once to set Outreacher up, then come back.</div>;
  const searching = data.job && (data.job.status === 'queued' || data.job.status === 'running');
  const set = (k: keyof Prefs) => (v: string[]) => setPrefs({ ...prefs, [k]: v });
  const list = groups[tab] || [];

  return (
    <>
      <PageHeader crumb="Outreach" title="Grants" sub="Searches start when you press Search now or Save and search." />

      {!data.profileReady ? <div className="notice warn">Eligibility is judged from your profile. <Link href="/profile">Build your profile summary</Link> first for the best results.</div> : null}

      <section className="panel">
        <div className="section-head"><div><h2>What I want from a grant</h2>
          <p className="sub">{data.prefs.grants_searched_at ? `Last searched ${when(data.prefs.grants_searched_at)}.` : 'Not searched yet.'}{searching ? ' Claude is searching now.' : ''}</p></div></div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <MultiSelect label="Type of support" options={GRANT_TYPES} value={prefs.grant_types} onChange={set('grant_types')} />
          <MultiSelect label="Focus" options={GRANT_FOCUS} value={prefs.grant_focus} onChange={set('grant_focus')} />
          <MultiSelect label="Location" options={GRANT_LOCATIONS} value={prefs.grant_locations} onChange={set('grant_locations')} />
          <MultiSelect label="Career stage" options={GRANT_STAGES} value={prefs.grant_stages} onChange={set('grant_stages')} />
          <div className="field"><label>Minimum amount</label>
            <select value={String(prefs.grant_min_amount)} onChange={(e) => setPrefs({ ...prefs, grant_min_amount: Number(e.target.value) })}>
              {GRANT_MIN_AMOUNTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={busy} onClick={savePrefs}>Save and search</button>
          <button disabled={busy || Boolean(searching)} onClick={() => act(queueSearch, '')}>Search now</button>
        </div>
      </section>

      <div className="stats">
        <div className="stat"><div className="label">Eligible and open</div><div className="value">{groups.eligible.length}<span className="small"> / 5</span></div></div>
        <div className="stat"><div className="label">To check</div><div className="value">{groups.check.length}</div></div>
        <div className="stat"><div className="label">Applying</div><div className="value">{groups.applying.length}</div></div>
        <div className="stat"><div className="label">Submitted</div><div className="value">{groups.done.length}</div></div>
      </div>

      <section className="panel">
        <div className="tabs">{TABS.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label} ({groups[t.key].length})</button>)}</div>
        {list.length ? list.map((g) => (
          <Link key={g.id} href={`/grants/${g.id}`} className="grant-row">
            <div>
              <strong>{g.title}</strong>
              <div className="small">{[g.funder, labelOf(GRANT_TYPES, g.grant_type), g.amount, g.location].filter(Boolean).join(' · ')}</div>
              {g.eligibility_reason ? <div className="small" style={{ marginTop: 4 }}>{g.eligibility_reason.slice(0, 220)}{g.eligibility_reason.length > 220 ? '…' : ''}</div> : null}
            </div>
            <div style={{ textAlign: 'right' }}>
              {g.status === 'new' ? <span className={`status ${ELIGIBILITY[g.eligibility].tone}`}>{ELIGIBILITY[g.eligibility].label}</span>
                : <span className="status info">{labelOf(GRANT_STATUSES, g.status)}</span>}
              <div className="small" style={{ marginTop: 6 }}>{deadlineLabel(g)}</div>
            </div>
          </Link>
        )) : <div className="empty">{data.grants.length ? 'Nothing here.' : 'No grants yet. Set your preferences and press Save and search.'}</div>}
      </section>
    </>
  );
}

'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { formatDate, today } from '@/lib/dates';
import type { CallSheet } from '@/lib/types';

export default function CallSheetsPage() {
  const router = useRouter();
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useQuery(async () =>
    must(await supabase.from('studio_call_sheets').select('id, title, client_name, shoot_date, call_time, location_name, shared_at, updated_at')
      .order('shoot_date', { ascending: false, nullsFirst: true }).limit(500)) as CallSheet[], []);
  const upcoming = (data || []).filter((s) => !s.shoot_date || s.shoot_date >= today());
  const past = (data || []).filter((s) => s.shoot_date && s.shoot_date < today());

  async function create() {
    setBusy(true);
    try {
      const s = must(await supabase.from('studio_call_sheets').insert({ title: 'New shoot', schedule: [{ time: '', item: 'Crew call' }, { time: '', item: 'Wrap' }] }).select('id').single()) as { id: string };
      router.push(`/call-sheets/${s.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create', 'error'); setBusy(false); }
  }
  const table = (rows: CallSheet[]) => (
    <div className="table-wrap"><table className="cards">
      <thead><tr><th>Shoot</th><th>Date</th><th>Call</th><th>Location</th><th>Shared</th></tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.id} className="clickable" onClick={() => router.push(`/call-sheets/${s.id}`)}>
          <td><div className="client-main"><Link href={`/call-sheets/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.title || 'Untitled'}</Link></div><div className="client-sub">{s.client_name}</div></td>
          <td>{formatDate(s.shoot_date) || <span className="small">TBC</span>}</td>
          <td>{s.call_time ? s.call_time.slice(0, 5) : <span className="small">TBC</span>}</td>
          <td>{s.location_name || <span className="small">TBC</span>}</td>
          <td>{s.shared_at ? <span className="status ok">Link on</span> : <span className="small">Not shared</span>}</td>
        </tr>))}</tbody>
    </table></div>
  );
  return (
    <>
      <PageHeader crumb="CALL SHEETS" title="Call sheets" sub="Times, location, crew and schedule in one link the whole team can open on their phones."
        actions={<button type="button" className="primary" onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : null}＋ New call sheet</button>} />
      {error ? <div className="notice error">{error} <button onClick={reload}>Retry</button></div> : null}
      {loading && !data ? <div className="skeleton">Loading…</div> : !data?.length ? (
        <div className="panel"><div className="empty">No call sheets yet. Create one, or start one from a brief.</div></div>
      ) : (<>
        <div className="panel"><h2>Upcoming</h2>{upcoming.length ? table(upcoming) : <p className="small">Nothing coming up.</p>}</div>
        {past.length ? <div className="panel"><h2>Past shoots</h2>{table(past)}</div> : null}
      </>)}
    </>
  );
}

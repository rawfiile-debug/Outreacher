'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { formatDate } from '@/lib/dates';
import type { Brief } from '@/lib/types';

export default function BriefsPage() {
  const router = useRouter();
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useQuery(async () =>
    must(await supabase.from('studio_briefs').select('id, title, client_name, shoot_date, deadline, approved_at, shared_at, updated_at, studio_brief_items(count), studio_brief_comments(count)')
      .order('updated_at', { ascending: false }).limit(500)) as (Brief & { studio_brief_items: { count: number }[]; studio_brief_comments: { count: number }[] })[], []);
  async function create() {
    setBusy(true);
    try {
      const b = must(await supabase.from('studio_briefs').insert({ title: 'New brief' }).select('id').single()) as { id: string };
      router.push(`/briefs/${b.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create', 'error'); setBusy(false); }
  }
  return (
    <>
      <PageHeader crumb="BRIEFS" title="Briefs & moodboards" sub="Agree the idea before the shoot: objective, deliverables, mood and references in one link."
        actions={<button type="button" className="primary" onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : null}＋ New brief</button>} />
      <div className="panel">
        {error ? <div className="notice error">{error} <button onClick={reload}>Retry</button></div> : null}
        {loading && !data ? <div className="skeleton">Loading…</div> : !data?.length ? <div className="empty">No briefs yet.</div> : (
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Brief</th><th>Shoot</th><th>Moodboard</th><th>Status</th></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => router.push(`/briefs/${b.id}`)}>
                <td><div className="client-main"><Link href={`/briefs/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.title || 'Untitled'}</Link></div><div className="client-sub">{b.client_name}</div></td>
                <td>{formatDate(b.shoot_date) || <span className="small">TBC</span>}</td>
                <td>{b.studio_brief_items?.[0]?.count ?? 0} items · {b.studio_brief_comments?.[0]?.count ?? 0} comments</td>
                <td>{b.approved_at ? <span className="status paid">Signed off</span> : b.shared_at ? <span className="status sent">Shared</span> : <span className="status draft">Draft</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

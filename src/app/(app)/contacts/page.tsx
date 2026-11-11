'use client';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CATEGORIES, STAGES, domainOf, stageTone, when, type Contact } from '@/lib/outreach';

const EMPTY = { company: '', name: '', email: '', website: '', category: 'Brand', notes: '' };

export default function ContactsPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [stage, setStage] = useState('All');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useQuery<Contact[]>(async () =>
    must(await supabase.from('outreach_contacts').select('*').order('created_at', { ascending: false }).limit(1000)) as Contact[], []);

  const rows = useMemo(() => (data || []).filter((c) =>
    (stage === 'All' || c.stage === stage) &&
    (!q || `${c.company} ${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase()))), [data, stage, q]);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, (data || []).filter((c) => c.stage === s).length])), [data]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast(ok); await reload(); return true; }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); return false; }
    finally { setBusy(false); }
  }
  const setContactStage = (c: Contact, next: string) => act(async () => {
    must(await supabase.from('outreach_contacts').update({ stage: next }).eq('id', c.id).select('id').single());
    // A contact who replied or is no longer wanted gets nothing more from the autopilot.
    if (!['To contact', 'Emailed'].includes(next)) {
      await supabase.from('outreach_emails').update({ status: 'skipped' }).eq('contact_id', c.id).in('status', ['pending', 'approved']);
    }
    setOpen(open && open.id === c.id ? { ...c, stage: next as Contact['stage'] } : open);
  }, `Moved to ${next}`);
  const doNotContact = (c: Contact) => {
    if (!confirm(`Never email ${c.email} again?`)) return;
    act(async () => {
      must(await supabase.from('outreach_suppressions').insert({ value: c.email.toLowerCase(), kind: 'email', reason: 'manual' }).select('id'));
      must(await supabase.from('outreach_contacts').update({ stage: 'Not now' }).eq('id', c.id).select('id'));
      await supabase.from('outreach_emails').update({ status: 'skipped' }).eq('contact_id', c.id).in('status', ['pending', 'approved']);
      setOpen(null);
    }, 'Added to do not contact');
  };
  const remove = (c: Contact) => {
    if (!confirm(`Delete ${c.company || c.email} and its emails from the tracker?`)) return;
    act(async () => { must(await supabase.from('outreach_contacts').delete().eq('id', c.id).select('id')); setOpen(null); }, 'Deleted');
  };
  async function add(ev: React.FormEvent) {
    ev.preventDefault();
    const ok = await act(async () => {
      must(await supabase.from('outreach_contacts').insert({ ...form, email: form.email.trim().toLowerCase(), domain: domainOf(form.website), source: 'manual' }).select('id'));
    }, 'Contact added');
    if (ok) { setAdding(false); setForm(EMPTY); }
  }

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;

  return (
    <>
      <PageHeader crumb="Outreach" title="Contacts" sub="Everyone Autopilot has found or you have added, and where they are."
        actions={<button className="primary" onClick={() => setAdding(true)}>Add contact</button>} />
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="filter" style={{ maxWidth: 260 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="filter" style={{ width: 'auto' }} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option>All</option>
          {STAGES.map((s) => <option key={s} value={s}>{s} ({counts[s] || 0})</option>)}
        </select>
      </div>
      <section className="panel">
        {!data ? <div className="skeleton">Loading…</div> : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Email</th><th>Stage</th><th>Added</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(c)}>
                    <td><strong>{c.company || '(no name)'}</strong><div className="small">{c.category}{c.fit_score != null ? `, fit ${c.fit_score}/10` : ''}</div></td>
                    <td>{c.email}</td>
                    <td><span className={`status ${stageTone(c.stage)}`}>{c.stage}</span></td>
                    <td className="small">{when(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">{data.length ? 'No contacts match.' : 'No contacts yet. Autopilot adds them each weekday morning.'}</div>}
      </section>

      {open ? (
        <Modal title={open.company || open.email} eyebrow={open.source === 'manual' ? 'Added by you' : 'Found by Autopilot'} onClose={() => setOpen(null)}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Stage</label>
            <select value={open.stage} disabled={busy} onChange={(e) => setContactStage(open, e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <p><a href={`mailto:${open.email}`}>{open.email}</a>{open.name ? `, ${open.name}` : ''}{open.website ? <> · <a href={open.website} target="_blank" rel="noreferrer">website</a></> : null}</p>
          {open.research ? <><div className="small">Research</div><p style={{ whiteSpace: 'pre-wrap' }}>{open.research}</p></> : null}
          {open.notes ? <><div className="small">Notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{open.notes}</p></> : null}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="quiet" disabled={busy} onClick={() => doNotContact(open)}>Do not contact</button>
            <button className="quiet danger" disabled={busy} onClick={() => remove(open)}>Delete</button>
          </div>
        </Modal>
      ) : null}

      {adding ? (
        <Modal title="Add contact" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="form-grid">
            <div className="field"><label>Company</label><input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <div className="field"><label>Name (optional)</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Email</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label>Website</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
            <div className="field"><label>Type</label><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field full"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="field full"><span className="hint">Autopilot writes a first email for contacts you add here on its next morning run, for you to approve.</span></div>
            <div className="row"><button className="primary" disabled={busy}>Add</button></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

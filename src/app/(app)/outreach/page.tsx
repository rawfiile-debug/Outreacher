'use client';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { ContactForm } from '@/components/outreach/ContactForm';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CATEGORIES, STAGES, STAGE_CLASS, type Contact, type Stage } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { followUpEmail, gmailComposeUrl } from '@/lib/followup';

const NEXT: Partial<Record<Stage, Stage>> = { 'To contact': 'Emailed', Emailed: 'Followed up', 'Followed up': 'Replied', Replied: 'Meeting', Meeting: 'Won' };

function nextStep(c: Contact): string {
  if (c.follow_up_due) return `Follow up (due ${formatDate(c.follow_up_on)})`;
  if (c.reminder_due) return `Reminder (${formatDate(c.remind_on)})`;
  switch (c.stage) {
    case 'To contact': return 'Send first email';
    case 'Emailed': return c.follow_up_on ? `Follow up on ${formatDate(c.follow_up_on)}` : 'Waiting';
    case 'Followed up': return 'Waiting for a reply';
    case 'Replied': return 'Reply and suggest a call';
    case 'Meeting': return 'Send a quote';
    default: return '';
  }
}

export default function OutreachPage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const { data, setData, error, loading, reload } = useQuery(async () =>
    must(await supabase.from('studio_contact_list').select('*').order('updated_at', { ascending: false }).limit(2000)) as Contact[], []);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [notion, setNotion] = useState<{ configured: boolean } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { fetch('/api/notion/status').then((r) => r.json()).then(setNotion).catch(() => setNotion({ configured: false })); }, []);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data || []).filter((c) => (!stage || c.stage === stage || (stage === 'due' && (c.follow_up_due || c.reminder_due)))
      && (!category || c.category === category)
      && (!t || [c.name, c.company, c.email, c.role, c.notes].some((v) => v.toLowerCase().includes(t))));
  }, [data, q, stage, category]);
  const due = (data || []).filter((c) => c.follow_up_due || c.reminder_due);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, (data || []).filter((c) => c.stage === s).length])), [data]);

  async function setContactStage(c: Contact, s: Stage) {
    setBusy(c.id);
    try {
      must(await supabase.from('studio_contacts').update({ stage: s }).eq('id', c.id).select('id').single());
      if (c.notion_page_id && ['Replied', 'Meeting', 'Won'].includes(s)) {
        fetch('/api/notion/replied', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).catch(() => {});
      }
      await reload();
      toast(`${c.name || c.company} moved to ${s}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not update', 'error'); }
    finally { setBusy(''); }
  }

  function writeFollowUp(c: Contact) {
    const { subject, body } = followUpEmail(c);
    window.open(gmailComposeUrl(c.email, subject, body), '_blank', 'noopener');
  }

  async function importNotion() {
    setBusy('notion');
    try {
      const r = await fetch('/api/notion/import', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Import failed');
      toast(`Notion: ${j.created} added, ${j.updated} updated${j.skipped ? `, ${j.skipped} skipped` : ''}`);
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed', 'error'); }
    finally { setBusy(''); }
  }

  return (
    <>
      <PageHeader crumb="OUTREACH" title="Outreach" sub="Who you have contacted, who needs a follow-up, and who has replied."
        actions={<>
          {notion?.configured ? <button type="button" onClick={importNotion} disabled={busy === 'notion'}>{busy === 'notion' ? <span className="spinner" /> : null} Import from Notion</button> : null}
          <button type="button" onClick={() => setPasteOpen(true)}>Paste a list</button>
          <button type="button" className="primary" onClick={() => setEditing('new')}>＋ Add contact</button>
        </>} />

      <div className="stats pipeline">
        {(['To contact', 'Emailed', 'Followed up', 'Replied'] as Stage[]).map((s) => (
          <button key={s} type="button" className={`stat${stage === s ? ' on' : ''}`} onClick={() => setStage(stage === s ? '' : s)}>
            <div className="label">{s}</div><div className="value">{counts[s] ?? 0}</div>
            <div className="hint">{s === 'Replied' ? `${(counts.Meeting ?? 0) + (counts.Won ?? 0)} meetings or wins` : ' '}</div>
          </button>
        ))}
      </div>

      {due.length ? (
        <div className="panel due-panel">
          <div className="section-head"><div><h2>Follow-ups due</h2><p className="sub">One follow-up, a week after the first email. It opens in Gmail for you to check and send.</p></div></div>
          {due.map((c) => (
            <div key={c.id} className="suggestion">
              <div><strong>{c.name || c.company}</strong>{c.company && c.name ? ` · ${c.company}` : ''}
                <div className="small">{c.follow_up_due ? `First emailed ${formatDate(c.first_emailed_on)}` : `Reminder for ${formatDate(c.remind_on)}`}{c.email ? ` · ${c.email}` : ''}</div></div>
              <div className="inline-actions">
                {c.follow_up_due && c.email ? <button type="button" onClick={() => writeFollowUp(c)}>Write follow-up</button> : null}
                {c.follow_up_due ? <button type="button" className="primary" disabled={busy === c.id} onClick={() => setContactStage(c, 'Followed up')}>Mark followed up</button>
                  : <button type="button" disabled={busy === c.id} onClick={async () => { must(await supabase.from('studio_contacts').update({ remind_on: null }).eq('id', c.id).select('id')); reload(); }}>Done</button>}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 15 }}>
          <div className="search"><input aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email…" /></div>
          <select className="filter" style={{ width: 'auto' }} aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option><option value="due">Due now</option>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filter" style={{ width: 'auto' }} aria-label="Type" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All types</option>{CATEGORIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {error ? <div className="notice error">{error} <button onClick={reload}>Retry</button></div> : null}
        {loading && !data ? <div className="skeleton">Loading…</div> : !rows.length ? (
          <div className="empty">{data?.length ? 'No contacts match.' : 'No contacts yet. Add one, paste a list, or import from Notion.'}</div>
        ) : (
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Contact</th><th>Type</th><th>Stage</th><th>First emailed</th><th>Next step</th><th></th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                <td><div className="client-main">{c.name || c.company || c.email}</div>
                  <div className="client-sub">{[c.name ? c.company : '', c.role, c.email].filter(Boolean).join(' · ')}</div></td>
                <td>{c.category}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select className={`stage-select status ${STAGE_CLASS[c.stage]}`} aria-label={`Stage for ${c.name || c.company}`} value={c.stage} disabled={busy === c.id}
                    onChange={(e) => setContactStage(c, e.target.value as Stage)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
                </td>
                <td>{formatDate(c.first_emailed_on) || <span className="small">Not yet</span>}</td>
                <td className={c.follow_up_due || c.reminder_due ? 'due-text' : 'small'}>{nextStep(c)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {NEXT[c.stage] ? <button type="button" className="quiet" disabled={busy === c.id} onClick={() => setContactStage(c, NEXT[c.stage]!)}>→ {NEXT[c.stage]}</button> : null}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      {editing ? (
        <Modal title={editing === 'new' ? 'Add contact' : `${editing.name || editing.company}`} onClose={() => setEditing(null)} wide>
          <ContactForm contact={editing === 'new' ? undefined : editing}
            onSaved={() => { setEditing(null); reload(); toast('Saved'); }}
            onDeleted={() => { setEditing(null); setData((d) => (d || []).filter((x) => editing !== 'new' && x.id !== editing.id)); toast('Removed'); }}
            onCancel={() => setEditing(null)} />
        </Modal>
      ) : null}
      {pasteOpen ? <PasteList onClose={() => setPasteOpen(false)} onDone={(n) => { setPasteOpen(false); reload(); toast(`${n} contact${n === 1 ? '' : 's'} added`); }} /> : null}
    </>
  );
}

/** Paste rows straight from a spreadsheet or notes: name, company, email (and optionally role), one per line. */
function PasteList({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('Agency');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/\t|,|;/).map((p) => p.trim());
    const email = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) || '';
    const rest = parts.filter((p) => p !== email);
    return { name: rest[0] || '', company: rest[1] || '', role: rest[2] || '', email: email.toLowerCase() };
  }).filter((r) => r.name || r.company || r.email);

  async function add() {
    setError(''); setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      let n = 0;
      for (const r of parsed) {
        const { error } = await supabase.from('studio_contacts').insert({ ...r, category });
        if (!error) n++;
        else if (error.code !== '23505') throw new Error(error.message);
      }
      onDone(n);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the list'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Paste a list" onClose={onClose} wide>
      <p className="small">One contact per line: <strong>name, company, email</strong> (and role if you have it). Copying rows from a spreadsheet works too. Emails already in your tracker are skipped.</p>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="field"><label htmlFor="p-text">Contacts</label><textarea id="p-text" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Ada Lovelace, Agency One, ada@agencyone.com, Head of Production\nSam Reed, Brand Co, sam@brandco.com'} /></div>
        <div className="field"><label htmlFor="p-cat">Type</label><select id="p-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button type="button" className="primary" disabled={busy || !parsed.length} onClick={add}>{busy ? <span className="spinner" /> : null} Add {parsed.length || ''} contact{parsed.length === 1 ? '' : 's'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

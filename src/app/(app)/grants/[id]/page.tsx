'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { downloadPdf, downloadText, downloadWord } from '@/lib/download';
import { documentText } from '@/lib/extract';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ELIGIBILITY, GRANT_STATUSES, GRANT_TYPES, deadlineLabel, draftFileName, labelOf, when, type Grant, type Job } from '@/lib/outreach';

type Data = { g: Grant; job: Job | null; summaryConfirmed: boolean };

export default function GrantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState('');
  const [extra, setExtra] = useState('');
  const [formText, setFormText] = useState('');
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [format, setFormat] = useState('pdf');

  const { data, error, reload } = useQuery<Data>(async () => {
    const [g, job, p] = await Promise.all([
      supabase.from('outreach_grants').select('*').eq('id', id).single(),
      supabase.from('outreach_jobs').select('*').eq('kind', 'draft_grant').eq('ref_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('outreach_profile').select('summary_confirmed').maybeSingle(),
    ]);
    return { g: must(g) as Grant, job: must(job) as Job | null, summaryConfirmed: Boolean((must(p) as { summary_confirmed: boolean } | null)?.summary_confirmed) };
  }, [id]);
  useEffect(() => { if (data) { setExtra(data.g.extra_info); setFormText(data.g.form_text); setDraft(data.g.draft); setNotes(data.g.notes); } }, [data]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast(ok); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(''); }
  }
  const update = async (patch: Partial<Grant>) => must(await supabase.from('outreach_grants').update(patch).eq('id', id).select('id').single());

  if (error) return <div className="notice error">{error} <Link href="/grants">Back to grants</Link></div>;
  if (!data) return <div className="skeleton">Loading…</div>;
  const g = data.g;
  const drafting = data.job && (data.job.status === 'queued' || data.job.status === 'running');
  const base = draftFileName(g.title);

  const uploadForm = (file: File) => act('form', async () => {
    if (file.size > 15 * 1024 * 1024) throw new Error('That file is over 15 MB.');
    const text = await documentText(file);
    if (text.length < 40) throw new Error('Could not read any text from that file. If it is a scan, paste the questions into the box instead.');
    setFormText(text);
    await update({ form_name: file.name, form_text: text, status: g.status === 'new' ? 'applying' : g.status });
  }, 'Form read. Check the questions below.');
  const draftNow = () => act('draft', async () => {
    if (!formText.trim()) throw new Error('Upload the application form or paste its questions first.');
    await update({ form_text: formText.trim().slice(0, 40000), extra_info: extra.trim(), status: g.status === 'new' ? 'applying' : g.status });
    const res = await supabase.from('outreach_jobs').insert({ kind: 'draft_grant', ref_id: id }).select('id');
    if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
  }, 'Queued. Your draft will be ready within the hour.');
  async function download() {
    const text = draft.trim();
    if (!text) { toast('Nothing to download yet', 'error'); return; }
    try {
      if (format === 'pdf') await downloadPdf(g.title, text, base);
      else if (format === 'docx') await downloadWord(g.title, text, base);
      else if (format === 'txt') downloadText(g.title, text, base);
      else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not make that file', 'error'); }
  }
  const remove = () => {
    if (!confirm('Delete this grant from your list? It may be found again by a later search.')) return;
    act('del', async () => { must(await supabase.from('outreach_grants').delete().eq('id', id).select('id')); router.replace('/grants'); }, 'Deleted');
  };
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <>
      <PageHeader crumb="Grants" title={g.title} sub={[g.funder, labelOf(GRANT_TYPES, g.grant_type), g.amount].filter(Boolean).join(' · ')}
        actions={<a className="btn" href={g.url} target="_blank" rel="noreferrer">Open grant page</a>} />

      <section className="panel">
        <div className="section-head">
          <div className="row">{g.status === 'new' ? <span className={`status ${ELIGIBILITY[g.eligibility].tone}`}>{ELIGIBILITY[g.eligibility].label}</span> : null}
            <span className="small">Deadline: {deadlineLabel(g)}{g.fit_score != null ? ` · Fit ${g.fit_score}/10` : ''}{g.location ? ` · ${g.location}` : ''}</span></div>
          <div className="field" style={{ minWidth: 180 }}>
            <select value={g.status} disabled={!!busy} onChange={(e) => act('status', () => update({ status: e.target.value }), 'Status updated')}>
              {GRANT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select></div>
        </div>
        <div className="form-grid">
          <div><h2>What it funds</h2><p style={{ whiteSpace: 'pre-wrap' }}>{g.what_it_funds || 'Not stated.'}</p></div>
          <div><h2>Who can apply</h2><p style={{ whiteSpace: 'pre-wrap' }}>{g.who_can_apply || 'Not stated.'}</p></div>
        </div>
        {g.eligibility_reason ? <div className="notice" style={{ marginTop: 10 }}><strong>Why {ELIGIBILITY[g.eligibility].label.toLowerCase()}:</strong> {g.eligibility_reason}</div> : null}
        <div className="field full"><label>My notes</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== g.notes && act('notes', () => update({ notes }), 'Notes saved')} /></div>
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>1. The application form</h2><p className="sub">Upload the form or guidance (PDF, Word or text), or paste the questions. Include word limits if they give them.</p></div>
          <label className="btn">{busy === 'form' ? 'Reading…' : g.form_name ? 'Replace form' : 'Upload form'}
            <input type="file" hidden accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadForm(f); }} />
          </label></div>
        {g.form_name ? <p className="small">From {g.form_name}. Edit below if anything was read wrongly.</p> : null}
        <div className="field"><textarea rows={8} placeholder="Paste the application questions here" value={formText} onChange={(e) => setFormText(e.target.value)} /></div>
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>2. Anything else for this application</h2><p className="sub">Your idea for the project, budget, dates, people involved, links. The draft only uses this, your profile and the grant&apos;s own guidance.</p></div></div>
        <div className="field"><textarea rows={7} value={extra} onChange={(e) => setExtra(e.target.value)} /></div>
        {!data.summaryConfirmed ? <div className="notice warn" style={{ marginTop: 10 }}>Your profile summary is not confirmed yet. <Link href="/profile">Check it first</Link> so the draft gets your details right.</div> : null}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!!busy || Boolean(drafting)} onClick={draftNow}>{g.draft ? 'Draft again' : 'Draft now'}</button>
          {drafting ? <span className="small">Queued {when(data.job!.created_at)}. The hourly run (8am to 8pm) will write it.</span> : null}
          {data.job?.status === 'failed' ? <span className="small danger">Last draft failed: {data.job.error}</span> : null}
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>3. Your draft</h2>{g.drafted_at ? <p className="sub">Written {when(g.drafted_at)}. {words.toLocaleString('en-GB')} words. Check every answer, especially anything in [square brackets].</p> : null}</div></div>
        {g.draft || draft ? (
          <>
            <div className="field"><textarea rows={24} value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={!!busy || draft === g.draft} onClick={() => act('save', () => update({ draft }), 'Draft saved')}>Save changes</button>
              <span className="small" style={{ marginLeft: 'auto' }}>Download as</span>
              <select className="filter" style={{ width: 'auto' }} value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="txt">Plain text (.txt)</option><option value="copy">Copy to clipboard</option>
              </select>
              <button className="primary" onClick={download}>{format === 'copy' ? 'Copy' : 'Download'}</button>
            </div>
          </>
        ) : <div className="empty">No draft yet. Add the form, then press Draft now.</div>}
      </section>

      <div className="row"><button className="quiet danger" disabled={!!busy} onClick={remove}>Delete grant</button></div>
    </>
  );
}

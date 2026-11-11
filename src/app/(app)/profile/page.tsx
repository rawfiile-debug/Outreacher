'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { runNow } from '@/lib/run';
import { documentText, imageText } from '@/lib/extract';
import { APPLY_AS, instantSummary, safeFileName, when, type Job, type Profile } from '@/lib/outreach';

const BUCKET = 'outreach-files';
type Data = { p: Profile | null; uid: string; job: Job | null; shots: { path: string; url: string }[] };
type Fields = Pick<Profile, 'website' | 'bio' | 'clients' | 'projects' | 'awards' | 'equipment' | 'extra' | 'apply_as'>;
const BLANK: Fields = { website: '', bio: '', clients: '', projects: '', awards: '', equipment: '', extra: '', apply_as: ['individual'] };

export default function ProfilePage() {
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState<Fields>(BLANK);
  const [summary, setSummary] = useState('');

  const { data, setData, error, reload } = useQuery<Data>(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id || '';
    const [p, job] = await Promise.all([
      supabase.from('outreach_profile').select('*').maybeSingle(),
      supabase.from('outreach_jobs').select('*').eq('kind', 'build_profile').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const profile = must(p) as Profile | null;
    let shots: Data['shots'] = [];
    if (profile?.instagram_paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(profile.instagram_paths, 3600);
      shots = (signed || []).map((s: { path: string | null; signedUrl: string }) => ({ path: s.path || '', url: s.signedUrl }));
    }
    return { p: profile, uid, job: must(job) as Job | null, shots };
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!data.p) {
      supabase.from('outreach_profile').insert({}).select('*').single()
        .then(({ data: row }: { data: unknown }) => { if (row) setData({ ...data, p: row as Profile }); });
      return;
    }
    const p = data.p;
    setForm({ website: p.website, bio: p.bio, clients: p.clients, projects: p.projects, awards: p.awards, equipment: p.equipment, extra: p.extra, apply_as: p.apply_as });
    setSummary(p.summary);
  }, [data, setData, supabase]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(''); }
  }
  const update = async (patch: Partial<Profile>) => must(await supabase.from('outreach_profile').update(patch).eq('owner_id', data!.uid).select('owner_id').single());

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (!data?.p) return <div className="skeleton">Loading…</div>;
  const p = data.p;
  const jobWaiting = data.job && (data.job.status === 'queued' || data.job.status === 'running');

  const uploadCv = (file: File) => act('cv', async () => {
    if (file.size > 15 * 1024 * 1024) throw new Error('That file is over 15 MB.');
    const text = await documentText(file);
    if (text.length < 100) throw new Error('Could not read any text from that file. If it is a scanned image, export it again as a text PDF or Word file.');
    const path = `${data.uid}/cv/${Date.now()}-${safeFileName(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (up.error) throw new Error(up.error.message);
    if (p.cv_path) await supabase.storage.from(BUCKET).remove([p.cv_path]);
    await update({ cv_path: path, cv_name: file.name, cv_text: text, summary_confirmed: false });
  }, 'CV uploaded');
  const uploadShots = (files: FileList) => act('ig', async () => {
    const room = 12 - p.instagram_paths.length;
    if (room <= 0) throw new Error('You can keep up to 12 screenshots. Remove some first.');
    const chosen = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, room);
    const texts = await imageText(chosen);
    const added: string[] = [];
    for (const file of chosen) {
      const path = `${data.uid}/instagram/${Date.now()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      added.push(path);
    }
    const note = texts.map((t, i) => `[Screenshot ${p.instagram_paths.length + i + 1}]\n${t}`).join('\n\n');
    await update({ instagram_paths: [...p.instagram_paths, ...added], instagram_text: `${p.instagram_text}\n\n${note}`.trim().slice(-30000), summary_confirmed: false });
  }, 'Screenshots added');
  const removeShot = (path: string) => act('ig', async () => {
    await supabase.storage.from(BUCKET).remove([path]);
    const left = p.instagram_paths.filter((x) => x !== path);
    await update({ instagram_paths: left, ...(left.length ? {} : { instagram_text: '' }) });
  }, 'Removed');
  const saveDetails = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.apply_as.length) { toast('Pick at least one way you apply', 'error'); return; }
    act('details', () => update({ ...form, website: form.website.trim(), summary_confirmed: false }), 'Details saved');
  };
  // Instant: arranges what is in the boxes below, saved straight away. Unsaved edits in the boxes are included.
  const buildSummary = () => act('build', async () => {
    const text = instantSummary({ ...p, ...form });
    await update({ ...form, website: form.website.trim(), summary: text, summary_built_at: new Date().toISOString(), summary_confirmed: false });
    setSummary(text);
  }, 'Summary built. Check it, then confirm.');
  // Optional: the hourly run rewrites it using the CV, the website and the Instagram screenshots as well.
  const polish = () => act('polish', async () => {
    const res = await supabase.from('outreach_jobs').insert({ kind: 'build_profile' }).select('id');
    if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
    toast((await runNow('build_profile')).message);
  }, '');
  const saveSummary = (confirmed: boolean) => act('summary', () => update({ summary: summary.trim(), summary_confirmed: confirmed }), confirmed ? 'Summary confirmed' : 'Summary saved');
  const toggleApplyAs = (v: string) => setForm({ ...form, apply_as: form.apply_as.includes(v) ? form.apply_as.filter((x) => x !== v) : [...form.apply_as, v] });
  const field = (k: keyof Omit<Fields, 'apply_as' | 'website'>, label: string, hint: string, rows = 4) => (
    <div className="field full"><label>{label}</label><textarea rows={rows} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /><span className="hint">{hint}</span></div>
  );

  return (
    <>
      <PageHeader crumb="Outreach" title="My profile" sub="Everything grant answers and gig replies are written from. Nothing outside this gets claimed about you." />

      <section className="panel">
        <div className="section-head"><div><h2>Summary</h2><p className="sub">Built from your CV, website, Instagram screenshots and the details below. Check it once, then it is used everywhere.</p></div>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={buildSummary}>{p.summary ? 'Rebuild now' : 'Build my summary'}</button>
            <button disabled={!!busy || Boolean(jobWaiting)} onClick={polish}>Polish with Claude</button>
          </div></div>
        <p className="small" style={{ marginTop: -6 }}>Build my summary is instant and uses what you have typed below. Polish with Claude also reads your CV, website and screenshots and rewrites it properly; it starts as soon as you press it and takes a few minutes.</p>
        {jobWaiting ? <div className="notice">Claude is polishing your summary (started {when(data.job!.created_at)}). You will get a notification when it is ready; refresh this page to see it.</div> : null}
        {data.job?.status === 'failed' ? <div className="notice error">The last build failed: {data.job.error || 'unknown reason'}. Try again.</div> : null}
        {p.summary ? (
          <>
            {p.summary_confirmed ? <div className="notice ok">Confirmed. Grant drafts and gig replies use this.</div> : <div className="notice warn">Not confirmed yet. Read it, fix anything wrong, then confirm.</div>}
            <div className="field"><textarea rows={16} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" disabled={!!busy} onClick={() => saveSummary(true)}>Save and confirm</button>
              <button disabled={!!busy} onClick={() => saveSummary(false)}>Save without confirming</button>
              {p.summary_built_at ? <span className="small">Built {when(p.summary_built_at)}</span> : null}
            </div>
          </>
        ) : <div className="empty">No summary yet. Add your CV, screenshots and details, then press Build my summary. It appears straight away.</div>}
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>CV</h2><p className="sub">PDF or Word (.docx), up to 15 MB. The text is read when you upload it.</p></div></div>
        <div className="row">
          {p.cv_path ? <span>{p.cv_name} <span className="small">({p.cv_text.length.toLocaleString('en-GB')} characters read)</span></span> : <span className="small">No CV yet.</span>}
          <label className="btn">{busy === 'cv' ? 'Reading…' : p.cv_path ? 'Replace CV' : 'Upload CV'}
            <input type="file" hidden accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCv(f); }} />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>Instagram screenshots</h2><p className="sub">Your bio, your grid and a few key posts with captions. Up to 12. The text in them is read when you add them, which takes a few seconds each.</p></div>
          <label className="btn">{busy === 'ig' ? 'Reading screenshots…' : 'Add screenshots'}
            <input type="file" hidden multiple accept="image/*" disabled={!!busy} onChange={(e) => { const f = e.target.files; if (f?.length) uploadShots(f); e.target.value = ''; }} />
          </label></div>
        {data.shots.length ? (
          <div className="shots">
            {data.shots.map((s) => (
              <figure key={s.path}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="Instagram screenshot" />
                <button type="button" className="quiet danger" disabled={!!busy} onClick={() => removeShot(s.path)}>Remove</button>
              </figure>
            ))}
          </div>
        ) : <div className="empty">No screenshots yet.</div>}
        {p.instagram_text ? <details style={{ marginTop: 12 }}><summary className="small">Text read from your screenshots</summary><div className="email-body">{p.instagram_text}</div></details> : null}
      </section>

      <form className="panel" onSubmit={saveDetails}>
        <div className="section-head"><h2>About you</h2></div>
        <div className="form-grid">
          <div className="field full"><label>Website</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /><span className="hint">Each summary build reads the whole site, including the About page.</span></div>
          <div className="field full"><label>I can apply as</label>
            <div className="row">{APPLY_AS.map((a) => <label key={a.value} className="check"><input type="checkbox" checked={form.apply_as.includes(a.value)} onChange={() => toggleApplyAs(a.value)} /> {a.label}</label>)}</div>
            <span className="hint">Used to judge grant eligibility.</span></div>
          {field('bio', 'Short bio', 'In your own words: what you do and why.')}
          {field('clients', 'Clients', 'One per line. Say what the work was if it matters, e.g. "Charlotte Tilbury: interview content, through RAWFIILE".')}
          {field('projects', 'Projects', 'Personal and commissioned projects, one per line, with a line on each.', 5)}
          {field('awards', 'Awards, press and exhibitions', 'Optional.', 3)}
          {field('equipment', 'Equipment', 'Cameras, formats and kit you work with.', 3)}
          {field('extra', 'Anything else', 'Workshops you run, communities you work with, languages, places you have lived. Only what you are happy to have used in applications.', 4)}
        </div>
        <div className="row" style={{ marginTop: 14 }}><button className="primary" disabled={!!busy}>Save details</button>
          <span className="small">Changes mark the summary as needing a rebuild or re-check.</span></div>
      </form>
    </>
  );
}

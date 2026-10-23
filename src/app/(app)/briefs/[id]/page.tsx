'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { SharePanel } from '@/components/SharePanel';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { BriefView } from '@/components/brief/BriefView';
import { createSupabaseBrowserClient, moodboardUrl } from '@/lib/supabase/browser';
import { prepareImage } from '@/lib/image';
import type { Brief, BriefComment, BriefItem } from '@/lib/types';

type Form = Pick<Brief, 'title' | 'client_name' | 'client_email' | 'shoot_date' | 'deadline' | 'objective' | 'audience' | 'deliverables' | 'mood' |
  'palette' | 'styling' | 'locations' | 'references_text' | 'dos' | 'donts' | 'private_notes'>;
const FIELDS: (keyof Form)[] = ['title', 'client_name', 'client_email', 'shoot_date', 'deadline', 'objective', 'audience', 'deliverables', 'mood',
  'palette', 'styling', 'locations', 'references_text', 'dos', 'donts', 'private_notes'];
type Loaded = { brief: Brief; items: BriefItem[]; comments: BriefComment[]; callSheets: { id: string; title: string }[]; uid: string };

export default function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const { data, setData, error, reload } = useQuery<Loaded>(async () => {
    const [b, items, comments, sheets, user] = await Promise.all([
      supabase.from('studio_briefs').select('*').eq('id', id).single(),
      supabase.from('studio_brief_items').select('*').eq('brief_id', id).order('position').order('created_at'),
      supabase.from('studio_brief_comments').select('*').eq('brief_id', id).order('created_at'),
      supabase.from('studio_call_sheets').select('id, title').eq('brief_id', id),
      supabase.auth.getUser(),
    ]);
    return { brief: must(b) as Brief, items: must(items) as BriefItem[], comments: must(comments) as BriefComment[],
      callSheets: must(sheets) as { id: string; title: string }[], uid: user.data.user?.id ?? '' };
  }, [id]);
  const [f, setF] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const [swatch, setSwatch] = useState('#18263D');
  const [link, setLink] = useState({ url: '', caption: '' });
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (data && !f) setF(Object.fromEntries(FIELDS.map((k) => [k, data.brief[k] ?? (k === 'palette' ? [] : '')])) as Form); }, [data, f]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (error) return <div className="notice error">{error}</div>;
  if (!data || !f) return <div className="skeleton">Loading brief…</div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  const { brief, items, comments } = data;

  async function run(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); } finally { setBusy(''); }
  }
  const save = () => run('save', async () => {
    const row = must(await supabase.from('studio_briefs').update({ ...f!, shoot_date: f!.shoot_date || null, deadline: f!.deadline || null }).eq('id', id).select('*').single()) as Brief;
    setData({ ...data!, brief: row }); setF(null); setDirty(false);
  }, 'Brief saved');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run('upload', async () => {
      let pos = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const added: BriefItem[] = [];
      for (const file of Array.from(files).slice(0, 30)) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is over 25 MB.`);
        const { blob, ext, type } = await prepareImage(file);
        if (blob.size > 10 * 1024 * 1024) throw new Error(`${file.name} is still over 10 MB after shrinking.`);
        const path = `${data!.uid}/${id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('studio-moodboard').upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
        const row = must(await supabase.from('studio_brief_items').insert({ brief_id: id, kind: 'image', storage_path: path, position: pos++ }).select('*').single()) as BriefItem;
        added.push(row);
      }
      setData({ ...data!, items: [...items, ...added] });
    }, `${files.length} image${files.length === 1 ? '' : 's'} added`);
    if (fileRef.current) fileRef.current.value = '';
  }
  const addItem = (values: Partial<BriefItem>) => run('item', async () => {
    const pos = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
    const row = must(await supabase.from('studio_brief_items').insert({ brief_id: id, position: pos, ...values }).select('*').single()) as BriefItem;
    setData({ ...data!, items: [...items, row] });
  });
  const removeItem = (it: BriefItem) => run('item', async () => {
    must(await supabase.from('studio_brief_items').delete().eq('id', it.id).select('id'));
    if (it.storage_path) await supabase.storage.from('studio-moodboard').remove([it.storage_path]);
    setData({ ...data!, items: items.filter((x) => x.id !== it.id) });
  });
  const moveItem = (i: number, d: number) => run('item', async () => {
    const a = [...items]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x);
    await Promise.all(a.map((it, n) => (it.position === n ? null : supabase.from('studio_brief_items').update({ position: n }).eq('id', it.id))));
    setData({ ...data!, items: a.map((it, n) => ({ ...it, position: n })) });
  });
  const captionItem = (it: BriefItem, caption: string) => run('item', async () => {
    must(await supabase.from('studio_brief_items').update({ caption }).eq('id', it.id).select('id'));
    setData({ ...data!, items: items.map((x) => (x.id === it.id ? { ...x, caption } : x)) });
  });
  const sendReply = () => run('reply', async () => {
    const row = must(await supabase.from('studio_brief_comments').insert({ brief_id: id, owner_id: data!.uid, author_name: 'Michael', body: reply.trim() }).select('*').single()) as BriefComment;
    setData({ ...data!, comments: [...comments, row] }); setReply('');
  });
  const makeCallSheet = () => run('cs', async () => {
    if (dirty) throw new Error('Save the brief first.');
    const { data: s, error } = await supabase.rpc('studio_call_sheet_from_brief', { p_brief: id });
    if (error) throw new Error(error.message);
    router.push(`/call-sheets/${(s as { id: string }).id}`);
  });
  async function remove() {
    if (!confirm('Delete this brief, its moodboard and comments? Any share link stops working. This cannot be undone.')) return;
    const paths = items.map((i) => i.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from('studio-moodboard').remove(paths);
    must(await supabase.from('studio_briefs').delete().eq('id', id).select('id'));
    router.push('/briefs');
  }

  const field = (k: Exclude<keyof Form, 'palette'>, label: string, o: { type?: string; full?: boolean; rows?: number; placeholder?: string; hint?: string } = {}) => (
    <div className={`field${o.full ? ' full' : ''}`}><label htmlFor={`b-${k}`}>{label}</label>
      {o.rows ? <textarea id={`b-${k}`} rows={o.rows} value={(f[k] as string) ?? ''} placeholder={o.placeholder} onChange={(e) => set(k, e.target.value)} />
        : <input id={`b-${k}`} type={o.type || 'text'} value={(f[k] as string) ?? ''} placeholder={o.placeholder} onChange={(e) => set(k, e.target.value)} />}
      {o.hint ? <span className="hint">{o.hint}</span> : null}</div>
  );

  return (
    <>
      <PageHeader crumb="BRIEFS" title={f.title || 'Brief'} sub={brief.approved_at ? `Signed off by ${brief.approved_by}` : undefined}
        actions={<>
          <button type="button" onClick={() => setPreview(true)}>Preview</button>
          <button type="button" onClick={makeCallSheet} disabled={!!busy}>Make call sheet</button>
          <button type="button" className="primary" onClick={save} disabled={!!busy || !dirty}>{busy === 'save' ? <span className="spinner" /> : null} {dirty ? 'Save changes' : 'Saved'}</button>
        </>} />
      <div className="two-col">
        <div>
          <div className="panel">
            <h2>The job</h2>
            <div className="form-grid">
              {field('title', 'Brief title', { full: true })}
              {field('client_name', 'Client')}
              {field('client_email', 'Client email', { type: 'email' })}
              {field('shoot_date', 'Shoot date', { type: 'date' })}
              {field('deadline', 'Delivery deadline', { type: 'date' })}
              {field('objective', 'What this is for', { full: true, rows: 3, placeholder: 'Launch imagery for the spring drop, used on the website and Instagram.' })}
              {field('audience', 'Who it is for', { full: true, rows: 2 })}
              {field('deliverables', 'Deliverables', { full: true, rows: 3, placeholder: '30 edited stills (digital), 1 roll of 120 film, 3 x 15-second vertical edits' })}
            </div>
          </div>
          <div className="panel">
            <h2>Mood</h2>
            <div className="form-grid">
              {field('mood', 'Mood and tone', { full: true, rows: 2, placeholder: 'Soft window light, quiet, honest, a bit of grain' })}
              <div className="field full"><label>Colour palette</label>
                <div className="br-palette edit">{f.palette.map((c) => (
                  <button key={c} type="button" className="br-swatch" title="Remove" onClick={() => set('palette', f.palette.filter((x) => x !== c))}><span style={{ background: c }} /><code>{c} ✕</code></button>
                ))}
                  {f.palette.length < 12 ? <span className="inline-actions"><input type="color" aria-label="Pick a colour" value={swatch} onChange={(e) => setSwatch(e.target.value.toUpperCase())} />
                    <button type="button" onClick={() => { const c = swatch.toUpperCase(); if (!f.palette.includes(c)) set('palette', [...f.palette, c]); }}>Add {swatch}</button></span> : null}
                </div></div>
              {field('styling', 'Styling', { full: true, rows: 3 })}
              {field('locations', 'Locations', { full: true, rows: 2 })}
              {field('references_text', 'References', { full: true, rows: 2, placeholder: 'Photographers, films or campaigns to look at' })}
              {field('dos', 'Do', { rows: 3 })}
              {field('donts', 'Avoid', { rows: 3 })}
              {field('private_notes', 'Private notes', { full: true, rows: 2, hint: 'Only you see these. Never on the shared link.' })}
            </div>
          </div>
          <div className="panel">
            <div className="section-head"><div><h2>Moodboard</h2><p className="sub">Photos are shrunk before upload so the board loads fast on phones.</p></div>
              <span className="inline-actions">
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
                <button type="button" className="primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === 'upload' ? <span className="spinner" /> : null} Add images</button>
              </span></div>
            {items.length ? <div className="br-board edit">{items.map((it, i) => (
              <figure key={it.id} className={`br-tile${it.kind !== 'image' ? ` br-${it.kind}` : ''}`}>
                {it.kind === 'image' && it.storage_path ? <img src={moodboardUrl(it.storage_path)} alt={it.caption || 'Reference'} loading="lazy" />
                  : it.kind === 'link' ? <a href={it.url} target="_blank" rel="noopener noreferrer"><strong>{it.url}</strong></a> : null}
                <input className="br-cap" aria-label="Caption" defaultValue={it.caption} placeholder={it.kind === 'note' ? 'Note' : 'Caption'}
                  onBlur={(e) => { if (e.target.value !== it.caption && (it.kind !== 'note' || e.target.value.trim())) captionItem(it, e.target.value); }} />
                <div className="br-tools">
                  <button type="button" className="quiet" aria-label="Move earlier" disabled={i === 0 || !!busy} onClick={() => moveItem(i, -1)}>←</button>
                  <button type="button" className="quiet" aria-label="Move later" disabled={i === items.length - 1 || !!busy} onClick={() => moveItem(i, 1)}>→</button>
                  <button type="button" className="quiet danger" aria-label="Remove" disabled={!!busy} onClick={() => removeItem(it)}>✕</button>
                </div>
              </figure>
            ))}</div> : <p className="small">Add photos, links to references, or short notes.</p>}
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field"><label htmlFor="b-link">Add a link</label><input id="b-link" value={link.url} placeholder="https://www.instagram.com/p/…" onChange={(e) => setLink({ ...link, url: e.target.value })} /></div>
              <div className="field"><label htmlFor="b-linkcap">What it is</label>
                <div className="inline-actions"><input id="b-linkcap" style={{ flex: 1 }} value={link.caption} onChange={(e) => setLink({ ...link, caption: e.target.value })} />
                  <button type="button" disabled={!/^https:\/\//i.test(link.url.trim()) || !!busy} onClick={async () => { await addItem({ kind: 'link', url: link.url.trim(), caption: link.caption.trim() }); setLink({ url: '', caption: '' }); }}>Add</button></div>
                {link.url && !/^https:\/\//i.test(link.url.trim()) ? <span className="hint">Links must start with https://</span> : null}</div>
              <div className="field full"><label htmlFor="b-note">Add a note</label>
                <div className="inline-actions"><input id="b-note" style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shoot the second look at golden hour" />
                  <button type="button" disabled={!note.trim() || !!busy} onClick={async () => { await addItem({ kind: 'note', caption: note.trim() }); setNote(''); }}>Add</button></div></div>
            </div>
          </div>
        </div>
        <div>
          <SharePanel kind="brief" id={id} sharedAt={brief.shared_at} path="b" what="brief" onChange={(at) => setData({ ...data, brief: { ...brief, shared_at: at } })} />
          {dirty ? <div className="notice warn">You have unsaved changes. Save so the shared link shows them.</div> : null}
          {brief.approved_at ? <div className="notice ok">Signed off by {brief.approved_by} on {new Date(brief.approved_at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })}.</div> : null}
          <div className="panel">
            <div className="section-head"><h2>Comments</h2><button type="button" className="quiet" onClick={reload}>Refresh</button></div>
            {comments.length ? <ul className="br-comments">{comments.map((c) => (
              <li key={c.id} className={c.from_client ? 'client' : 'owner'}><div className="small">{c.author_name}{c.from_client ? ' (client)' : ''} · {new Date(c.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })}</div><p>{c.body}</p></li>
            ))}</ul> : <p className="small">Your client&apos;s comments from the shared link appear here.</p>}
            <div className="field" style={{ marginTop: 10 }}><label htmlFor="b-reply">Reply</label><textarea id="b-reply" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
            <button type="button" style={{ marginTop: 8 }} disabled={!reply.trim() || !!busy} onClick={sendReply}>Post reply</button>
          </div>
          <div className="panel">
            <h2>Call sheets</h2>
            {data.callSheets.length ? data.callSheets.map((s) => <p key={s.id} className="small"><Link href={`/call-sheets/${s.id}`}>{s.title || 'Call sheet'}</Link></p>)
              : <p className="small">Use &ldquo;Make call sheet&rdquo; to start one with this brief&apos;s title, client, date and styling.</p>}
            <button type="button" className="quiet danger" onClick={remove}>Delete brief</button>
          </div>
        </div>
      </div>
      {preview ? (
        <Modal title="What your client sees" onClose={() => setPreview(false)} wide>
          <div className="shared-preview"><BriefView d={{ ...f, from: 'RAWFIILE', approved_at: brief.approved_at, approved_by: brief.approved_by, items }} imageUrl={moodboardUrl} /></div>
        </Modal>
      ) : null}
    </>
  );
}

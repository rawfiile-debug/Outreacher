'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { SharePanel } from '@/components/SharePanel';
import { useToast } from '@/components/Toast';
import { must, useQuery } from '@/components/useQuery';
import { CallSheetView } from '@/components/callsheet/CallSheetView';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { CallSheet, CrewMember, ScheduleItem } from '@/lib/types';

type Form = Omit<CallSheet, 'id' | 'created_at' | 'updated_at' | 'shared_at' | 'share_token_hash' | 'brief_id'>;
const FIELDS: (keyof Form)[] = ['title', 'client_name', 'shoot_date', 'call_time', 'wrap_time', 'location_name', 'address', 'map_url', 'parking',
  'transport', 'nearest_hospital', 'weather', 'crew', 'schedule', 'kit', 'wardrobe', 'notes', 'private_notes'];

export default function CallSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const supabase = createSupabaseBrowserClient();
  const { data, setData, error } = useQuery(async () => must(await supabase.from('studio_call_sheets').select('*').eq('id', id).single()) as CallSheet, [id]);
  const [f, setF] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (data && !f) setF(Object.fromEntries(FIELDS.map((k) => [k, (data as Record<string, unknown>)[k] ?? (k === 'crew' || k === 'schedule' ? [] : '')])) as Form);
  }, [data, f]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (error) return <div className="notice error">{error}</div>;
  if (!data || !f) return <div className="skeleton">Loading call sheet…</div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  const setCrew = (i: number, patch: Partial<CrewMember>) => set('crew', f.crew.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setSched = (i: number, patch: Partial<ScheduleItem>) => set('schedule', f.schedule.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); return a; };

  async function save() {
    if (f!.map_url && !/^https:\/\//i.test(f!.map_url)) { toast('The map link must start with https://', 'error'); return; }
    setBusy(true);
    try {
      const clean = { ...f!, shoot_date: f!.shoot_date || null, call_time: f!.call_time || null, wrap_time: f!.wrap_time || null,
        crew: f!.crew.filter((c) => c.name.trim() || c.role.trim() || c.phone.trim()),
        schedule: [...f!.schedule.filter((s) => s.time.trim() || s.item.trim())].sort((a, b) => (a.time || '99').localeCompare(b.time || '99')) };
      const row = must(await supabase.from('studio_call_sheets').update(clean).eq('id', id).select('*').single()) as CallSheet;
      setData(row); setF(null); setDirty(false); toast('Call sheet saved');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'error'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm('Delete this call sheet? Any share link stops working. This cannot be undone.')) return;
    must(await supabase.from('studio_call_sheets').delete().eq('id', id).select('id'));
    router.push('/call-sheets');
  }
  async function duplicate() {
    const { id: _id, created_at, updated_at, shared_at, share_token_hash, ...rest } = data as CallSheet;
    void _id; void created_at; void updated_at; void shared_at; void share_token_hash;
    const s = must(await supabase.from('studio_call_sheets').insert({ ...rest, title: `${rest.title} (copy)`, shoot_date: null }).select('id').single()) as { id: string };
    router.push(`/call-sheets/${s.id}`);
  }
  const field = (k: keyof Form, label: string, opts: { type?: string; full?: boolean; rows?: number; placeholder?: string; hint?: string } = {}) => (
    <div className={`field${opts.full ? ' full' : ''}`}><label htmlFor={`cs-${k}`}>{label}</label>
      {opts.rows ? <textarea id={`cs-${k}`} rows={opts.rows} value={(f[k] as string) ?? ''} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value as never)} />
        : <input id={`cs-${k}`} type={opts.type || 'text'} value={((f[k] as string) ?? '').slice(0, opts.type === 'time' ? 5 : undefined)} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value as never)} />}
      {opts.hint ? <span className="hint">{opts.hint}</span> : null}</div>
  );

  return (
    <>
      <PageHeader crumb="CALL SHEETS" title={f.title || 'Call sheet'} sub={data.brief_id ? 'Started from a brief.' : undefined}
        actions={<>
          <button type="button" onClick={() => setPreview(true)}>Preview</button>
          <button type="button" onClick={duplicate}>Duplicate</button>
          <button type="button" className="primary" onClick={save} disabled={busy || !dirty}>{busy ? <span className="spinner" /> : null} {dirty ? 'Save changes' : 'Saved'}</button>
        </>} />
      <div className="two-col">
        <div>
          <div className="panel">
            <h2>The day</h2>
            <div className="form-grid">
              {field('title', 'Shoot title', { full: true })}
              {field('client_name', 'Client')}
              {field('shoot_date', 'Date', { type: 'date' })}
              {field('call_time', 'Crew call', { type: 'time' })}
              {field('wrap_time', 'Wrap', { type: 'time' })}
              {field('weather', 'Weather', { placeholder: 'Dry, 9°C, sunset 16:40' })}
            </div>
          </div>
          <div className="panel">
            <h2>Location</h2>
            <div className="form-grid">
              {field('location_name', 'Place', { placeholder: 'Studio name or street' })}
              {field('address', 'Address', { placeholder: 'Full address and postcode' })}
              {field('map_url', 'Map link (optional)', { full: true, placeholder: 'https://maps.app.goo.gl/…', hint: 'Leave blank and the address is used instead.' })}
              {field('parking', 'Parking', { rows: 2 })}
              {field('transport', 'Getting there', { rows: 2, placeholder: 'Nearest station, bus routes' })}
              {field('nearest_hospital', 'Nearest A&E', { full: true, placeholder: "King's College Hospital, Denmark Hill, SE5 9RS" })}
            </div>
          </div>
          <div className="panel">
            <div className="section-head"><h2>Schedule</h2><button type="button" onClick={() => set('schedule', [...f.schedule, { time: '', item: '' }])}>＋ Add</button></div>
            {f.schedule.map((s, i) => (
              <div key={i} className="row-edit sched">
                <input aria-label="Time" type="time" value={s.time} onChange={(e) => setSched(i, { time: e.target.value })} />
                <input aria-label="What happens" value={s.item} placeholder="First look" onChange={(e) => setSched(i, { item: e.target.value })} />
                <input aria-label="Notes" value={s.notes || ''} placeholder="Notes" onChange={(e) => setSched(i, { notes: e.target.value })} />
                <button type="button" className="quiet" aria-label="Remove" onClick={() => set('schedule', f.schedule.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <p className="small">Sorted by time when you save.</p>
          </div>
          <div className="panel">
            <div className="section-head"><h2>Crew &amp; contacts</h2><button type="button" onClick={() => set('crew', [...f.crew, { name: '', role: '', phone: '', call: '' }])}>＋ Add</button></div>
            {f.crew.map((c, i) => (
              <div key={i} className="row-edit crew">
                <input aria-label="Name" value={c.name} placeholder="Name" onChange={(e) => setCrew(i, { name: e.target.value })} />
                <input aria-label="Role" value={c.role} placeholder="Role" onChange={(e) => setCrew(i, { role: e.target.value })} />
                <input aria-label="Phone" value={c.phone} placeholder="Phone" inputMode="tel" onChange={(e) => setCrew(i, { phone: e.target.value })} />
                <input aria-label="Call time" type="time" value={c.call || ''} onChange={(e) => setCrew(i, { call: e.target.value })} />
                <span className="row-move">
                  <button type="button" className="quiet" aria-label="Move up" disabled={i === 0} onClick={() => set('crew', move(f.crew, i, -1))}>↑</button>
                  <button type="button" className="quiet" aria-label="Remove" onClick={() => set('crew', f.crew.filter((_, j) => j !== i))}>✕</button>
                </span>
              </div>
            ))}
            {!f.crew.length ? <p className="small">Add yourself, assistants, talent, hair and make-up, and the client contact.</p> : null}
          </div>
          <div className="panel">
            <h2>Kit, styling and notes</h2>
            <div className="form-grid">
              {field('kit', 'Kit', { full: true, rows: 3, placeholder: 'Mamiya RB67, 2 x Portra 400 (120), Canon F-1, reflector' })}
              {field('wardrobe', 'Wardrobe & styling', { full: true, rows: 3 })}
              {field('notes', 'Notes for everyone', { full: true, rows: 3 })}
              {field('private_notes', 'Private notes', { full: true, rows: 2, hint: 'Only you see these. Never on the shared link.' })}
            </div>
          </div>
        </div>
        <div>
          <SharePanel kind="call_sheet" id={id} sharedAt={data.shared_at} path="s" what="call sheet" onChange={(at) => setData({ ...data, shared_at: at })} />
          {dirty ? <div className="notice warn">You have unsaved changes. Save so the shared link shows them.</div> : null}
          <div className="panel">
            <h2>More</h2>
            {data.brief_id ? <p className="small"><Link href={`/briefs/${data.brief_id}`}>Open the brief</Link></p> : null}
            <p className="small">To print or save as PDF, open the shared link and use your browser&apos;s Print.</p>
            <button type="button" className="quiet danger" onClick={remove}>Delete call sheet</button>
          </div>
        </div>
      </div>
      {preview ? (
        <Modal title="Preview" onClose={() => setPreview(false)} wide>
          <div className="cs-preview"><CallSheetView d={{ ...f, from: 'RAWFIILE', crew: f.crew, schedule: f.schedule }} /></div>
        </Modal>
      ) : null}
    </>
  );
}

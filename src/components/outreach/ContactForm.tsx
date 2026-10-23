'use client';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { must } from '@/components/useQuery';
import { CATEGORIES, STAGES, type Contact } from '@/lib/types';

type Draft = Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'notion_page_id' | 'follow_up_on' | 'follow_up_due' | 'reminder_due'>;
const blank: Draft = { name: '', company: '', role: '', email: '', phone: '', instagram: '', website: '', category: 'Agency', stage: 'To contact',
  first_emailed_on: null, followed_up_on: null, replied_on: null, remind_on: null, notes: '' };

export function ContactForm({ contact, onSaved, onDeleted, onCancel }: { contact?: Contact; onSaved: (c: Contact) => void; onDeleted?: () => void; onCancel: () => void }) {
  const [f, setF] = useState<Draft>(() => contact ? {
    name: contact.name, company: contact.company, role: contact.role, email: contact.email, phone: contact.phone, instagram: contact.instagram,
    website: contact.website, category: contact.category, stage: contact.stage, first_emailed_on: contact.first_emailed_on,
    followed_up_on: contact.followed_up_on, replied_on: contact.replied_on, remind_on: contact.remind_on, notes: contact.notes,
  } : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const supabase = createSupabaseBrowserClient();

  async function save() {
    setError('');
    if (!f.name.trim() && !f.company.trim() && !f.email.trim()) { setError('Add at least a name, company or email.'); return; }
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { setError('That email address does not look right.'); return; }
    if (f.website.trim() && !/^https?:\/\//i.test(f.website.trim())) set('website', `https://${f.website.trim()}`);
    setBusy(true);
    try {
      const values = { ...f, name: f.name.trim(), company: f.company.trim(), email: f.email.trim().toLowerCase(),
        website: f.website.trim() && !/^https?:\/\//i.test(f.website.trim()) ? `https://${f.website.trim()}` : f.website.trim(),
        instagram: f.instagram.trim().replace(/^@/, '') };
      const row = contact
        ? must(await supabase.from('studio_contacts').update(values).eq('id', contact.id).select().single())
        : must(await supabase.from('studio_contacts').insert(values).select().single());
      onSaved(row as Contact);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!contact || !confirm(`Remove ${contact.name || contact.company || contact.email} from your tracker?`)) return;
    setBusy(true);
    try { must(await supabase.from('studio_contacts').delete().eq('id', contact.id).select('id')); onDeleted?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove.'); setBusy(false); }
  }

  const date = (k: 'first_emailed_on' | 'followed_up_on' | 'replied_on' | 'remind_on', label: string, hint?: string) => (
    <div className="field"><label htmlFor={`c-${k}`}>{label}</label><input id={`c-${k}`} type="date" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value || null)} />{hint ? <span className="hint">{hint}</span> : null}</div>
  );

  return (
    <div>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="form-grid">
        <div className="field"><label htmlFor="c-name">Name</label><input id="c-name" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="c-company">Company</label><input id="c-company" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
        <div className="field"><label htmlFor="c-role">Role</label><input id="c-role" value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="Head of Production" /></div>
        <div className="field"><label htmlFor="c-email">Email</label><input id="c-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="field"><label htmlFor="c-cat">Type</label>
          <select id="c-cat" value={f.category} onChange={(e) => set('category', e.target.value as Draft['category'])}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="c-stage">Stage</label>
          <select id="c-stage" value={f.stage} onChange={(e) => set('stage', e.target.value as Draft['stage'])}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label htmlFor="c-ig">Instagram</label><input id="c-ig" value={f.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@handle" /></div>
        <div className="field"><label htmlFor="c-web">Website</label><input id="c-web" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></div>
        <div className="field"><label htmlFor="c-phone">Phone</label><input id="c-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        {date('remind_on', 'Remind me on', 'Shows on the Overview from this date')}
        {date('first_emailed_on', 'First emailed', 'Set automatically when you mark it Emailed')}
        {date('followed_up_on', 'Followed up')}
        {date('replied_on', 'Replied')}
        <div className="field full"><label htmlFor="c-notes">Notes</label><textarea id="c-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
      <div className="inline-actions" style={{ marginTop: 14 }}>
        <button type="button" className="primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : null} Save</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {contact ? <button type="button" className="quiet danger" onClick={remove} disabled={busy} style={{ marginLeft: 'auto' }}>Remove</button> : null}
      </div>
    </div>
  );
}

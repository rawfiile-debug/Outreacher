'use client';
import Link from 'next/link';
import { PageHeader } from '@/components/AppShell';
import { must, useQuery } from '@/components/useQuery';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { addDays, formatDate, formatLongDate, today } from '@/lib/dates';
import { followUpEmail, gmailComposeUrl } from '@/lib/followup';
import type { Contact } from '@/lib/types';

type Data = {
  contacts: Contact[];
  sheets: { id: string; title: string; client_name: string; shoot_date: string; call_time: string | null; shared_at: string | null }[];
  briefs: { id: string; title: string; client_name: string; shared_at: string | null; approved_at: string | null }[];
  comments: { id: number; brief_id: string; author_name: string; body: string; created_at: string; studio_briefs: { title: string } | null }[];
};

export default function OverviewPage() {
  const supabase = createSupabaseBrowserClient();
  const { data, error, loading, reload } = useQuery<Data>(async () => {
    const t = today();
    const [contacts, sheets, briefs, comments] = await Promise.all([
      supabase.from('studio_contact_list').select('*').limit(2000),
      supabase.from('studio_call_sheets').select('id, title, client_name, shoot_date, call_time, shared_at').gte('shoot_date', t).lte('shoot_date', addDays(t, 30)).order('shoot_date'),
      supabase.from('studio_briefs').select('id, title, client_name, shared_at, approved_at').not('shared_at', 'is', null).is('approved_at', null).order('updated_at', { ascending: false }).limit(10),
      supabase.from('studio_brief_comments').select('id, brief_id, author_name, body, created_at, studio_briefs(title)').eq('from_client', true).gte('created_at', addDays(t, -14)).order('created_at', { ascending: false }).limit(8),
    ]);
    return { contacts: must(contacts) as Contact[], sheets: must(sheets) as Data['sheets'], briefs: must(briefs) as Data['briefs'], comments: must(comments) as unknown as Data['comments'] };
  }, []);

  if (error) return <div className="notice error">{error} <button onClick={reload}>Retry</button></div>;
  if (loading && !data) return <div className="skeleton">Loading…</div>;
  const c = data!.contacts;
  const due = c.filter((x) => x.follow_up_due);
  const reminders = c.filter((x) => x.reminder_due && !x.follow_up_due);
  const weekAgo = addDays(today(), -7);
  const emailedThisWeek = c.filter((x) => x.first_emailed_on && x.first_emailed_on > weekAgo).length;
  const replied = c.filter((x) => ['Replied', 'Meeting', 'Won'].includes(x.stage)).length;
  const contacted = c.filter((x) => x.stage !== 'To contact').length;

  return (
    <>
      <PageHeader crumb="OVERVIEW" title="Overview" sub={formatLongDate(today())} />
      <div className="stats">
        <Link className="stat" href="/outreach"><div className="label">Follow-ups due</div><div className="value">{due.length}</div><div className="hint">a week after the first email</div></Link>
        <Link className="stat" href="/outreach"><div className="label">Emailed this week</div><div className="value">{emailedThisWeek}</div><div className="hint">first emails sent</div></Link>
        <Link className="stat" href="/outreach"><div className="label">Reply rate</div><div className="value">{contacted ? Math.round((replied / contacted) * 100) : 0}%</div><div className="hint">{replied} of {contacted} contacted</div></Link>
        <Link className="stat" href="/call-sheets"><div className="label">Shoots in 30 days</div><div className="value">{data!.sheets.length}</div><div className="hint">with call sheets</div></Link>
      </div>
      <div className="two-col">
        <div>
          <div className="panel">
            <h2>Follow up today</h2>
            {due.length || reminders.length ? [...due, ...reminders].slice(0, 12).map((x) => (
              <div key={x.id} className="suggestion">
                <div><strong>{x.name || x.company}</strong>{x.name && x.company ? ` · ${x.company}` : ''}
                  <div className="small">{x.follow_up_due ? `First emailed ${formatDate(x.first_emailed_on)}` : `Reminder set for ${formatDate(x.remind_on)}`}</div></div>
                {x.follow_up_due && x.email ? <a className="btn" href={(() => { const e = followUpEmail(x); return gmailComposeUrl(x.email, e.subject, e.body); })()} target="_blank" rel="noopener">Write follow-up</a>
                  : <Link className="btn" href="/outreach">Open</Link>}
              </div>
            )) : <p className="small">Nothing due. <Link href="/outreach">Add new contacts</Link> to keep the pipeline moving.</p>}
          </div>
          <div className="panel">
            <h2>Coming up</h2>
            {data!.sheets.length ? data!.sheets.map((s) => (
              <div key={s.id} className="suggestion">
                <div><strong>{s.title || 'Shoot'}</strong>{s.client_name ? ` · ${s.client_name}` : ''}<div className="small">{formatLongDate(s.shoot_date)}{s.call_time ? `, call ${s.call_time.slice(0, 5)}` : ''}</div></div>
                <span className="inline-actions">{s.shared_at ? <span className="status ok">Shared</span> : <span className="status warn">Not shared</span>}<Link className="btn" href={`/call-sheets/${s.id}`}>Open</Link></span>
              </div>
            )) : <p className="small">No shoots in the next 30 days.</p>}
          </div>
        </div>
        <div>
          <div className="panel">
            <h2>Briefs waiting for sign-off</h2>
            {data!.briefs.length ? data!.briefs.map((b) => <p key={b.id} className="small"><Link href={`/briefs/${b.id}`}>{b.title || 'Brief'}</Link>{b.client_name ? ` · ${b.client_name}` : ''}</p>)
              : <p className="small">None waiting.</p>}
          </div>
          <div className="panel">
            <h2>New client comments</h2>
            {data!.comments.length ? <ul className="br-comments">{data!.comments.map((m) => (
              <li key={m.id} className="client"><div className="small">{m.author_name} on <Link href={`/briefs/${m.brief_id}`}>{m.studio_briefs?.title || 'a brief'}</Link></div><p>{m.body}</p></li>
            ))}</ul> : <p className="small">No comments in the last two weeks.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

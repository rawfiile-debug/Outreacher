import { formatLongDate } from '@/lib/dates';
import type { CrewMember, ScheduleItem } from '@/lib/types';

export type CallSheetData = {
  from: string; title: string; client_name: string; shoot_date: string | null; call_time: string | null; wrap_time: string | null;
  location_name: string; address: string; map_url: string; parking: string; transport: string; nearest_hospital: string; weather: string;
  crew: CrewMember[]; schedule: ScheduleItem[]; kit: string; wardrobe: string; notes: string; updated_at?: string;
};

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;
const mapsLink = (d: CallSheetData) => d.map_url || (d.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}` : '');

/** The call sheet as the crew sees it: phone-first, and prints on A4. Used by the shared link and the owner preview. */
export function CallSheetView({ d }: { d: CallSheetData }) {
  const map = mapsLink(d);
  const block = (label: string, value: string) => (value ? <div className="cs-block"><div className="cs-label">{label}</div><div className="cs-text">{value}</div></div> : null);
  return (
    <article className="callsheet">
      <header className="cs-head">
        <div className="cs-brand">{d.from.toUpperCase()} · CALL SHEET</div>
        <h1>{d.title || 'Call sheet'}</h1>
        {d.client_name ? <div className="cs-client">for {d.client_name}</div> : null}
      </header>
      <section className="cs-key">
        <div><div className="cs-label">Date</div><div className="cs-big">{d.shoot_date ? formatLongDate(d.shoot_date) : 'TBC'}</div></div>
        <div><div className="cs-label">Call time</div><div className="cs-big">{hhmm(d.call_time) || 'TBC'}</div></div>
        <div><div className="cs-label">Wrap</div><div className="cs-big">{hhmm(d.wrap_time) || 'TBC'}</div></div>
      </section>
      <section className="cs-section">
        <h2>Location</h2>
        <div className="cs-text"><strong>{d.location_name || 'TBC'}</strong>{d.address ? <><br />{d.address}</> : null}</div>
        {map ? <a className="btn cs-map" href={map} target="_blank" rel="noopener noreferrer">Open in Maps</a> : null}
        <div className="cs-grid">{block('Parking', d.parking)}{block('Getting there', d.transport)}{block('Weather', d.weather)}{block('Nearest A&E', d.nearest_hospital)}</div>
      </section>
      {d.schedule.length ? (
        <section className="cs-section">
          <h2>Schedule</h2>
          <table className="cs-table cs-sched"><tbody>{d.schedule.map((s, i) => (
            <tr key={i}><td className="cs-time">{s.time}</td><td>{s.item}{s.notes ? <div className="cs-note">{s.notes}</div> : null}</td></tr>
          ))}</tbody></table>
        </section>
      ) : null}
      {d.crew.length ? (
        <section className="cs-section">
          <h2>Crew &amp; contacts</h2>
          <table className="cs-table cs-crew"><thead><tr><th>Name</th><th>Role</th><th>Call</th><th>Phone</th></tr></thead><tbody>{d.crew.map((c, i) => (
            <tr key={i}><td><strong>{c.name}</strong></td><td>{c.role}</td><td className="cs-time">{c.call}</td>
              <td>{c.phone ? <a href={tel(c.phone)}>{c.phone}</a> : null}</td></tr>
          ))}</tbody></table>
        </section>
      ) : null}
      {d.kit || d.wardrobe ? <section className="cs-section cs-grid">{block('Kit', d.kit)}{block('Wardrobe & styling', d.wardrobe)}</section> : null}
      {d.notes ? <section className="cs-section">{block('Notes', d.notes)}</section> : null}
      {d.updated_at ? <footer className="cs-foot">Last updated {new Date(d.updated_at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })}. Check this link on the day for any changes.</footer> : null}
    </article>
  );
}

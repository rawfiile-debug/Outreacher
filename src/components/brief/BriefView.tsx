import { formatLongDate } from '@/lib/dates';

export type BriefData = {
  from: string; title: string; client_name: string; shoot_date: string | null; deadline: string | null; objective: string; audience: string;
  deliverables: string; mood: string; palette: string[]; styling: string; locations: string; references_text: string; dos: string; donts: string;
  approved_at: string | null; approved_by: string;
  items: { kind: 'image' | 'link' | 'note'; storage_path: string | null; url: string; caption: string }[];
};

const linkLabel = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** The brief and moodboard as the client sees them. imageUrl turns a stored path into a public image address. */
export function BriefView({ d, imageUrl }: { d: BriefData; imageUrl: (path: string) => string }) {
  const sec = (label: string, v: string) => (v ? <section className="br-section"><h2>{label}</h2><p>{v}</p></section> : null);
  return (
    <article className="brief">
      <header className="br-head">
        <div className="cs-brand">{d.from.toUpperCase()} · CREATIVE BRIEF</div>
        <h1>{d.title || 'Creative brief'}</h1>
        <div className="br-meta">
          {d.client_name ? <span>For {d.client_name}</span> : null}
          {d.shoot_date ? <span>Shoot {formatLongDate(d.shoot_date)}</span> : null}
          {d.deadline ? <span>Delivery by {formatLongDate(d.deadline)}</span> : null}
        </div>
      </header>
      {sec('What this is for', d.objective)}
      {sec('Who it is for', d.audience)}
      {sec('Deliverables', d.deliverables)}
      {d.mood || d.palette.length ? (
        <section className="br-section"><h2>Mood</h2>{d.mood ? <p>{d.mood}</p> : null}
          {d.palette.length ? <div className="br-palette">{d.palette.map((c) => <div key={c} className="br-swatch"><span style={{ background: c }} /><code>{c}</code></div>)}</div> : null}
        </section>
      ) : null}
      {d.items.length ? (
        <section className="br-section"><h2>Moodboard</h2>
          <div className="br-board">{d.items.map((it, i) => it.kind === 'image' && it.storage_path ? (
            <figure key={i} className="br-tile"><img src={imageUrl(it.storage_path)} alt={it.caption || 'Moodboard reference'} loading="lazy" />{it.caption ? <figcaption>{it.caption}</figcaption> : null}</figure>
          ) : it.kind === 'link' ? (
            <a key={i} className="br-tile br-link" href={it.url} target="_blank" rel="noopener noreferrer"><span className="small">{linkLabel(it.url)} ↗</span><strong>{it.caption || it.url}</strong></a>
          ) : (
            <div key={i} className="br-tile br-note">{it.caption}</div>
          ))}</div>
        </section>
      ) : null}
      {sec('Styling', d.styling)}
      {sec('Locations', d.locations)}
      {sec('References', d.references_text)}
      {d.dos || d.donts ? (
        <section className="br-section br-two">
          {d.dos ? <div><h2>Do</h2><p>{d.dos}</p></div> : null}
          {d.donts ? <div><h2>Avoid</h2><p>{d.donts}</p></div> : null}
        </section>
      ) : null}
    </article>
  );
}

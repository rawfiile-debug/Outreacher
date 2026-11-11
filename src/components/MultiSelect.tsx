'use client';
import { useEffect, useRef, useState } from 'react';
import type { Option } from '@/lib/outreach';

/** A dropdown box where several options can be ticked. */
export function MultiSelect({ label, options, value, onChange, disabled }: {
  label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const chosen = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="field multi" ref={box}>
      <label>{label}</label>
      <button type="button" className="multi-button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{chosen.length ? (chosen.length > 2 ? `${chosen.slice(0, 2).join(', ')} +${chosen.length - 2}` : chosen.join(', ')) : 'Choose…'}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="multi-menu" role="listbox" aria-multiselectable="true">
          {options.map((o) => (
            <label key={o.value} className="check"><input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}</label>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="quiet" onClick={() => onChange(options.map((o) => o.value))}>All</button>
            <button type="button" className="quiet" onClick={() => onChange([])}>None</button>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

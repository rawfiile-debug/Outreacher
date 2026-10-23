'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs an async loader (usually a Supabase query) and keeps its result, error and a reload function. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try { const v = await run(); if (n === seq.current) { setData(v); setError(null); } }
    catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : 'Could not load this. Check your connection.'); }
    finally { if (n === seq.current) setLoading(false); }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Supabase returns { data, error }: throw a readable error, or return the data. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(friendlyDbError(res.error));
  return res.data as T;
}

export function friendlyDbError(e: { message: string; code?: string }): string {
  if (e.code === '23505') return /email/.test(e.message) ? 'That email is already in your tracker.' : 'That already exists.';
  if (e.code === '23514') {
    if (/has_name/.test(e.message)) return 'Add at least a name, company or email.';
    if (/map_url/.test(e.message) || /url_check/.test(e.message)) return 'Links must start with https://';
    if (/palette/.test(e.message)) return 'Colours must be hex codes like #18263D.';
    return 'Some values are too long or not valid. Please check the form.';
  }
  if (e.code === 'PGRST301' || /JWT/.test(e.message)) return 'Please sign in again.';
  return e.message || 'Something went wrong. Nothing was changed.';
}

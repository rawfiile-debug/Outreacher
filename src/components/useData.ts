'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api-client';

// Remembers the last answer for each endpoint while the app is open, so going back to a page shows its data
// straight away and refreshes it quietly in the background, instead of flashing "Loading…" on every visit.
// Lives in memory only: it is gone on reload, and cleared on sign-out.
const cache = new Map<string, unknown>();

export function clearDataCache() {
  cache.clear();
}

const DATA_CHANGED = 'rawfiile:data-changed';
/** Tells every page on screen to reload its data, e.g. after Gmail confirmed an invoice was sent. */
export function notifyDataChanged() {
  cache.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED));
}

/**
 * Loads a JSON endpoint. Shows the last known data instantly (if any), then refreshes it.
 * Pass { cached: false } on pages that copy the data into an editable form, so a background refresh can never
 * overwrite what is being typed.
 */
export function useData<T>(path: string | null, opts: { cached?: boolean } = {}) {
  const useCache = opts.cached !== false;
  const [data, setDataState] = useState<T | null>(() => (useCache && path && cache.has(path) ? (cache.get(path) as T) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const fresh = await api<T>(path);
      cache.set(path, fresh);
      // Ignore answers for a path the page has already moved away from (e.g. a filter changed mid-request).
      if (latest.current === path) {
        setDataState(fresh);
        setError(null);
      }
    } catch (e) {
      if (latest.current === path) setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (useCache && path && cache.has(path)) setDataState(cache.get(path) as T);
    load();
  }, [load, path, useCache]);

  useEffect(() => {
    const onChange = () => { load(); };
    window.addEventListener(DATA_CHANGED, onChange);
    return () => window.removeEventListener(DATA_CHANGED, onChange);
  }, [load]);

  // Local edits (optimistic updates) are kept in the cache too, so they survive a page change.
  const setData = useCallback((next: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => {
      const value = typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next;
      if (path) {
        if (value === null) cache.delete(path); else cache.set(path, value);
      }
      return value;
    });
  }, [path]);

  return { data, error, loading, reload: load, setData };
}

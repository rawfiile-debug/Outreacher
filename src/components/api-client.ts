'use client';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Fetch wrapper for the app's own API. Errors always carry a readable message. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    res = await fetch(path, {
      signal: ctrl?.signal,
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    if (ctrl?.signal.aborted) throw new ApiError('The server took too long to answer.', 0, 'timeout');
    throw new ApiError('Could not reach the server. Check your connection. Nothing was saved.', 0, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data as T;
}

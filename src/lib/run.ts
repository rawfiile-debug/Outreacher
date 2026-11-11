'use client';
// Asks the server to start Claude's Outreacher task now. Returns a short message for a toast.
export async function runNow(kind: 'build_profile' | 'draft_grant' | 'find_grants' | 'check_gigs'): Promise<{ started: boolean; message: string }> {
  try {
    const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
    const j = (await res.json()) as { ok: boolean; started?: boolean; error?: string; note?: string };
    if (j.ok) return { started: true, message: 'Started. Claude is working on it now; it usually takes a few minutes.' };
    if (j.error === 'not_configured') return { started: false, message: 'Queued. Instant start is not set up yet, so it runs at the next scheduled time.' };
    return { started: false, message: j.error || 'Queued for the next scheduled run.' };
  } catch {
    return { started: false, message: 'Queued for the next scheduled run.' };
  }
}

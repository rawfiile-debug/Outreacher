import { ownerRoute, HttpError } from '@/lib/api';
import { autopilotReady } from '@/lib/env';
import { runTick } from '@/lib/autopilot/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

// "Run now" on the Autopilot page: one step for the signed-in account straight away.
export const POST = ownerRoute(async (_req, { user }) => {
  if (!autopilotReady.server) throw new HttpError(409, 'The server is not fully set up yet (SUPABASE_SECRET_KEY and CRON_SECRET).');
  const report = await runTick({ ownerId: user.id, budgetMs: 50_000 });
  return { log: report[user.id.slice(0, 8)] || ['Autopilot is switched off. Switch it on first.'] };
});

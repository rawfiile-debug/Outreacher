import { ownerRoute } from '@/lib/api';
import { autopilotReady } from '@/lib/env';

// Which parts of the autopilot the server is set up for (no secrets, just yes or no).
export const GET = ownerRoute(async () => autopilotReady);

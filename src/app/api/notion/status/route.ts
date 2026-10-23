import { ownerRoute } from '@/lib/api';
import { notionConfigured } from '@/lib/env';

export const GET = ownerRoute(async () => ({ configured: notionConfigured }));

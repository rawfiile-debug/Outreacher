import 'server-only';
import { createHash } from 'node:crypto';

export const sha256HexServer = (text: string) => createHash('sha256').update(text).digest('hex');

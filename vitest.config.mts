import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'], testTimeout: 30000 },
});

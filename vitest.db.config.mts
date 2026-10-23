import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/db/**/*.test.ts'], testTimeout: 30000, fileParallelism: false } });

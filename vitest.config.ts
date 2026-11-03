import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // Integration tests share one database: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

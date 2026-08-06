import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration cases talk to a real database and must not race each other.
    fileParallelism: false,
  },
});

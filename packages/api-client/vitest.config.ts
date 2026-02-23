import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 36,
        branches: 40,
        functions: 40,
        lines: 36,
      },
    },
  },
});

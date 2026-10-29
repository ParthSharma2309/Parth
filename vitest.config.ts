import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 10000,
    env: {
      GEMINI_API_KEY: 'test-key',
      NODE_ENV: 'test',
      FIREBASE_PROJECT_ID: 'test-project',
    },
  },
});

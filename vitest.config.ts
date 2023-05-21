/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [],
  test: {
    globals: true,
    include: ['./src/**/*.spec.ts'],
    coverage: {
      provider: 'istanbul',
    },
  },
});

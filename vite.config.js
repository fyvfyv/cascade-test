import { defineConfig } from 'vitest/config';

export default defineConfig({
  publicDir: 'assets',
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});

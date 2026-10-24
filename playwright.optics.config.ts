import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'optics-libraries.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'artifacts/modular-optics-v1/browser-results',
  use: { viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
});

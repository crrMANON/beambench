import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'detailed-models.spec.ts', workers: 1,
  timeout: 180_000, retries: 0, reporter: [['list']],
  outputDir: 'artifacts/detailed-models-20261024/browser-results',
  projects: [
    { name: 'original-pixels', grep: /original visual protection/, use: { launchOptions: { channel: undefined } } },
    { name: 'detailed-functionality', grepInvert: /original visual protection/ },
  ],
  use: { viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure',
    launchOptions: { channel: process.env.BB_BROWSER_CHANNEL || 'chrome' } },
});

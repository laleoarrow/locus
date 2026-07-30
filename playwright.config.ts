import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  // Each test launches its own persistent context with the extension loaded;
  // keep them serial to avoid profile contention.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node e2e/serve.mjs',
    port: 8137,
    reuseExistingServer: true,
  },
});

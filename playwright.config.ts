import { defineConfig, devices } from '@playwright/test';

/**
 * Local smoke suite — run with `npm run test:smoke`.
 *
 * Boots the real dev server (`npm run dev`, which loads .env.local and talks
 * to live Neon through the api bridge) and drives the real unlock + editor
 * flow. Every `/api/ai` call is intercepted with a canned draft, so the suite
 * never spends OpenRouter quota and stays deterministic. See tests/smoke/ for
 * credentials handling and cleanup.
 */
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // devices['Desktop Chrome'] sets a 1280x720 viewport — re-assert ours after the spread.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

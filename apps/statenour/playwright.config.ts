/**
 * Playwright config — E2E smoke tests for v7+ surfaces.
 *
 * Run: `pnpm exec playwright test`
 * Install browsers: `pnpm exec playwright install --with-deps`
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // No webServer here — assumes dev server is already running.
  // E2E_BASE_URL selects the target. In CI (e2e-statenour.yml) it points at
  // the HERMETIC localhost dev server that workflow starts — not a deployed
  // preview. The deployed-preview variant is an optional operator-keyed
  // extra. Corrected 2026-07-28: this said CI runs against a preview URL,
  // which has not been true since 75920fba8.
});

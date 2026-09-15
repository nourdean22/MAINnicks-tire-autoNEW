/**
 * Playwright — nickstire's deterministic browser layer.
 *
 * Two suites live under tests/e2e:
 *   · critical-pages.spec.ts — the Tier-1 pages from
 *     docs/eval-rubrics/visual-regression.md, three viewports each, with
 *     screenshots written for Argos and a11y invariants asserted inline.
 *   · episodes.spec.ts — the Experience Gym: tests/episodes/*.json replayed
 *     as goal + tap/time budget + success oracle.
 *
 * Targets the LIVE site by default (E2E_BASE_URL overrides): these are
 * post-deploy and scheduled canaries, not a hermetic PR gate — nickstire has
 * no hermetic server (prod TiDB only). Run: `pnpm exec playwright test`.
 * Browsers: `pnpm exec playwright install chromium`.
 *
 * NOT picked up by vitest: vitest.config.ts includes server/**, shared/** and
 * client/src/__tests__/** only, and these specs import @playwright/test.
 */
import { defineConfig, devices } from "@playwright/test";

const MOBILE = {
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: devices["iPhone 14"].userAgent,
};

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"], ["json", { outputFile: "test-results/results.json" }]] : "list",
  timeout: 45_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://nickstire.org",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  // One engine (Chromium) at the three viewports the spec names. Playwright's
  // iPhone device profiles run WebKit, whose headless build reports the PWA
  // service worker's fetch failures as page errors ("FetchEvent.respondWith
  // received an error: Load failed") against the live site — noise that would
  // hide a real regression. Real-WebKit behaviour is the real-device canary's
  // job (sitespeed/android-canary.sh + the operator's own phone), not this one.
  projects: [
    { name: "iphone-se", use: { ...devices["Desktop Chrome"], ...MOBILE, viewport: { width: 375, height: 667 } } },
    { name: "iphone-14", use: { ...devices["Desktop Chrome"], ...MOBILE, viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});

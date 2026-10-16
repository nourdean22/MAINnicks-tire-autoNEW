/**
 * Playwright — nickstire's deterministic browser layer.
 *
 * Specs under tests/e2e:
 *   · critical-pages.spec.ts — the Tier-1 pages from
 *     docs/eval-rubrics/visual-regression.md, three viewports each, with
 *     screenshots written for Argos and a11y invariants asserted inline.
 *   · episodes.spec.ts — the Experience Gym: tests/episodes/*.json replayed
 *     as goal + tap/time budget + success oracle.
 *   · instagram-admin.spec.ts — authenticated admin QA; skips without
 *     E2E_ADMIN_STORAGE_STATE.
 *   · admin-v1-fixtures.spec.ts / admin-v1-gate.spec.ts — the admin rendered
 *     from DEMO fixtures against a local `vite build`, no live site (they set
 *     their own baseURL and skip or opt in on their own; see their headers).
 *
 * The live-site specs target nickstire.org by default (E2E_BASE_URL overrides):
 * post-deploy and scheduled canaries, not a hermetic PR gate — nickstire has
 * no hermetic server (prod TiDB only). Run: `pnpm exec playwright test`.
 * Browsers: `pnpm exec playwright install chromium`.
 *
 * vitest and Playwright split tests/e2e by suffix: Playwright collects only
 * *.spec.ts (testMatch below); vitest.config.ts includes tests/e2e/**\/*.test.ts,
 * the unit tests of the admin v1 helpers (distance measure, fixture router).
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
  // Specs only: tests/e2e also holds vitest unit tests (*.test.ts) for the pure
  // helpers of the admin v1 fixture lane, which import vitest, not Playwright.
  testMatch: "**/*.spec.ts",
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

/**
 * tests/e2e/chat-states.spec.ts — chat-state visual baselines
 * (2026-07-29 · next-queue item 5).
 *
 * ─────────────────────────────────────────────────────────────────
 * BASELINES ARE NOT COMMITTED YET. This environment had no Playwright
 * browser binaries and no running dev server, so the screenshots were
 * never generated — committing invented baseline files would be a lie
 * the first real run would expose. Generate them once, locally:
 *
 *   pnpm test:e2e:install          # one-time chromium download
 *   pnpm dev                       # separate shell — config assumes :3001
 *   pnpm exec playwright test chat-states --update-snapshots
 *
 * Then commit the produced tests/e2e/chat-states.spec.ts-snapshots/.
 * Until then this spec FAILS LOUDLY with "snapshot missing" — which is
 * Playwright's designed bootstrap, and it gates nothing: `verify:hard`
 * runs vitest only, never test:e2e.
 *
 * WHAT IS VERIFIED WITHOUT A BROWSER: the target page renders REAL
 * components against module-level fixtures (no network, no DB), and
 * every selector below is a literal from
 * app/(mastery)/system/chat-states/page.tsx.
 *
 * WHY CLOCK-FREEZING: the page seeds `FRESH_FETCHED_AT` from
 * Date.now() and the evidence panel renders toLocaleTimeString() —
 * a naive screenshot would flake every single run. page.clock pins the
 * wall clock before the app boots so the rendered timestamp is stable.
 * ─────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";

const PAGE = "/system/chat-states";
/** Fixed instant so time-derived text renders identically every run. */
const FROZEN = new Date("2026-07-29T12:00:00Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN);
});

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of viewports) {
  test.describe(`chat states · ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("full page — typed cards, unregistered-tool fallback, receipts", async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.getByRole("heading", { name: "Chat States" })).toBeVisible();
      // The fixture page is static after hydration; waiting on the last
      // section's heading is a real readiness signal, not a sleep.
      await expect(page.getByText("Completion message — receipts sample")).toBeVisible();
      await expect(page).toHaveScreenshot(`chat-states-${vp.name}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });

    test("evidence panel — fresh recall (open state)", async ({ page }) => {
      await page.goto(PAGE);
      await page.getByRole("button", { name: "Open — fresh recall" }).click();
      await expect(page.getByText("Context & Evidence")).toBeVisible();
      await expect(page).toHaveScreenshot(`evidence-fresh-${vp.name}.png`, {
        animations: "disabled",
      });
    });

    test("evidence panel — never fetched (honest empty state)", async ({ page }) => {
      await page.goto(PAGE);
      await page.getByRole("button", { name: "Open — never fetched" }).click();
      // The honesty contract this baseline protects: an unfetched panel
      // must say so rather than rendering as evidence.
      await expect(page.getByText("not yet fetched — open state, not evidence")).toBeVisible();
      await expect(page).toHaveScreenshot(`evidence-unfetched-${vp.name}.png`, {
        animations: "disabled",
      });
    });
  });
}

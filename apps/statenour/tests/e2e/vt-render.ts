/**
 * vt-render · the page-render helper of the v3 gate (2026-10-15, UI v3 W0b).
 *
 * DEBT: renderPage below is a COPY of renderPage in
 * tests/e2e/visible-transformation.spec.ts (the v2 gate), which stays untouched
 * for this wave. A baseline is only comparable with a later render if both were
 * taken with the same settle logic, so keep the two in step until the v2 spec is
 * retired, then delete the copy there. The one addition is VT_CONTEXT (see below).
 *
 * The v2 header explains the settle logic; the short version: a capture taken
 * while a skeleton is on screen measures a placeholder, so the page must leave
 * its loading state (placeholder AREA under 1.5% of the viewport) or the
 * capture fails loudly instead of measuring.
 */
import { expect, type Browser, type Page } from "@playwright/test";

import { installFixtures } from "./fixtures";

/**
 * Locale and timezone the fixture renders are taken in. v2 baselines took the
 * runner's defaults; the fixtures describe a clock in America/New_York, and a
 * date label must not depend on which machine took the capture.
 */
export const VT_CONTEXT = { locale: "en-US", timezoneId: "America/New_York" } as const;

/**
 * Dev-only React hydration mismatches are recovered by a client re-render and
 * never reach production as a thrown error; they are a separate defect class
 * (tracked, not gated here). Every other uncaught error fails the capture.
 */
export const IGNORED_PAGE_ERRORS = /hydration/i;

/** Wave 0b covers Home and Missions only; Chat, Brain, People and System come later. */
export const V3_PAGES: { key: string; path: string; landmark: string }[] = [
  { key: "home", path: "/", landmark: "main" },
  { key: "missions", path: "/missions", landmark: "main" },
];

export const V3_VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "phone", width: 390, height: 844 },
];

export async function renderPage(page: Page, route: string, landmark: string): Promise<Buffer> {
  // A page that threw is not a page: uncaught errors fail the capture. (The dev
  // overlay host <nextjs-portal> exists on EVERY dev render, so its presence
  // proves nothing: listen for the errors themselves.)
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    if (!IGNORED_PAGE_ERRORS.test(err.message)) pageErrors.push(err.message);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${route} must respond 200`).toBe(200);
  await expect(page.locator(landmark).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/application error/i)).toHaveCount(0);
  // Let the first data round-trip land (a deck skeleton is not the deck), then
  // let fonts settle without waiting on the pollers.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // ...and for the placeholders to leave: a skeleton root (`data-skeleton`), a
  // busy region (`aria-busy`) or a pulsing placeholder still on screen means the
  // capture would measure loading chrome, not the page. "Settled" is measured by
  // AREA, not by count: a pulsing 8px status dot is not loading chrome, a 700x80
  // skeleton block is. Placeholders covering more than 1.5% of the viewport keep
  // the page in its loading state.
  const settled = await page
    .waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-skeleton], [aria-busy="true"], .animate-pulse');
        let area = 0;
        for (const el of els) {
          const r = (el as HTMLElement).getBoundingClientRect();
          area += Math.max(0, r.width) * Math.max(0, r.height);
        }
        return area / (window.innerWidth * window.innerHeight) < 0.015;
      },
      undefined,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  expect(settled, `${route} never left its loading state within 60s: not measured`).toBe(true);
  await page.waitForTimeout(1500);
  expect(pageErrors, `${route} threw during render`).toEqual([]);
  return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

/**
 * Warm every route once before measuring. `next dev` compiles a route on its
 * first hit after any edit, and a capture that races that compile lands while
 * the page is still hydrating. Warming is not measuring: nothing is compared.
 * Fixtures are installed so the warm-up never reads the (empty) database.
 */
export async function warmRoutes(
  browser: Browser,
  viewport: { width: number; height: number },
  paths: string[],
): Promise<void> {
  const ctx = await browser.newContext({ viewport, ...VT_CONTEXT });
  const page = await ctx.newPage();
  await installFixtures(page);
  for (const p of paths) {
    await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }
  await ctx.close();
}

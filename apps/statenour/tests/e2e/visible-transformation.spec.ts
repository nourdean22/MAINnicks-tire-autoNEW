/**
 * Visible Transformation gate (2026-09-16, W7).
 *
 * The workbench waves (#2337, #2341, #2344) shipped an object substrate that
 * is inert until something is inspected — so the pages kept looking like
 * StateNour before. The operator's bar for the redesign: "If I put a
 * screenshot of old and new side-by-side from six feet away, can I
 * immediately tell which is the redesigned StateNour? If not, that PR does
 * not count as UI redesign."
 *
 * This spec is that bar as a test. For each flagship page at desktop and
 * phone width it renders the page on the hermetic stack (empty DB, mock
 * auth — the same stack e2e CI runs), and asserts the render is at least
 * MIN_DISTANCE away from the committed PRE-wave baseline in
 * `visible-transformation.spec.ts-snapshots/`. The inverse of a snapshot
 * test: looking the same is the failure. Two guards keep a broken page from
 * passing by accident: the response must be 200 with the page's landmark
 * rendered, and the render must carry enough ink to be a page at all.
 *
 * The distance is the registered ink-mass distance of ./visual-distance.ts
 * (a translation-tolerant comparison of six-feet-away luminance grids; the
 * calibration numbers and the reason a pixel count cannot work on a
 * void-black UI are in its header).
 *
 * Baselines are the PRE-transformation renders and must never be
 * regenerated casually: `VT_UPDATE_BASELINES=1` rewrites them (used once,
 * on the tree before the wave, from the same hermetic stack). A missing
 * baseline is a hard failure, not a silent write.
 *
 * Controls (2026-09-16, hermetic stack): two renders of the same tree score
 * 0.000 on every page (the noise floor); the pre-wave baselines shifted by
 * 16–64px score 0.11–0.26; the recomposed pages score 0.50–0.61. The unit
 * canary for the instrument itself is tests/repo/visual-distance-metric.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { inkCoverage, visualDistance } from "./visual-distance";

const SNAPSHOT_DIR = path.join(__dirname, "visible-transformation.spec.ts-snapshots");
const UPDATE = process.env.VT_UPDATE_BASELINES === "1";

/**
 * The registered ink-mass distance a page must have moved. 0.35 sits above
 * every pure-translation control (max 0.264) and below every recomposed
 * page measured (min 0.498) — see the calibration in ./visual-distance.ts.
 */
const MIN_DISTANCE = 0.35;
/**
 * A rendered page has ink; a void screen or a bare error line does not. The
 * house palette is void-black with a narrow content column, so a real
 * desktop page carries only ~1.5–4% non-black pixels (measured 2026-09-16:
 * people 0.015, home 0.025, system 0.030, missions 0.037); the bottom chrome
 * alone is ~0.005.
 */
const MIN_INK = 0.012;
/**
 * Dev-only React hydration mismatches are recovered by a client re-render and
 * never reach production as a thrown error; they are a separate defect class
 * (tracked, not gated here). Every other uncaught error fails the capture.
 */
const IGNORED_PAGE_ERRORS = /hydration/i;

const PAGES: { key: string; path: string; landmark: string }[] = [
  { key: "home", path: "/", landmark: "main" },
  { key: "missions", path: "/missions", landmark: "main" },
  { key: "brain", path: "/brain", landmark: "main" },
  { key: "people", path: "/people", landmark: "main" },
  { key: "system", path: "/system", landmark: "main" },
];

const VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "phone", width: 390, height: 844 },
];

async function renderPage(page: Page, route: string, landmark: string): Promise<Buffer> {
  // A page that threw is not a page: uncaught errors fail the capture. (The dev
  // overlay host <nextjs-portal> exists on EVERY dev render, so its presence
  // proves nothing — listen for the errors themselves.)
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    if (!IGNORED_PAGE_ERRORS.test(err.message)) pageErrors.push(err.message);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${route} must respond 200`).toBe(200);
  await expect(page.locator(landmark).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/application error/i)).toHaveCount(0);
  // Let the first data round-trip land (a deck skeleton is not the deck — a
  // capture taken mid-load measures a placeholder), then let fonts settle
  // without waiting on the pollers.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // …and for the placeholders to leave: a skeleton root (`data-skeleton`), a
  // busy region (`aria-busy`) or a pulsing placeholder still on screen means
  // the capture would measure loading chrome, not the page. Measured
  // 2026-09-16 on the hermetic stack: Home hydrates ~3.5s after the landmark
  // and its brief batch lands ~11s after that, later under load. A page that
  // never settles is NOT measured — a skeleton scored 0.34 / 1.3% ink once,
  // which is a false reading, not a verdict — so this fails loudly instead.
  // "Settled" is measured by AREA, not by count: a pulsing 8px status dot
  // (severed-lane markers, live chips) is not loading chrome, a 700×80
  // skeleton block is. Placeholders covering more than 1.5% of the viewport
  // keep the page in its loading state.
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
  expect(settled, `${route} never left its loading state within 60s — not measured`).toBe(true);
  await page.waitForTimeout(1500);
  expect(pageErrors, `${route} threw during render`).toEqual([]);
  return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

for (const vp of VIEWPORTS) {
  test.describe(`visible transformation · ${vp.key} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    // A cold `next dev` compiles a flagship route in 20–30s on first hit and a
    // loaded Home lands ~15s after that under load; the default 30s budget
    // expired inside the settle wait and reported a page that was never
    // measured (2026-09-16). The budget covers compile + settle; it is not a pass.
    test.setTimeout(120_000);

    // Warm every route once before measuring. `next dev` compiles a route on
    // its first hit after any edit (Home: 17–29s measured 2026-09-16), and a
    // capture that races that compile lands while the page is still hydrating
    // — a skeleton with a 0.34 distance and 1.3% ink is not a measurement.
    // Warming is not measuring: nothing here is compared.
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(10 * 60_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      for (const p of PAGES) {
        await page.goto(p.path, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      }
      await ctx.close();
    });

    for (const p of PAGES) {
      test(`${p.key} looks unmistakably different from the pre-wave baseline`, async ({ page }) => {
        const file = path.join(SNAPSHOT_DIR, `${p.key}-${vp.key}.png`);
        const current = await renderPage(page, p.path, p.landmark);

        // Optional: keep the current render for a human to look at (never a baseline).
        const outDir = process.env.VT_OUT_DIR;
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, `${p.key}-${vp.key}.png`), current);
        }

        if (UPDATE) {
          fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
          fs.writeFileSync(file, current);
          test.info().annotations.push({ type: "baseline", description: `wrote ${path.basename(file)}` });
          return;
        }

        expect(
          fs.existsSync(file),
          `missing baseline ${path.relative(process.cwd(), file)} — generate it ONCE from the pre-wave tree with VT_UPDATE_BASELINES=1`,
        ).toBe(true);
        const baseline = fs.readFileSync(file);

        const ink = await inkCoverage(current, vp);
        expect(ink, `${p.key}/${vp.key}: render carries too little ink to be a page (${ink.toFixed(3)})`).toBeGreaterThan(MIN_INK);

        const d = await visualDistance(baseline, current, vp);
        test.info().annotations.push({
          type: "distance",
          description: `${p.key}/${vp.key}: ink-mass distance ${(d.ratio * 100).toFixed(1)}% on a ${d.cols}×${d.rows} grid (best registration ${d.shift.dx},${d.shift.dy})`,
        });
        console.log(`[visible-transformation] ${p.key}/${vp.key} distance=${d.ratio.toFixed(3)} ink=${ink.toFixed(3)}`);
        expect(
          d.ratio,
          `${p.key}/${vp.key} still looks like pre-wave StateNour: ink-mass distance ${(d.ratio * 100).toFixed(1)}% (need ≥ ${MIN_DISTANCE * 100}%)`,
        ).toBeGreaterThanOrEqual(MIN_DISTANCE);
      });
    }
  });
}

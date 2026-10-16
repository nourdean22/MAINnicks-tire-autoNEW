/**
 * Admin v1 six-feet gate (W0b instrument, used from W2 on).
 *
 * Renders Today, Lot and Approvals from the DEMO fixtures (same harness as
 * admin-v1-fixtures.spec.ts) and compares each render to the FROZEN pre-W1 render
 * in tests/e2e/admin-v1-baselines/<page>-<viewport>.png with the registered
 * ink-mass distance (admin-v1-distance.ts). The gate demands DIFFERENCE: Today and
 * Lot must score at least 0.35 (PLAN section 1); Approvals is reported, not gated.
 *
 *   ADMIN_V1_GATE=1                       compare each render to its baseline
 *   ADMIN_V1_GATE=1 ADMIN_V1_CAPTURE=1    write the renders as the baselines instead
 *
 * The baselines are captured in CI (nickstire-proof.yml, workflow_dispatch input
 * capture_admin_v1_baselines) so fonts and rasterising match the runner; a local
 * capture is for looking only and is never committed.
 *
 * Controls run in both modes, per viewport, on real renders, and print their
 * numbers: a re-render of the same page (must be under 0.02), the same render slid
 * by statenour's calibration shifts (must stay under 0.35), and a different admin
 * page (reported as the recomposed reference). A measure that cannot tell a slide
 * from a redesign fails here before it can pass or fail a wave.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { visualDistance } from "./admin-v1-distance";
import { FIXTURE_ORIGIN, PAGES, serveAdminFixtures } from "./fixtures/admin-v1/serve";
import { collectFirstPartyErrors } from "./helpers";

const ENABLED = process.env.ADMIN_V1_GATE === "1";
const CAPTURE = process.env.ADMIN_V1_CAPTURE === "1";
const BASELINE_DIR = path.resolve("tests/e2e/admin-v1-baselines");
const MIN_DISTANCE = 0.35;
const MAX_RERENDER = 0.02;
/** Pages whose distance is gated; the rest are printed only. */
const GATED = new Set(["overview", "lot"]);
/** statenour's calibration shifts (visual-distance.ts header), in CSS px. */
const SHIFTS: Record<string, Array<[number, number]>> = { "390": [[16, 0], [0, 40]], "1440": [[32, 16], [64, 40]] };

const ANCHOR: Record<string, string> = {
  overview: "Terrell Washington",
  lot: "FIX 1003",
  approvals: "Call Aisha Brooks back about two used tires",
};

test.use({ baseURL: FIXTURE_ORIGIN, serviceWorkers: "block", timezoneId: "America/New_York", locale: "en-US" });
test.skip(!ENABLED, "the admin v1 six-feet gate is opt-in: set ADMIN_V1_GATE=1 (and ADMIN_V1_CAPTURE=1 to capture baselines)");

function viewportKey(page: Page): string {
  return String(page.viewportSize()?.width ?? 0);
}

async function render(page: Page, key: string, url: string): Promise<Buffer> {
  const errors = collectFirstPartyErrors(page, { origin: FIXTURE_ORIGIN });
  const log = await serveAdminFixtures(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(ANCHOR[key]).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  // Fonts and lazy panels settle; the clock is pinned so nothing time-based moves.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const png = await page.screenshot({ fullPage: false, animations: "disabled", caret: "hide" });
  expect([...log.missing], `${key}: every tRPC read has a fixture`).toEqual([]);
  expect([...log.unrouted], `${key}: every /api/ call is stubbed`).toEqual([]);
  expect(errors, `${key}: no first-party errors`).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  return png;
}

/** Slide a render by (dx, dy) CSS px, filling the uncovered edge with the page's own corner colour. */
async function slide(png: Buffer, cssWidth: number, dx: number, dy: number): Promise<Buffer> {
  const img = sharp(png);
  const { width = 0, height = 0 } = await img.metadata();
  const scale = width / cssWidth;
  const { data } = await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
  return sharp(await sharp(png).extend({ top: Math.round(dy * scale), left: Math.round(dx * scale), background }).toBuffer())
    .extract({ left: 0, top: 0, width, height })
    .png()
    .toBuffer();
}

test.describe("admin v1 six-feet gate", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "iphone-se", "admin v1 measures 390 and 1440 only");
  });
  test.setTimeout(120_000);

  test("controls: re-render, slide and a different page", async ({ page }) => {
    const vp = viewportKey(page);
    const size = page.viewportSize()!;
    const overview = PAGES.find((p) => p.key === "overview")!;
    const lot = PAGES.find((p) => p.key === "lot")!;
    const a = await render(page, "overview", overview.url);
    const b = await render(page, "overview", overview.url);
    const other = await render(page, "lot", lot.url);

    const identical = (await visualDistance(a, b, size)).ratio;
    const shifted = await Promise.all(SHIFTS[vp].map(async ([dx, dy]) => (await visualDistance(a, await slide(a, size.width, dx, dy), size)).ratio));
    const recomposed = (await visualDistance(a, other, size)).ratio;
    console.log(
      `[admin-v1-gate] controls ${vp}: identical=${identical.toFixed(3)} ` +
        SHIFTS[vp].map(([dx, dy], i) => `shift${dx}x${dy}=${shifted[i].toFixed(3)}`).join(" ") +
        ` different-page(overview vs lot)=${recomposed.toFixed(3)} threshold=${MIN_DISTANCE}`,
    );
    expect(identical, "the same page rendered twice is (nearly) identical").toBeLessThan(MAX_RERENDER);
    for (const s of shifted) expect(s, "a slid render is not a redesign").toBeLessThan(MIN_DISTANCE);
  });

  for (const p of PAGES) {
    test(`${p.key} ${CAPTURE ? "capture baseline" : "differs from the frozen pre-W1 render"}`, async ({ page }) => {
      const vp = viewportKey(page);
      const size = page.viewportSize()!;
      const file = path.join(BASELINE_DIR, `${p.key}-${vp}.png`);
      const current = await render(page, p.key, p.url);

      if (CAPTURE) {
        mkdirSync(BASELINE_DIR, { recursive: true });
        writeFileSync(file, current);
        console.log(`[admin-v1-gate] captured ${path.relative(process.cwd(), file)}`);
        return;
      }
      test.skip(!existsSync(file), `no baseline at ${path.relative(process.cwd(), file)}: run the CI capture first`);
      const d = await visualDistance(readFileSync(file), current, size);
      console.log(`[admin-v1-gate] ${p.key}-${vp}: distance=${d.ratio.toFixed(3)} shift=${d.shift.dx},${d.shift.dy} gated=${GATED.has(p.key)}`);
      if (GATED.has(p.key)) expect(d.ratio, `${p.key} at ${vp} must look unmistakably different`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    });
  }
});

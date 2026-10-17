/**
 * Admin v1 six-feet gate (W0b instrument, used from W2 on).
 *
 * Renders Today, Lot and Approvals from the DEMO fixtures (same harness as
 * admin-v1-fixtures.spec.ts) and compares each render to the FROZEN pre-W1 render
 * in tests/e2e/admin-v1-baselines/<page>-<viewport>.png with the registered
 * ink-mass distance (admin-v1-distance.ts). The gate demands DIFFERENCE.
 *
 *   ADMIN_V1_GATE=1                       compare each render to its baseline
 *   ADMIN_V1_GATE=1 ADMIN_V1_CAPTURE=1    write the renders as the baselines instead
 *   ADMIN_V1_GATED=<list>                 which renders must score at least 0.35
 *
 * ADMIN_V1_GATED format: a comma list of page:viewport, pages overview | lot |
 * approvals, viewports 390 | 1440, e.g. "overview:390,lot:390". Default
 * "overview:390,lot:390" (PLAN section 3: Today at 390 is W2's gate; Lot at 390 is W3's).
 * Every other render is still measured and its distance printed.
 *
 * A missing baseline in compare mode FAILS with the capture command: an unmeasured
 * page must never read as a passed gate. Capture mode first deletes this viewport's
 * three target PNGs, so a capture that dies half way cannot leave a stale file
 * beside fresh ones.
 *
 * The baselines are captured in CI (nickstire-proof.yml, workflow_dispatch input
 * capture_admin_v1_baselines) so fonts and rasterising match the runner; a local
 * capture is for looking only and is never committed.
 *
 * Controls run in both modes, per viewport, on real renders, print their numbers
 * and assert: a re-render of the same page under 0.02; the same render slid by
 * statenour's calibration shifts under 0.35; and a different admin page (overview
 * vs lot, same shell) above 0.30 and above every slide. 0.30 is the real-render
 * floor for "a different composition", measured 0.368 / 0.384 on 2026-10-16; it is
 * deliberately distinct from the 0.35 gate, which asks for more than a page swap.
 *
 * The different-page control compares the two FROZEN renders (overview-<vp>.png vs
 * lot-<vp>.png), not the live pages. Each wave moves the live pages onto one shared
 * row grammar, so live Today and live Lot converge by design (W3 measured 0.267 at
 * 1440 with Lot's counters under its board) and the control would start failing
 * for the redesign it exists to measure. The frozen pair is the fixed reference the
 * instrument is calibrated on. In capture mode the baselines are being rewritten,
 * so the control uses the live pages, which at capture time are the frozen ones.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { visualDistance } from "./admin-v1-distance";
import { FIXTURE_ORIGIN, PAGES, serveAdminFixtures } from "./fixtures/admin-v1/serve";
import { collectFirstPartyErrors } from "./helpers";

const ENABLED = process.env.ADMIN_V1_GATE === "1";
const CAPTURE = process.env.ADMIN_V1_CAPTURE === "1";
const BASELINE_DIR = path.resolve("tests/e2e/admin-v1-baselines");
const MIN_DISTANCE = 0.35;
const MAX_RERENDER = 0.02;
const RECOMPOSED_FLOOR = 0.3;
const CAPTURE_COMMAND = "ADMIN_V1_GATE=1 ADMIN_V1_CAPTURE=1 node node_modules/@playwright/test/cli.js test tests/e2e/admin-v1-gate.spec.ts (or the nickstire-proof.yml capture dispatch)";
/** page:viewport pairs whose distance is gated; the rest are printed only. */
const GATED = new Set(
  (process.env.ADMIN_V1_GATED ?? "overview:390,lot:390")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
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

async function pixelSize(png: Buffer): Promise<{ width?: number; height?: number }> {
  const { default: sharp } = await import("sharp");
  const { width, height } = await sharp(png).metadata();
  return { width, height };
}

/** Slide a render by (dx, dy) CSS px, filling the uncovered edge with the page's own corner colour. */
async function slide(png: Buffer, cssWidth: number, dx: number, dy: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const { width = 0, height = 0 } = await sharp(png).metadata();
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

  test.beforeAll(({}, info) => {
    if (!CAPTURE || info.project.name === "iphone-se") return;
    const width = info.project.use.viewport?.width;
    for (const p of PAGES) rmSync(path.join(BASELINE_DIR, `${p.key}-${width}.png`), { force: true });
  });

  test("controls: re-render, slide and a different page", async ({ page }) => {
    const vp = viewportKey(page);
    const size = page.viewportSize()!;
    const overview = PAGES.find((p) => p.key === "overview")!;
    const lot = PAGES.find((p) => p.key === "lot")!;
    const a = await render(page, "overview", overview.url);
    const b = await render(page, "overview", overview.url);

    const identical = (await visualDistance(a, b, size)).ratio;
    const shifted = await Promise.all(SHIFTS[vp].map(async ([dx, dy]) => (await visualDistance(a, await slide(a, size.width, dx, dy), size)).ratio));
    // The different-page pair: frozen in compare mode, live in capture mode (see the header).
    let pair: [Buffer, Buffer];
    if (CAPTURE) {
      pair = [a, await render(page, "lot", lot.url)];
    } else {
      const frozen = ["overview", "lot"].map((k) => path.join(BASELINE_DIR, `${k}-${vp}.png`));
      for (const f of frozen) {
        if (!existsSync(f)) throw new Error(`no baseline at ${path.relative(process.cwd(), f)}: the different-page control needs both frozen renders. Capture first: ${CAPTURE_COMMAND}`);
      }
      pair = [readFileSync(frozen[0]), readFileSync(frozen[1])];
    }
    const recomposed = (await visualDistance(pair[0], pair[1], size)).ratio;
    console.log(
      `[admin-v1-gate] controls ${vp}: identical=${identical.toFixed(3)} ` +
        SHIFTS[vp].map(([dx, dy], i) => `shift${dx}x${dy}=${shifted[i].toFixed(3)}`).join(" ") +
        ` recomposed(${CAPTURE ? "live" : "frozen"} overview vs lot)=${recomposed.toFixed(3)} floor=${RECOMPOSED_FLOOR} gate=${MIN_DISTANCE}`,
    );
    expect(identical, "the same page rendered twice is (nearly) identical").toBeLessThan(MAX_RERENDER);
    for (const s of shifted) expect(s, "a slid render is not a redesign").toBeLessThan(MIN_DISTANCE);
    expect(recomposed, "a different page scores above the real-render floor").toBeGreaterThan(RECOMPOSED_FLOOR);
    expect(recomposed, "a different page scores above every slide").toBeGreaterThan(Math.max(...shifted));
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
      if (!existsSync(file)) {
        throw new Error(`no baseline at ${path.relative(process.cwd(), file)}: an unmeasured page is not a passed gate. Capture first: ${CAPTURE_COMMAND}`);
      }
      const baseline = readFileSync(file);
      // massGrid resizes with fit "fill": a baseline of another size would be stretched, not compared.
      expect(await pixelSize(baseline), `${p.key}-${vp}: baseline and render have the same pixel size`).toEqual(await pixelSize(current));
      const d = await visualDistance(baseline, current, size);
      const gated = GATED.has(`${p.key}:${vp}`);
      console.log(`[admin-v1-gate] ${p.key}-${vp}: distance=${d.ratio.toFixed(3)} shift=${d.shift.dx},${d.shift.dy} gated=${gated}`);
      if (gated) expect(d.ratio, `${p.key} at ${vp} must look unmistakably different`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    });
  }
});

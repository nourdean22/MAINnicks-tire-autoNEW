/**
 * Visible Transformation v3 gate (2026-10-15, UI v3 Wave 0b): the instrument,
 * inert until it is switched on.
 *
 * The operator's bar for v3 is the v2 bar, raised by one fact: all committed v2
 * screenshots are EMPTY-database renders, so nobody knows how Home and Missions
 * look with real data at 390px. This spec renders those two pages from the DEMO
 * fixtures (tests/e2e/fixtures) and asks the same question as the v2 gate: can
 * you tell it apart from the baseline from six feet away? Looking the same is
 * the failure. The decision is v3GateVerdict (./v3-gate.ts, pinned by
 * tests/repo/v3-gate.test.ts); the distance is the registered ink-mass distance
 * of ./visual-distance.ts.
 *
 * Baselines are the fixture renders of v2 AS IT IS, captured once in CI by the
 * `capture_v3_baselines` workflow_dispatch run of e2e-statenour.yml (VT_V3=1
 * VT_V3_CAPTURE=1), then committed into `visible-transformation-v3.spec.ts-snapshots/`.
 * That directory is empty until then. They are frozen: re-capturing from a tree
 * that already has the redesign erases the thing being measured.
 *
 * Opt-in. Without VT_V3=1 every test here is skipped and the default e2e run
 * pays nothing. With VT_V3=1 a missing baseline is a hard failure, never a silent
 * write; writing happens only under VT_V3_CAPTURE=1, and a void render is
 * refused as a baseline.
 *   VT_V3=1                    compare each render to its baseline
 *   VT_V3=1 VT_V3_CAPTURE=1    write the renders into the snapshot dir
 *   VT_OUT_DIR=<dir>           also keep the renders for a human to look at
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { installFixtures } from "./fixtures";
import { captureVerdict, v3GateVerdict } from "./v3-gate";
import { V3_PAGES, V3_VIEWPORTS, VT_CONTEXT, renderPage, warmRoutes } from "./vt-render";
import { inkCoverage, visualDistance } from "./visual-distance";

const SNAPSHOT_DIR = path.join(__dirname, "visible-transformation-v3.spec.ts-snapshots");
const ENABLED = process.env.VT_V3 === "1";
const CAPTURE = process.env.VT_V3_CAPTURE === "1";

for (const vp of V3_VIEWPORTS) {
  test.describe(`v3 gate · ${vp.key} ${vp.width}×${vp.height}`, () => {
    test.skip(!ENABLED, "the v3 six-feet gate is opt-in: set VT_V3=1 (and VT_V3_CAPTURE=1 to capture baselines)");
    test.use({ viewport: { width: vp.width, height: vp.height }, ...VT_CONTEXT });
    // Compile + settle on a cold `next dev`; the budget is not a pass.
    test.setTimeout(120_000);

    test.beforeAll(async ({ browser }) => {
      if (!ENABLED) return;
      test.setTimeout(10 * 60_000);
      await warmRoutes(
        browser,
        vp,
        V3_PAGES.map((p) => p.path),
      );
    });

    for (const p of V3_PAGES) {
      test(`${p.key} ${CAPTURE ? "capture" : "looks unmistakably different from the v2 baseline"}`, async ({ page }) => {
        const file = path.join(SNAPSHOT_DIR, `${p.key}-${vp.key}.png`);
        const report = await installFixtures(page);
        const current = await renderPage(page, p.path, p.landmark);

        // Calls the fixtures refused: printed, not gated (a page may ask for more than it renders).
        const unstubbed = [...report.unstubbed].sort();
        console.log(`[visible-transformation-v3] ${p.key}/${vp.key} unstubbed=${unstubbed.join(" | ") || "none"}`);

        const outDir = process.env.VT_OUT_DIR;
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, `${p.key}-${vp.key}.png`), current);
        }

        const ink = await inkCoverage(current, vp);

        if (CAPTURE) {
          const capture = captureVerdict({ ink });
          expect(capture.ok, `${p.key}/${vp.key}: ${capture.reason}`).toBe(true);
          fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
          fs.writeFileSync(file, current);
          test.info().annotations.push({ type: "baseline", description: `wrote ${path.basename(file)}` });
          return;
        }

        const baselineExists = fs.existsSync(file);
        const distance = baselineExists ? (await visualDistance(fs.readFileSync(file), current, vp)).ratio : 0;
        const verdict = v3GateVerdict({ baselineExists, ink, distance });
        test.info().annotations.push({
          type: "distance",
          description: `${p.key}/${vp.key}: ink-mass distance ${(distance * 100).toFixed(1)}%, ink ${ink.toFixed(3)}`,
        });
        console.log(`[visible-transformation-v3] ${p.key}/${vp.key} distance=${distance.toFixed(3)} ink=${ink.toFixed(3)} ok=${verdict.ok}`);
        expect(verdict.ok, `${p.key}/${vp.key}: ${verdict.reason}`).toBe(true);
      });
    }
  });
}

/**
 * Visible Transformation v3 gate (2026-10-15, UI v3 Wave 0b): the instrument,
 * inert until it is switched on.
 *
 * The operator's bar for v3 is the v2 bar, raised by one fact: all committed v2
 * screenshots are EMPTY-database renders, so nobody knows how Home and Missions
 * look with real data at 390px. This spec renders those two pages from the DEMO
 * fixtures (tests/e2e/fixtures) and asks the same question as the v2 gate: can
 * you tell it apart from the baseline from six feet away? Looking the same is
 * the failure. Measurement and decision are measureAndJudge (./v3-gate.ts,
 * pinned by tests/repo/v3-gate.test.ts); the distance is the registered
 * ink-mass distance of ./visual-distance.ts.
 *
 * A render must also BE the fixture render: the page's DEMO anchor text is
 * visible, none of its own error states is on screen, and no page-data read
 * outside UNSTUBBED_ALLOWLIST went unanswered. Without that, a page that grew a
 * query the fixtures do not know would render an error state, land "far" from
 * v2, and pass on distance alone.
 *
 * Baselines are the fixture renders of v2 AS IT IS, captured once in CI by the
 * `capture_v3_baselines` workflow_dispatch run of e2e-statenour.yml (VT_V3=1
 * VT_V3_CAPTURE=1), then committed into `visible-transformation-v3.spec.ts-snapshots/`.
 * They are frozen: re-capturing from a tree that already has the redesign erases
 * the thing being measured. (W3a) A page flagged `baselinePending` in V3_PAGES,
 * Chat until its pre-W3 baseline is captured from main, still renders, gates its
 * anchor and its unstubbed reads, and SKIPS only the distance comparison while its
 * PNG is missing.
 *
 * Opt-in. Without VT_V3=1 every test here is skipped and the default e2e run
 * pays nothing. With VT_V3=1 a missing baseline is a hard failure for every page
 * that is not pending, never a silent write; writing happens only under
 * VT_V3_CAPTURE=1, and a void render is refused as a baseline.
 *   VT_V3=1                    compare each render to its baseline
 *   VT_V3=1 VT_V3_CAPTURE=1    write the renders into the snapshot dir
 *   VT_OUT_DIR=<dir>           also keep the renders for a human to look at
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { DEMO, PAGE_ERRORS, disallowedUnstubbed, installFixtures } from "./fixtures";
import { baselineSkipReason, captureVerdict, measureAndJudge } from "./v3-gate";
import { V3_PAGES, V3_VIEWPORTS, VT_CONTEXT, openChatHistory, renderPage, settleChat, warmRoutes, type RenderAnchor } from "./vt-render";
import { inkCoverage } from "./visual-distance";

const SNAPSHOT_DIR = path.join(__dirname, "visible-transformation-v3.spec.ts-snapshots");
const ENABLED = process.env.VT_V3 === "1";
const CAPTURE = process.env.VT_V3_CAPTURE === "1";

/** The text that proves each render came from the fixtures, and the error texts that prove it did not. */
const ANCHOR: Record<string, RenderAnchor> = {
  home: { anchorText: DEMO.homeSummary, errorPattern: PAGE_ERRORS.home },
  missions: { anchorText: DEMO.missionsNextMove, errorPattern: PAGE_ERRORS.missions },
  // Chat loads no conversation by itself: open() picks the seeded one in the History drawer, settle() waits out the island.
  chat: { anchorText: DEMO.chatReply, errorPattern: PAGE_ERRORS.chat, open: (page) => openChatHistory(page, DEMO.chatTitle), settle: settleChat },
  // W4 Mind (2026-10-19): each anchor is a fixture sentence the page's content prints (fixtures/{brain,people,journal,stats}.ts).
  brain: { anchorText: DEMO.brainBoardQuestion, errorPattern: PAGE_ERRORS.brain },
  people: { anchorText: DEMO.peopleNeglected, errorPattern: PAGE_ERRORS.people },
  journal: { anchorText: DEMO.journalEntry, errorPattern: PAGE_ERRORS.journal },
  stats: { anchorText: DEMO.statsTopRiser, errorPattern: PAGE_ERRORS.stats },
};

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
        // renderPage waits for the DEMO anchor and for the absence of the page's
        // error states BEFORE the settle wait and the screenshot (vt-render.ts).
        const current = await renderPage(page, p.path, p.landmark, ANCHOR[p.key]);

        // ...and no page-data read went unanswered (the report is complete only after the render).
        const unstubbed = [...report.unstubbed].sort();
        console.log(`[visible-transformation-v3] ${p.key}/${vp.key} unstubbed=${unstubbed.join(" | ") || "none"}`);
        expect(disallowedUnstubbed(unstubbed), `${p.key}/${vp.key} read page data the fixtures do not answer`).toEqual([]);

        const outDir = process.env.VT_OUT_DIR;
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, `${p.key}-${vp.key}.png`), current);
        }

        if (CAPTURE) {
          const capture = captureVerdict({ ink: await inkCoverage(current, vp) });
          expect(capture.ok, `${p.key}/${vp.key}: ${capture.reason}`).toBe(true);
          fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
          fs.writeFileSync(file, current);
          test.info().annotations.push({ type: "baseline", description: `wrote ${path.basename(file)}` });
          return;
        }

        const baseline = fs.existsSync(file) ? fs.readFileSync(file) : null;
        // The render, its anchor and its unstubbed reads were all gated above; only the distance has nothing to
        // compare to. A page not flagged baselinePending still fails on a missing PNG (measureAndJudge below).
        const skipReason = baselineSkipReason({ label: `${p.key}/${vp.key}`, baselineExists: baseline !== null, pending: p.baselinePending === true });
        test.skip(skipReason !== null, skipReason ?? "");
        const result = await measureAndJudge({ baseline, current, viewport: vp });
        test.info().annotations.push({
          type: "distance",
          description: `${p.key}/${vp.key}: ink-mass distance ${(result.distance * 100).toFixed(1)}%, ink ${result.ink.toFixed(3)}`,
        });
        console.log(`[visible-transformation-v3] ${p.key}/${vp.key} distance=${result.distance.toFixed(3)} ink=${result.ink.toFixed(3)} ok=${result.verdict.ok}`);
        expect(result.verdict.ok, `${p.key}/${vp.key}: ${result.verdict.reason}`).toBe(true);
      });
    }
  });
}

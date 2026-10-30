/**
 * The decisions maxim on a phone (2026-10-30, upgrade 3 of the Home maxim). The hermetic CI database has no
 * pending approval and no decision 1, so target-size and no-sideways-scroll never meet the line; here the
 * fixture lane stubs two pending approvals, decision 1 and the maxim, and the real pages render them.
 * Each page must show exactly ONE Maxim region whose controls are 44 px, with no sideways scroll at 390 px.
 */
import { expect, test } from "@playwright/test";

import { installFixtures } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 } });

const MAXIM = { id: "demo-maxims:2", text: "Demo maxim: sleep on a big call.", source: "Demo Book", topic: "money", position: 1, total: 9 };
const approval = (id: string, reason: string) => ({
  id,
  toolId: "demo_tool",
  riskClass: "low",
  requestedBy: "nick",
  reason,
  payload: { demo: true },
  expired: false,
  expiresAt: null,
  createdAt: "2026-10-15T17:00:00.000Z",
});
const DECISION = {
  decision: {
    id: 1,
    date: "2026-10-01",
    title: "Demo decision: lease the demo bay",
    domain: "business",
    stakes: "high",
    context: "Demo cash is tight this month",
    optionsConsidered: null,
    chosen: null,
    reasoning: null,
    predictedOutcome: null,
    emotionalState: null,
    reviewDate: null,
    actualOutcome: null,
    grade: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  lineage: { siblings: [], antiPatterns: [] },
  timeline: { ageDays: 14, reviewDueDays: null, isReviewed: false, isOverdue: false },
};

const CASES = [
  {
    route: "/system/actions",
    extra: {
      "operator.maxim": MAXIM,
      "systemAutomation.getPendingApprovals": [approval("demo-a1", "Demo: pay the demo invoice"), approval("demo-a2", "Demo: hire the demo helper")],
    },
  },
  { route: "/decisions/1", extra: { "operator.maxim": MAXIM, "operator.decisionDetail": DECISION } },
] as const;

for (const c of CASES) {
  test(`${c.route} shows one decisions maxim with 44 px controls and no sideways scroll`, async ({ page }) => {
    test.setTimeout(120_000); // a cold next dev compiles these pages on first visit
    await installFixtures(page, c.extra);
    await page.goto(c.route, { waitUntil: "domcontentloaded" });
    const maxim = page.getByRole("region", { name: "Maxim" });
    await expect(maxim).toHaveCount(1, { timeout: 60_000 });
    await expect(maxim).toContainText("Demo maxim: sleep on a big call.");
    const buttons = await maxim.getByRole("button").all();
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      const box = (await b.boundingBox())!;
      expect(Math.round(box.width), `${await b.textContent()} width`).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.height), `${await b.textContent()} height`).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "sideways scroll at 390 px").toBeLessThanOrEqual(0);
  });
}

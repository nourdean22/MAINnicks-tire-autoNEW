/**
 * Fixture smoke (2026-10-15, UI v3 Wave 0b): the only v3 spec that runs by
 * default. It proves the fixture lane works on the hermetic CI stack, so the
 * opt-in v3 gate does not discover on capture day that its data never arrived.
 *
 * Two tests, phone width: Home and Missions rendered from the DEMO fixtures
 * must show text that exists ONLY in the fixtures (tests/repo/v3-gate.test.ts
 * greps the app source to prove it), so a page rendered from the empty database
 * cannot pass. It also fails on the page's own error states, on an uncaught
 * page error, and on a page-data read the fixtures did not answer, so a fixture
 * that stops matching its contract (or a page that grew a query) fails here, not
 * as a half-empty baseline.
 */
import { expect, test, type Page } from "@playwright/test";

import { DEMO, PAGE_ERRORS, disallowedUnstubbed, installFixtures, type FixtureReport } from "./fixtures";
import { IGNORED_PAGE_ERRORS, VT_CONTEXT } from "./vt-render";

test.use({ viewport: { width: 390, height: 844 }, ...VT_CONTEXT });

async function openFromFixtures(page: Page, route: string): Promise<{ pageErrors: string[]; report: FixtureReport }> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    if (!IGNORED_PAGE_ERRORS.test(err.message)) pageErrors.push(err.message);
  });
  const report = await installFixtures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${route} must respond 200`).toBe(200);
  return { pageErrors, report };
}

test.describe("v3 fixtures render", () => {
  test("Home shows the DEMO brief, not the empty state", async ({ page }) => {
    const { pageErrors, report } = await openFromFixtures(page, "/");
    await expect(page.getByText(DEMO.homeSummary).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(DEMO.homeHeadline).first()).toBeVisible();
    // W2: approvals are rows of their own; the first pending DEMO approval is the anchor.
    await expect(page.getByText(DEMO.homeApproval).first()).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await expect(page.getByText(PAGE_ERRORS.home)).toHaveCount(0);
    expect(disallowedUnstubbed(report.unstubbed), "Home read page data the fixtures do not answer").toEqual([]);
    expect(pageErrors, "Home threw during render").toEqual([]);
  });

  test("Missions shows the DEMO deck and board, not the empty state", async ({ page }) => {
    const { pageErrors, report } = await openFromFixtures(page, "/missions");
    await expect(page.getByText(DEMO.missionsNextMove).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(DEMO.missionTitle).first()).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await expect(page.getByText(PAGE_ERRORS.missions)).toHaveCount(0);
    expect(disallowedUnstubbed(report.unstubbed), "Missions read page data the fixtures do not answer").toEqual([]);
    expect(pageErrors, "Missions threw during render").toEqual([]);
  });
});

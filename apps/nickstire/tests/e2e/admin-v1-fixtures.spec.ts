/**
 * Admin v1 fixture render (W0b): Today, Lot and Approvals rendered from the local
 * `vite build` with every tRPC read answered by the DEMO fixture router.
 *
 * No live site, no session, no database: the page runs on a fake `.test` origin and
 * everything it asks for is answered by tests/e2e/fixtures/admin-v1/serve.ts. The
 * spec fails loudly, by name, on any procedure or /api/ path the fixtures do not
 * cover, so an admin that rendered empty because a read was missing cannot pass.
 *
 * Run (from apps/nickstire, after a vite build):
 *   node node_modules/@playwright/test/cli.js test tests/e2e/admin-v1-fixtures.spec.ts --project=iphone-14 --workers=1
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DIST_DIR, FIXTURE_ORIGIN, PAGES, serveAdminFixtures } from "./fixtures/admin-v1/serve";
import { collectFirstPartyErrors } from "./helpers";

test.use({ baseURL: FIXTURE_ORIGIN, serviceWorkers: "block", timezoneId: "America/New_York", locale: "en-US" });

/** Text that exists only in the DEMO fixtures, one real row per page. */
const FIXTURE_ROW: Record<(typeof PAGES)[number]["key"], string> = {
  overview: "Terrell Washington",
  lot: "FIX 1003",
  approvals: "Call Aisha Brooks back about two used tires",
};

/** What the DEMO Tuesday promises: 8 queue rows on Today, 5 cars on the floor board, 3 held approvals. */
const ROW_COUNT: Record<(typeof PAGES)[number]["key"], number> = { overview: 8, lot: 5, approvals: 3 };
const QUEUE_NAMES = /Rosa Delgado|Terrell Washington|Aisha Brooks|Mike Petrovic|Linda Nowak|DeShawn Carter|Paul Szabo|Janet Hruska/;

function rowsOf(page: Page, key: (typeof PAGES)[number]["key"]): Locator {
  if (key === "overview") return page.locator("article").filter({ hasText: QUEUE_NAMES }); // OverviewSection queue rows
  if (key === "lot") return page.getByText("on the property", { exact: true }); // one per FloorCard with an observed arrival
  return page.locator("li").filter({ hasText: /pending review/i }); // ApprovalsSection rows
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "iphone-se", "admin v1 measures 390 and 1440 only");
  // The live canary job (nickstire-proof.yml `playwright`) runs every spec without a
  // build; there this one has nothing to render. The capture job builds first, and
  // the gate spec throws on a missing build instead of skipping.
  test.skip(!existsSync(path.join(DIST_DIR, "index.html")), `no SPA build at ${DIST_DIR}: run vite build first`);
});

for (const pg of PAGES) {
  test(`admin v1 fixtures: ${pg.key} renders DEMO rows with no first-party errors`, async ({ page }) => {
    const errors = collectFirstPartyErrors(page, { origin: FIXTURE_ORIGIN });
    const log = await serveAdminFixtures(page);

    await page.goto(pg.url, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(FIXTURE_ROW[pg.key]).first(), `a DEMO ${pg.key} row is on screen`).toBeVisible({ timeout: 20_000 });
    // Let the remaining reads settle so a late unstubbed read is caught too.
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Admin Access" }), "not the sign-in screen").toHaveCount(0);
    await expect(page.locator("#mfa-title"), "not the MFA gate").toHaveCount(0);

    // The rows the fixtures promise, counted on the page (not just one anchor row).
    await expect(rowsOf(page, pg.key), `${pg.key} shows exactly ${ROW_COUNT[pg.key]} DEMO rows`).toHaveCount(ROW_COUNT[pg.key]);

    expect([...log.blockedHosts], "the fixture origin itself is never refused").not.toContain(new URL(FIXTURE_ORIGIN).host);
    expect([...log.missing], "every tRPC read has a fixture (add the named procedures to fixtures/admin-v1/data.ts)").toEqual([]);
    expect([...log.unrouted], "every non-tRPC /api/ call is stubbed").toEqual([]);
    expect(errors, "no first-party runtime or tRPC errors").toEqual([]);
  });
}

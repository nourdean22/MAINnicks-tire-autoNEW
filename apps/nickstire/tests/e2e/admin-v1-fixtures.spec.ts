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
import { expect, test } from "@playwright/test";
import { FIXTURE_ORIGIN, PAGES, serveAdminFixtures } from "./fixtures/admin-v1/serve";
import { collectFirstPartyErrors } from "./helpers";

test.use({ baseURL: FIXTURE_ORIGIN, serviceWorkers: "block", timezoneId: "America/New_York", locale: "en-US" });

/** Text that exists only in the DEMO fixtures, one real row per page. */
const FIXTURE_ROW: Record<(typeof PAGES)[number]["key"], string> = {
  overview: "Terrell Washington",
  lot: "FIX 1003",
  approvals: "Call Aisha Brooks back about two used tires",
};

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "iphone-se", "admin v1 measures 390 and 1440 only");
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

    expect([...log.missing], "every tRPC read has a fixture (add the named procedures to fixtures/admin-v1/data.ts)").toEqual([]);
    expect([...log.unrouted], "every non-tRPC /api/ call is stubbed").toEqual([]);
    expect(errors, "no first-party runtime or tRPC errors").toEqual([]);
  });
}

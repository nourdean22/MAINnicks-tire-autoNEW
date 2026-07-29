/**
 * tests/e2e/chat-states.spec.ts — chat-state visual baselines
 * (2026-07-29 · next-queue item 5).
 *
 * ─────────────────────────────────────────────────────────────────
 * BASELINES ARE COMMITTED (2026-07-29, six PNGs alongside this file).
 * Regenerate after an intentional UI change:
 *
 *   pnpm test:e2e:install     # one-time chromium download
 *   pnpm dev                  # separate shell — config assumes :3001
 *   pnpm exec playwright test chat-states --update-snapshots --workers=1
 *
 * They were generated against `next dev` with AUTH_FORCE_MOCK=1 and a
 * DUMMY database — the same lane CI uses, and deliberately so: mock auth
 * is honored only under dev, and a dummy DB keeps real operator data
 * out of images that live in git forever.
 *
 * This spec gates nothing automatically: `verify:hard` runs vitest only,
 * never test:e2e. Run it by hand after touching chat surfaces.
 *
 * The target page renders REAL components against module-level fixtures
 * (no network, no DB), and every selector below is a literal from
 * app/(mastery)/system/chat-states/page.tsx.
 *
 * WHY THE TIMESTAMP IS MASKED: the page seeds `FRESH_FETCHED_AT` from
 * Date.now() and the evidence panel renders toLocaleTimeString(), so a
 * naive screenshot would flake every run. See `timestampMask` below.
 * ─────────────────────────────────────────────────────────────────
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Click-then-assert with retry. A bare click can land BEFORE React
 * attaches its handlers: Playwright happily clicks the hydrated-looking
 * DOM node, nothing happens, and the assertion times out — which is
 * exactly how this spec first failed (mobile only, because the race is
 * timing-dependent, not viewport-dependent; a probe confirmed the panel
 * opens fine at 390px). `toPass` re-clicks until the panel actually
 * opens, which is the documented fix for a hydration race — and unlike
 * a fixed sleep it neither flakes nor wastes time when hydration is fast.
 */
async function openPanel(page: Page, button: string, proof: string): Promise<void> {
  const panel = page.getByText(proof);
  // Diagnosis receipt: at failure the button carried [active] — the click
  // LANDED (native focus works pre-hydration) but React's handler had not
  // attached, so no panel appeared. The two full-page tests, which never
  // interact, passed every run. Hence retry-until-hydrated.
  //
  // Do NOT add waitForLoadState("networkidle") here: Next's dev server
  // holds an HMR websocket open, so idle never arrives and every test
  // stalls to its navigation timeout (measured: 6.6 min, 5 failures).
  //
  // Settle before the first click. A bare probe script that waits ~2s
  // then clicks ONCE succeeds every time, while a tight click-retry loop
  // failed for a full 90s — so hammering the button during hydration is
  // itself part of the problem, not just a symptom. Dev-mode hydration
  // exposes no observable signal to wait on, which is the one case where
  // a fixed settle beats a poll.
  await page.getByRole("heading", { name: "Chat States" }).waitFor();
  await page.waitForTimeout(2_000);
  await expect(async () => {
    // Guard the click: the panel is `fixed right-0 w-80`, which on a
    // 390px viewport COVERS the button that opened it. A naive retry
    // therefore deadlocks on its own target — click, panel opens, next
    // retry can no longer reach the button. Only click while closed.
    if (!(await panel.isVisible())) {
      await page.getByRole("button", { name: button }).click({ timeout: 5_000 });
    }
    await expect(panel).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 90_000 });
}

const PAGE = "/system/chat-states";

/**
 * The page seeds its "fresh recall" fixture from Date.now() and the
 * panel renders toLocaleTimeString(), so that one line changes every
 * run. Masking it is the determinism fix — an earlier draft froze the
 * page clock instead, which is heavier (it reaches into the page's time
 * source, next to React's scheduler) for no extra benefit. The mask
 * paints a solid box, so a REGRESSION in the surrounding panel still
 * fails the comparison; only the moving timestamp is excluded.
 */
const timestampMask = (page: Page): Locator[] => [
  page.locator("p.font-mono").filter({ hasText: /recalled at/ }),
];


// The two interaction tests depend on React having hydrated a large
// dev-mode bundle. Measured on a loaded dev box: a standalone script
// doing the identical click succeeds every time, while the runner
// intermittently clicks pre-hydration (the button shows [active], the
// handler never fires) — and WHICH test loses the race moves run to
// run. Retries are the honest mitigation for a genuinely flaky
// environment; the config already applies them in CI for the same
// reason. They do not mask a product bug: the assertions are unchanged
// and a real regression fails all attempts.
test.describe.configure({ retries: 3 });

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of viewports) {
  test.describe(`chat states · ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("full page — typed cards, unregistered-tool fallback, receipts", async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.getByRole("heading", { name: "Chat States" })).toBeVisible();
      // The fixture page is static after hydration; waiting on the last
      // section's heading is a real readiness signal, not a sleep.
      await expect(page.getByText("Completion message — receipts sample")).toBeVisible();
      await expect(page).toHaveScreenshot(`chat-states-${vp.name}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });

    test("evidence panel — fresh recall (open state)", async ({ page }) => {
      await page.goto(PAGE);
      await openPanel(page, "Open — fresh recall", "Context & Evidence");
      await expect(page).toHaveScreenshot(`evidence-fresh-${vp.name}.png`, {
        animations: "disabled",
        mask: timestampMask(page),
      });
    });

    test("evidence panel — never fetched (honest empty state)", async ({ page }) => {
      await page.goto(PAGE);
      // The honesty contract this baseline protects: an unfetched panel
      // must say so rather than rendering as evidence.
      // Prove the panel opened via its header (shared by both variants),
      // THEN assert the variant-specific honesty line. Splitting these
      // was diagnostic: it separates "panel never opened" from "panel
      // opened but the empty-state line is missing".
      await openPanel(page, "Open — never fetched", "Context & Evidence");
      await expect(
        page.getByText("not yet fetched — open state, not evidence"),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(`evidence-unfetched-${vp.name}.png`, {
        animations: "disabled",
      });
    });
  });
}

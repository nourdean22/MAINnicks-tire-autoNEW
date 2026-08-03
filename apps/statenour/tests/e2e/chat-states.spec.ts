/**
 * tests/e2e/chat-states.spec.ts — chat-state visual baselines
 * (2026-07-29 · next-queue item 5).
 *
 * ─────────────────────────────────────────────────────────────────
 * BASELINES ARE PER-PLATFORM. Playwright names them
 * `{name}-{project}-{platform}.png`, so a baseline generated on Windows
 * (`-win32`) is invisible to CI (`-linux`) — the suffix exists precisely
 * because font rasterization and antialiasing differ per OS, and a
 * cross-platform pixel comparison is not meaningful.
 *
 * Regenerate after an intentional UI change, ON THE PLATFORM YOU ARE
 * ADDING A BASELINE FOR:
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
 * CORRECTED 2026-08-03. This header used to say "this spec gates nothing
 * automatically: verify:hard runs vitest only, never test:e2e." The first
 * clause was FALSE, and it cost five days of red CI. verify:hard indeed
 * does not run it — but `.github/workflows/e2e-statenour.yml` runs
 * `playwright test`, and playwright.config.ts sets `testDir: ./tests/e2e`,
 * so EVERY spec in this directory is a blocking CI gate. Only `-win32`
 * baselines were ever committed, so on ubuntu all six comparisons failed
 * with "A snapshot doesn't exist", every run on every branch from
 * 2026-07-29T14:58 (0ad000b79, the commit that added this file) onward.
 *
 * The guard below makes the intent true instead of merely asserted: a
 * visual case SKIPS when no baseline exists for the current platform, and
 * runs unchanged when one does. Commit `-linux` baselines and CI starts
 * enforcing them automatically — no config to remember.
 *
 * KNOWN, before anyone adds `-linux` baselines: the two full-page cases
 * are not yet pixel-stable. In run 30822603355 Playwright's own
 * stability retry captured two consecutive shots of `chat-states-desktop`
 * that differed (143,993 vs 148,030 bytes, with a -diff.png), while the
 * masked evidence cases were stable. Whatever moves on the full page is
 * unmasked — find and mask it BEFORE committing a linux baseline, or the
 * gate will flake.
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
import { existsSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Skip a visual case when this platform has no committed baseline.
 *
 * NOT a loosened assertion — where a baseline exists the comparison runs
 * exactly as before, so a real regression still fails. This only replaces
 * Playwright's "A snapshot doesn't exist, writing actual" failure, which
 * in ephemeral CI can never resolve on its own: the written file is
 * discarded with the runner, so the same case fails forever while
 * reporting a missing FILE rather than the real problem (no baseline was
 * ever generated for this OS).
 *
 * Self-healing by design: commit `<name>-chromium-linux.png` and CI
 * begins enforcing it on the next run with no config change.
 */
// __dirname, not import.meta.url: Playwright transpiles specs as CJS here
// (no "type": "module" in the nearest package.json), so import.meta is a
// SyntaxError that fails the WHOLE file to load — caught by
// `playwright test --list` before this shipped.
const SNAPSHOT_DIR = path.join(__dirname, "chat-states.spec.ts-snapshots");

function requireBaseline(name: string): void {
  const file = `${name}-chromium-${process.platform}.png`;
  test.skip(
    !existsSync(path.join(SNAPSHOT_DIR, file)),
    `no committed baseline "${file}" for platform "${process.platform}" — ` +
      `regenerate on this OS (see header) and commit it; the case runs automatically once it exists`,
  );
}

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
      requireBaseline(`chat-states-${vp.name}`);
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
      requireBaseline(`evidence-fresh-${vp.name}`);
      await page.goto(PAGE);
      await openPanel(page, "Open — fresh recall", "Context & Evidence");
      await expect(page).toHaveScreenshot(`evidence-fresh-${vp.name}.png`, {
        animations: "disabled",
        mask: timestampMask(page),
      });
    });

    test("evidence panel — never fetched (honest empty state)", async ({ page }) => {
      requireBaseline(`evidence-unfetched-${vp.name}`);
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

/**
 * tests/e2e/phone-no-sideways-scroll.spec.ts · 2026-10-14 (#3023)
 *
 * The document never scrolls sideways on a phone. AmbientAura's wrapper keeps
 * `overflow-x-clip` and `min-h-screen` (UI v3 W1a removed the state-aura classes,
 * which used to bleed 4px past each edge, and kept the clip because it carries the
 * containing-block fix). Any box that spills past the column now reports
 * `scrollWidth - innerWidth` above 0 at 390px.
 *
 * The reading is sampled three times and the MAXIMUM must be 0, so a single
 * clean sample on first paint cannot pass a page that overflows later.
 */
import { test, expect, type Page } from "@playwright/test";

// Wave E2 (2026-10-24): /stats and /settings join (census 3A.5 listed both as uncovered).
// Wave F (2026-10-25): /, /system, /people and /photo-improver join (census 3A.5: no phone-scroll check).
// 2026-10-29 sync audit (gates wave): the six page routes no phone spec visited join. /decisions/1 renders the
// not-found or failed-read state on the hermetic database, which is still a page that must not scroll sideways.
const PAGES = [
  "/system/ui-lab", "/chat", "/brain", "/journal", "/missions", "/stats", "/settings", "/", "/system", "/people", "/photo-improver",
  "/system/actions", "/system/alerts", "/system/crons", "/system/inbox", "/decisions/1", "/auth/sign-in",
] as const;

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("phone · no sideways document scroll", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of PAGES) {
    test(`${path} is not wider than the viewport`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // /auth/sign-in sits outside the (mastery) shell: it has a <main> but no #main-content. Every other path
      // must render its own shell, never a redirect to sign-in measured in its place (Codex P2 on #3362).
      const isAuthPage = path.startsWith("/auth/");
      await page.waitForSelector(isAuthPage ? "main" : "#main-content");
      if (!isAuthPage) expect(page.url(), `${path} redirected to auth`).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
      // A fixed settle, not networkidle: /chat keeps a poll open, so networkidle
      // stalls, and a page-enter transform still in flight adds scroll width.
      await page.waitForTimeout(2500);

      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        samples.push(await overflowPx(page));
        await page.waitForTimeout(500);
      }
      expect(Math.max(...samples), `scrollWidth - innerWidth on ${path}: ${samples.join(", ")}`).toBeLessThanOrEqual(0);
    });
  }
});

/**
 * tests/e2e/phone-no-sideways-scroll.spec.ts · 2026-10-14 (#3023)
 *
 * The document never scrolls sideways on a phone. `.state-aura` carries 4px
 * padding and -4px margin, so its box spans the column plus 8px; AmbientAura
 * clips that on a wrapper (`overflow-x-clip`). Remove the clip and every
 * mastery page reports `scrollWidth - innerWidth` of 4 at 390px.
 *
 * The reading is sampled three times and the MAXIMUM must be 0, so a single
 * clean sample on first paint cannot pass a page that overflows later.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGES = ["/system/ui-lab", "/chat", "/brain", "/journal", "/missions"] as const;

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("phone · no sideways document scroll", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of PAGES) {
    test(`${path} is not wider than the viewport`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#main-content");
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

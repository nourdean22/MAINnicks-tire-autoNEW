// Mutation receipts (2026-09-15, hermetic dev server + Chromium in the session container, 4/4 green before each):
//   A · use-selection-keyboard.ts cleanup without `resetTransient()` -> test 1 red at line 64
//       ("expect(locator).toHaveCount(0)" — the selection bar survived the route change).
//   B · onKey without the `foreignModalOpen()` bail -> test 3 red at line 107
//       ("expect(panel).toBeVisible()" — the inspector closed together with the MORE sheet).
// Restored byte-for-byte from the scratchpad copy; 4/4 green twice after.
/**
 * The selection grammar and the inspector's layering, in a real browser
 * (2026-09-15, UI workbench wave 3).
 *
 * The two P1 findings of the slice-1 hostile review — "selection follows the
 * operator to the next page" and "one Esc closes two layers" — live in DOM
 * code the Node vitest lane cannot exercise (a document keydown listener,
 * a route-change effect cleanup, a modal check on the document). This is
 * the instrument for them.
 *
 * Subject: /system/ui-lab's fixture rows (kind `content`, no renderer) —
 * so the spec needs NO rows in the hermetic database and stays
 * EMPTY-DATA TOLERANT like every other spec here.
 *
 * Measured while writing it (hermetic dev server, Chromium): on a phone the
 * inspector is a modal bottom sheet whose scrim covers the tab bar, so MORE
 * cannot even be opened over it — the two-layer Esc scenario is a DESKTOP
 * one, where the inspector docks as a non-modal panel beside the page. And
 * a key pressed before the grammar is armed is simply lost, so every test
 * waits for `html[data-selection-grammar="1"]` (set by the hook's effect).
 */
import { test, expect, type Page } from "@playwright/test";

const LAB = "/system/ui-lab";
const ROWS = '[data-selection-scope="ui-lab-fixtures"] [data-entity]';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function openLab(page: Page, viewport: { width: number; height: number }, url = LAB) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROWS)).toHaveCount(4);
  // Armed = the grammar's document listener is attached (the host is
  // Suspense-wrapped and can mount a commit after the rest of the layout).
  // A key pressed before this point is simply lost — measured: the tab
  // bar's own mount signal was not enough.
  await page.waitForSelector('html[data-selection-grammar="1"]', { state: "attached" });
}

test.describe("selection grammar · /system/ui-lab fixtures", () => {
  test("j/k focus, x selects, the bar counts — and a client-side route change clears it (P1: selection followed the operator)", async ({ page }) => {
    await openLab(page, PHONE);
    const rows = page.locator(ROWS);

    await page.keyboard.press("j");
    await expect(rows.nth(0)).toHaveAttribute("data-entity-focused", "true");
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toHaveAttribute("data-entity-focused", "true");
    await expect(rows.nth(0)).not.toHaveAttribute("data-entity-focused", "true");

    await page.keyboard.press("x");
    await expect(rows.nth(1)).toHaveAttribute("data-entity-selected", "true");
    await page.keyboard.press("k");
    await page.keyboard.press("x");
    await expect(rows.nth(0)).toHaveAttribute("data-entity-selected", "true");
    await expect(page.locator("[data-selection-bar]")).toHaveAttribute("data-selection-bar", "2");

    // CLIENT-SIDE navigation through the primary tab bar (a full reload would
    // prove nothing — the store would simply be recreated).
    const away = page.locator('nav[aria-label="Primary"] a[href]:not([aria-current="page"])').first();
    const href = await away.getAttribute("href");
    await away.click();
    await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
    await expect(page.locator("[data-selection-bar]")).toHaveCount(0);
  });

  test("Esc unwinds one step at a time: peek → selection → inspector (phone sheet)", async ({ page }) => {
    await openLab(page, PHONE);
    const rows = page.locator(ROWS);
    const sheet = page.locator('[data-inspector="sheet"]');

    await page.keyboard.press("j");
    await expect(rows.nth(0)).toHaveAttribute("data-entity-focused", "true");
    await page.keyboard.press("Space");
    await expect(sheet).toHaveAttribute("data-inspector-mode", "peek");
    // No renderer for `content` → the honest notice, never a blank panel.
    await expect(sheet.locator('[data-inspector-state="unknown-kind"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await page.keyboard.press("x");
    await expect(rows.nth(0)).toHaveAttribute("data-entity-selected", "true");
    await page.keyboard.press("Escape");
    await expect(rows.nth(0)).not.toHaveAttribute("data-entity-selected", "true");
    await expect(page.locator("[data-selection-bar]")).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(sheet).toHaveAttribute("data-inspector-mode", "inspect");
    await expect(page).toHaveURL(/inspect=content(:|%3A)fx-1/);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page).not.toHaveURL(/inspect=/);
  });

  test("one Esc closes one layer: the MORE sheet, not the docked inspector under it (P1: one Esc closed two layers)", async ({ page }) => {
    await openLab(page, DESKTOP, `${LAB}?inspect=content:fx-1`);
    const panel = page.locator('[data-inspector="panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-inspector-mode", "inspect");

    await page.getByRole("button", { name: "All surfaces" }).click();
    const more = page.getByRole("dialog", { name: "More navigation" });
    await expect(more).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(more).toHaveCount(0); // the sheet unmounts after its exit frame
    await expect(panel).toBeVisible(); // the inspector did NOT close with it
    await expect(page).toHaveURL(/inspect=content(:|%3A)fx-1/);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/inspect=/);
  });

  test("on a phone the inspector sheet is modal: its scrim covers the tab bar (the layering case cannot arise there)", async ({ page }) => {
    await openLab(page, PHONE, `${LAB}?inspect=content:fx-1`);
    await expect(page.locator('[data-inspector="sheet"]')).toBeVisible();
    const hit = await page.evaluate(() => {
      const more = document.querySelector<HTMLElement>('button[aria-label="More — all surfaces and search"]');
      if (!more) return "no-more-button";
      const r = more.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top?.closest('[data-inspector="sheet"]') ? "sheet-on-top" : "tab-bar-on-top";
    });
    expect(hit).toBe("sheet-on-top");
  });
});

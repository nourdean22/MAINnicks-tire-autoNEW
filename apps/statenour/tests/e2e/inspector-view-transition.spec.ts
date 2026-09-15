// Mutation receipt (2026-09-15, hermetic dev server + Chromium in the session container, 3/3 green before):
//   inspector-host.tsx with the <ViewTransition> wrapper replaced by a Fragment (same tree, no boundary)
//   -> test 1 red at line 66 ("expect(received).toBeGreaterThanOrEqual(1) · Received: 0" — no view
//   transition on open) and test 3 red at line 97 ("toBeGreaterThan(0) · Received: 0" — none on close);
//   test 2 (peek stays at 0) green either way, as the control should be. Restored byte-for-byte from the
//   scratchpad copy (diff: 0 lines); 3/3 green after, 7/7 with selection-grammar.spec.ts in the same run.
/**
 * `<ViewTransition>` on the inspector, in a real browser (2026-09-15, UI workbench wave 3.6).
 *
 * React starts a browser View Transition only when a `<ViewTransition>` boundary
 * is affected by a Transition update — so the instrument is the browser API itself:
 * `document.startViewTransition` is wrapped before any page script runs and every
 * call is counted. Opening the inspector from a row (router.push, a transition) must
 * call it; closing (router.replace) must call it again; PEEK (a synchronous store
 * update, Space while arrowing) must NOT — that instant-ness is the design.
 *
 * Subject: /system/ui-lab's fixture rows (kind `content`, no renderer) — empty-data
 * tolerant like every spec here. Positive control inside every test: the browser
 * HAS `document.startViewTransition` (without it every count is a vacuous zero).
 */
import { test, expect, type Page } from "@playwright/test";

const LAB = "/system/ui-lab";
const ROWS = '[data-selection-scope="ui-lab-fixtures"] [data-entity]';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

declare global {
  interface Window {
    __vtCalls?: number;
  }
}

async function armCounter(page: Page) {
  await page.addInitScript(() => {
    window.__vtCalls = 0;
    const doc = document as Document & { startViewTransition?: (arg?: unknown) => unknown };
    const original = doc.startViewTransition?.bind(document);
    if (!original) return;
    doc.startViewTransition = (arg?: unknown) => {
      window.__vtCalls = (window.__vtCalls ?? 0) + 1;
      return original(arg);
    };
  });
}

const vtCalls = (page: Page) => page.evaluate(() => window.__vtCalls ?? -1);

async function openLab(page: Page, viewport: { width: number; height: number }) {
  await armCounter(page);
  await page.setViewportSize(viewport);
  await page.goto(LAB, { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROWS)).toHaveCount(4);
  // Armed = the grammar's document listener is attached (see selection-grammar.spec.ts).
  await page.waitForSelector('html[data-selection-grammar="1"]', { state: "attached" });
  // Positive control: the API the instrument counts exists in this browser.
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe("function");
  expect(await vtCalls(page)).toBe(0);
}

test.describe("inspector view transition · /system/ui-lab fixtures", () => {
  test("desktop dock: opening from a row starts a view transition, closing starts another", async ({ page }) => {
    await openLab(page, DESKTOP);
    const panel = page.locator('[data-inspector="panel"]');

    await page.locator(ROWS).nth(0).click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-inspector-mode", "inspect");
    const afterOpen = await vtCalls(page);
    expect(afterOpen).toBeGreaterThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(await vtCalls(page)).toBeGreaterThan(afterOpen);
  });

  test("peek stays instant: Space / Esc never start a view transition", async ({ page }) => {
    await openLab(page, DESKTOP);
    const panel = page.locator('[data-inspector="panel"]');

    await page.keyboard.press("j");
    await page.keyboard.press("Space");
    await expect(panel).toHaveAttribute("data-inspector-mode", "peek");
    expect(await vtCalls(page)).toBe(0);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(await vtCalls(page)).toBe(0);
  });

  test("phone sheet: closing starts a view transition (the exit it never had)", async ({ page }) => {
    await openLab(page, PHONE);
    const sheet = page.locator('[data-inspector="sheet"]');

    await page.locator(ROWS).nth(1).click();
    await expect(sheet).toBeVisible();
    const afterOpen = await vtCalls(page);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await vtCalls(page)).toBeGreaterThan(afterOpen);
  });
});

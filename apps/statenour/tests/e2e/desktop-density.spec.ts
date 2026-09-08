import { test, expect } from "@playwright/test";

/**
 * tests/e2e/desktop-density.spec.ts · 2026-09-08 (program section 5.4)
 *
 * Home and Missions earn a second column at >=1280px: the queue on the left,
 * context / evidence as a rail on the right. Below that width the rail follows
 * the queue in flow. Both directions are asserted, so a lost `xl:` class fails
 * the wide case and a rail that never re-flows fails the narrow control.
 * Measured before the change at 1460px: Home used a 720px column (49% of the
 * viewport), Missions a 1024px one (70%), rail nowhere.
 */
const PAGES = [
  { path: "/", main: '[data-home-column="queue"]', rail: '[data-home-column="context"]' },
  { path: "/missions", main: '[data-missions-column="deck"]', rail: '[data-missions-column="context"]' },
] as const;

type Box = { x: number; y: number; w: number; h: number };

async function measure(page: import("@playwright/test").Page, main: string, rail: string) {
  return page.evaluate(
    ([m, r]) => {
      const q = (s: string): Box | null => {
        const el = document.querySelector(s);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return { main: q(m), rail: q(r), vw: window.innerWidth };
    },
    [main, rail] as const,
  );
}

async function open(page: import("@playwright/test").Page, path: string, width: number, rail: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  expect(page.url(), `${path} redirected to auth`).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
  await page.waitForSelector(rail, { state: "attached", timeout: 30_000 });
  await page.waitForTimeout(300);
}

for (const p of PAGES) {
  test(`${p.path} @ 1460px: the context rail sits beside the queue column`, async ({ page }) => {
    await open(page, p.path, 1460, p.rail);
    const b = await measure(page, p.main, p.rail);
    expect(b.main, `${p.path}: queue column missing`).not.toBeNull();
    expect(b.rail, `${p.path}: context rail missing`).not.toBeNull();
    expect(b.rail!.x, "rail starts right of the queue column").toBeGreaterThanOrEqual(b.main!.x + b.main!.w - 1);
    expect(b.main!.w + b.rail!.w, "the two columns use most of the viewport").toBeGreaterThan(0.65 * b.vw);
  });

  test(`${p.path} @ 1090px: the rail follows the queue in flow (control)`, async ({ page }) => {
    await open(page, p.path, 1090, p.rail);
    const b = await measure(page, p.main, p.rail);
    expect(b.main).not.toBeNull();
    expect(b.rail).not.toBeNull();
    expect(b.rail!.y, "rail is below the queue column, not beside it").toBeGreaterThanOrEqual(b.main!.y + b.main!.h - 1);
  });
}

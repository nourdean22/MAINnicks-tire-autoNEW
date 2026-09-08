/**
 * tests/e2e/floating-collision.spec.ts · 2026-09-07 (program D10 acceptance)
 *
 * "No fixed element intersects any button's bounding box on /journal,
 * /missions, /chat at 390, 768, 1090, 1460 px." The NICK side-pane toggle
 * (`position: fixed`, bottom-right) covered "ANSWER NOW" on /journal and the
 * capture "+" on /missions at laptop widths; #2180 reserved a right-hand
 * lane for it on ≥ md. This spec is the instrument: every FLOATING fixed
 * element (not the bottom chrome, not a full-viewport container, not a
 * hidden overlay) is checked against every visible control outside it.
 *
 * Failures print the culprit and the covered control so the fix is obvious.
 */
import { test, expect } from "@playwright/test";

const VIEWPORTS = [390, 768, 1090, 1460] as const;
const PAGES = ["/journal", "/missions", "/chat", "/brain?tab=memory"] as const;

type Box = { x: number; y: number; w: number; h: number };
type Collision = { floating: string; control: string; overlap: Box };

function findCollisions(): { floatingCount: number; controlCount: number; collisions: Collision[] } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const describe = (el: Element) => {
    const e = el as HTMLElement;
    const label = e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 40) || "";
    return `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}[${label}]`;
  };
  const box = (el: Element): Box | null => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const chrome = document.querySelector('nav[aria-label="Primary"]')?.closest(".fixed") ?? null;

  const floating: Element[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    if (chrome && (el === chrome || chrome.contains(el))) continue; // the tab bar reserves its own padding
    const b = box(el);
    if (!b) continue;
    if (b.w >= vw * 0.9 && b.h >= vh * 0.9) continue; // page container / backdrop, not a floater
    if (floating.some((f) => f.contains(el))) continue; // count the outermost floater once
    floating.push(el);
  }

  const controls = Array.from(
    document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input[type="submit"]'),
  );
  const collisions: Collision[] = [];
  for (const f of floating) {
    const fb = box(f)!;
    for (const c of controls) {
      if (f.contains(c) || c.contains(f)) continue;
      if (chrome && chrome.contains(c)) continue;
      const cb = box(c);
      if (!cb) continue;
      if (cb.y >= vh || cb.y + cb.h <= 0) continue; // off-screen controls cannot be covered
      const ox = Math.max(0, Math.min(fb.x + fb.w, cb.x + cb.w) - Math.max(fb.x, cb.x));
      const oy = Math.max(0, Math.min(fb.y + fb.h, cb.y + cb.h) - Math.max(fb.y, cb.y));
      if (ox > 1 && oy > 1) {
        collisions.push({ floating: describe(f), control: describe(c), overlap: { x: ox, y: oy, w: ox, h: oy } });
      }
    }
  }
  return { floatingCount: floating.length, controlCount: controls.length, collisions };
}

for (const width of VIEWPORTS) {
  for (const path of PAGES) {
    test(`no floating element covers a control · ${path} @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      expect(page.url(), `${path} redirected to auth`).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
      await page.waitForTimeout(500); // let fixed elements settle after hydration

      const result = await page.evaluate(findCollisions);
      expect(result.controlCount, `${path} rendered no controls at ${width}px — the probe saw nothing`).toBeGreaterThan(0);
      expect(
        result.collisions,
        `${path} @ ${width}px: ${result.collisions.map((c) => `${c.floating} covers ${c.control} by ${Math.round(c.overlap.w)}×${Math.round(c.overlap.h)}px`).join("; ")}`,
      ).toEqual([]);
    });
  }
}

import { test, expect } from "@playwright/test";

/**
 * tests/e2e/target-size.spec.ts · 2026-09-08 (program section 5.8, WCAG 2.5.8 + 2.4.11)
 *
 * On a phone every visible control is at least 24x24 CSS px, and a control
 * scrolled into view by focus lands above the fixed tab bar, not under it.
 * Known positive before the change (measured live in Chrome on 2026-09-08):
 * Home's two horizon links were 20px tall, and html had no scroll padding.
 */
const PAGES = ["/", "/missions", "/chat"] as const;

type Small = { tag: string; label: string; w: number; h: number };

function audit() {
  const sel = 'a[href],button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const small: Small[] = [];
  let visible = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1 || cs.visibility === "hidden" || cs.display === "none") continue; // sr-only, skip links
    if (cs.pointerEvents === "none") continue;
    visible += 1;
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 24 || h < 24) {
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      small.push({ tag: el.tagName.toLowerCase(), label, w, h });
    }
  }
  const scrollPaddingBottom = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom);
  return { visible, small, scrollPaddingBottom: Number.isFinite(scrollPaddingBottom) ? scrollPaddingBottom : 0 };
}

for (const path of PAGES) {
  test(`every visible control is >= 24px and focus scrolls clear of the tab bar · ${path} @ 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    expect(page.url(), `${path} redirected to auth`).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
    await page.waitForTimeout(500);

    const r = await page.evaluate(audit);
    expect(r.visible, `${path} rendered no controls — the probe saw nothing`).toBeGreaterThan(0);
    expect(r.small, `${path}: controls under 24px: ${r.small.map((s) => `${s.tag} "${s.label}" ${s.w}x${s.h}`).join(" · ")}`).toEqual([]);
    expect(r.scrollPaddingBottom, "html scroll-padding-bottom clears the fixed bottom chrome").toBeGreaterThanOrEqual(80);
  });
}

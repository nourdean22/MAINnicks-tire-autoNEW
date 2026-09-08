import { test, expect } from "@playwright/test";

/**
 * tests/e2e/target-size.spec.ts · 2026-09-08 (program section 5.8; WCAG 2.5.8 + 2.4.11)
 *
 * On a phone every visible control is at least 44x44 CSS px — the house
 * convention (`min-h-[44px]` everywhere; iOS HIG) — and an inline text link
 * is at least 24px (WCAG 2.5.8's inline exception). The only exemption is
 * the bottom pulse ticker (`data-target-audit="exempt"`): it is bottom-chrome
 * geometry and is resized with the chrome, not here.
 *
 * Focus must leave a control clear of the fixed bottom chrome (2.4.11): the
 * second test parks a control under the chrome (the browser considers it
 * visible and will not scroll it — measured), focuses it, and requires the
 * app's focusin handler to lift it. The parked position is the known positive.
 *
 * Known positives before the change (measured live in Chrome, 2026-09-08):
 * horizon links 20px, Accept 36, Dismiss 36, send 40, Morning brief 40,
 * mission move buttons 32px wide, capability badge 32px; html had no
 * scroll padding. First CI run of the 44px floor caught two more, only
 * rendered by the empty hermetic database: the "system healthy" state pill
 * (32px) and the empty-deck "Ask Nick for Recommendations" button (32px).
 */
const PAGES = ["/", "/missions", "/chat"] as const;
// The hermetic CI database renders these three pages short at 390x844 (nothing below the
// fold), so the focus probe also walks pages whose length does not depend on data.
const FOCUS_PAGES = ["/", "/missions", "/chat", "/system", "/settings", "/journal"] as const;

type Small = { kind: string; label: string; w: number; h: number };

function audit() {
  const sel = 'a[href],button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const small: Small[] = [];
  let visible = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    if (el.closest('[data-target-audit="exempt"]')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1 || cs.visibility === "hidden" || cs.display === "none") continue; // sr-only, skip links
    if (cs.pointerEvents === "none") continue;
    visible += 1;
    const inlineLink = el.tagName === "A" && cs.display === "inline";
    const floor = inlineLink ? 24 : 44;
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < floor || h < floor) {
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      small.push({ kind: inlineLink ? "inline-link" : el.tagName.toLowerCase(), label, w, h });
    }
  }
  return { visible, small };
}

function focusProbe() {
  const root = document.documentElement;
  root.style.scrollBehavior = "auto"; // smooth scrolling only delays the measurement
  const chrome = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none") return false;
    const b = el.getBoundingClientRect();
    return b.height > 0 && b.height < window.innerHeight / 2 && b.bottom >= window.innerHeight - 2;
  });
  if (chrome.length === 0) return { skipped: "no bottom chrome" as const };
  const chromeTop = Math.min(...chrome.map((el) => el.getBoundingClientRect().top));
  window.scrollTo(0, 0);
  const docHeight = root.scrollHeight;
  const sel = "a[href],button,input,select,textarea";
  // The WCAG 2.4.11 case: a control fully inside the viewport but UNDER the fixed chrome.
  // The browser considers it visible and will not scroll it on focus (measured on /journal),
  // so the app's focusin handler (components/layout/bottom-tab-bar.tsx) must lift it. The probe
  // parks the control 10px above the viewport bottom, focuses it, and measures.
  // Candidates below the fold with room to be parked AND lifted. Run 6 measured focused=false
  // on /journal: the empty hermetic state leaves that page's controls DISABLED, and a disabled
  // control cannot take focus, so no focusin ever fired. Only a control that actually takes
  // focus measures the handler; the probe walks candidates until one does.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    if (el.closest('[data-target-audit="exempt"]') || getComputedStyle(el).position === "fixed") return false;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("tabindex") === "-1") return false;
    if (el.closest("[inert]")) return false;
    const b = el.getBoundingClientRect();
    if (b.width <= 1 || b.height <= 1 || b.top <= window.innerHeight) return false;
    const bottomAbs = b.bottom + window.scrollY;
    return bottomAbs + 10 + 120 <= docHeight;
  });
  if (candidates.length === 0) return { skipped: "no focusable control below the fold" as const };
  const maxScroll = docHeight - window.innerHeight;
  let tried = 0;
  for (const target of candidates.slice(0, 6)) {
    tried += 1;
    const label = (target.getAttribute("aria-label") || target.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    window.scrollTo(0, 0);
    const b0 = target.getBoundingClientRect();
    window.scrollTo(0, b0.bottom + window.scrollY - window.innerHeight + 10);
    const parkedBottom = target.getBoundingClientRect().bottom; // ~innerHeight - 10: under the chrome
    const scrollBefore = window.scrollY;
    target.focus({ preventScroll: false });
    if (document.activeElement !== target) continue; // not focusable in this state — next candidate
    const lifted = target.getBoundingClientRect().bottom;
    return { chromeTop, parkedBottom, lifted, label, scrollBefore, scrollAfter: window.scrollY, maxScroll, focused: true, tried };
  }
  return { skipped: `no candidate took focus (tried ${tried})` as const };
}

async function open(page: import("@playwright/test").Page, path: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  expect(page.url(), `${path} redirected to auth`).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
  await page.waitForTimeout(500);
}

for (const path of PAGES) {
  test(`every visible control is >= 44px (inline text links >= 24px) · ${path} @ 390px`, async ({ page }) => {
    await open(page, path);
    const r = await page.evaluate(audit);
    expect(r.visible, `${path} rendered no controls — the probe saw nothing`).toBeGreaterThan(0);
    expect(
      r.small,
      `${path}: controls under the floor: ${r.small.map((s) => `${s.kind} "${s.label}" ${s.w}x${s.h}`).join(" · ")}`,
    ).toEqual([]);
  });
}

test("a control focused under the bottom chrome is lifted clear of it (2.4.11) — parked under it first as the known positive", async ({ page }) => {
  let exercised = 0;
  for (const path of FOCUS_PAGES) {
    await open(page, path);
    const r = await page.evaluate(focusProbe);
    if ("skipped" in r) continue;
    exercised += 1;
    expect(r.parkedBottom, `${path}: the probe could not park "${r.label}" under the chrome (known positive)`).toBeGreaterThan(r.chromeTop);
    expect(
      r.lifted,
      `${path}: focused "${r.label}" stays under the bottom chrome (chrome top ${Math.round(r.chromeTop)}, parked ${Math.round(r.parkedBottom)} → ${Math.round(r.lifted)}; scrollY ${Math.round(r.scrollBefore)} → ${Math.round(r.scrollAfter)} of max ${Math.round(r.maxScroll)}; focused=${r.focused})`,
    ).toBeLessThanOrEqual(r.chromeTop + 1);
  }
  expect(exercised, "no page had a control below the fold — the probe exercised nothing").toBeGreaterThan(0);
});

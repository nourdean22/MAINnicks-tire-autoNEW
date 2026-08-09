/**
 * E2E geometry invariants for /chat — the regression net for PR #1369 + #1371.
 *
 * WHAT THESE CATCH. Two separate bugs put the chat composer underneath the
 * bottom tab bar within a week, and neither was caught by any existing test:
 *
 *   #1369 — `.state-aura-drift` carried `filter: saturate(0.72)`. Per CSS
 *           Position L3 §2.1.1, a non-`none` filter makes that ancestor the
 *           containing block for `position: fixed` descendants, so the chat
 *           shell's `inset: 0` stopped meaning "the viewport" and started
 *           meaning "the aura wrapper" — whose box runs past the visible fold.
 *   #1371 — chat-island's visualViewport handler assigned the FULL viewport
 *           height inline. An inline height beats the `h-full` class, so the
 *           island rendered exactly --bottom-chrome-h too tall on every load.
 *
 * Different causes, identical symptom: the composer lands below where the
 * tab bar starts. So the invariant is asserted on the SYMPTOM (the seam) plus
 * the specific mechanism of #1369 (the containing block), which means it also
 * catches causes nobody has thought of yet.
 *
 * WHY NOT AN EXACT SEAM. --bottom-chrome-h is measured at runtime by
 * BottomTabBar's ResizeObserver, but its CSS default (6rem) applies until that
 * publish lands. Both states are CORRECT — the default merely over-reserves,
 * leaving a gap. So the assertion is one-sided: the composer may sit above the
 * bar, never below it. A 2px tolerance absorbs sub-pixel/zoom rounding while
 * still catching the real breaks, which were 43px and 53px.
 *
 * EMPTY-DATA TOLERANT per this suite's contract: the composer and tab bar
 * render on an empty database, so nothing here depends on message rows.
 */
import { test, expect } from "@playwright/test";

/** Structural probe — no test ids required in production components. */
const PROBE = `() => {
  const nav = document.querySelector('nav[aria-label="Primary"]');
  const chrome = nav ? nav.parentElement : null;
  const ta = document.querySelector('textarea');
  const shell = ta ? ta.closest('.fixed') : null;
  const form = ta ? ta.closest('form') : null;
  const composer = form ? form.parentElement : null;
  if (!chrome || !shell || !composer) {
    return { found: false, hasNav: !!nav, hasTextarea: !!ta, hasShell: !!shell };
  }
  const cs = getComputedStyle(shell);

  // A fixed element's offsetParent is null IFF no ancestor establishes a
  // containing block for it. Non-null on a fixed element == trapped.
  // Per-property rules, NOT "anything that isn't none/auto". A naive predicate
  // fingers content-visibility:visible (the DEFAULT, harmless) and will-change:
  // opacity (harmless), which is worse than reporting nothing — it sends the
  // next person after an innocent element. Only these values form a containing
  // block for fixed descendants (CSS Position L3 2.1.1, Transforms L2 3,
  // Contain L2 3.2/3.4). Note contain:size and container-type do NOT.
  const formsCB = (cs2) => {
    const nn = (v) => !!v && v !== 'none';
    if (nn(cs2.transform) || nn(cs2.rotate) || nn(cs2.scale) || nn(cs2.translate)) return 'transform';
    if (nn(cs2.perspective)) return 'perspective';
    if (nn(cs2.filter)) return 'filter';
    if (nn(cs2.backdropFilter)) return 'backdrop-filter';
    if (/\\b(layout|paint|strict|content)\\b/.test(cs2.contain || '')) return 'contain';
    if (/^(auto|hidden)$/.test(cs2.contentVisibility || '')) return 'content-visibility';
    if (/\\b(transform|rotate|scale|translate|perspective|filter|backdrop-filter|contain|content-visibility)\\b/.test(cs2.willChange || '')) return 'will-change';
    return null;
  };

  let culprit = null;
  if (cs.position === 'fixed' && shell.offsetParent !== null) {
    for (let a = shell.parentElement; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const hit = formsCB(acs);
      if (hit) { culprit = { cls: String(a.className).slice(0, 120), prop: hit, value: String(acs[hit === 'backdrop-filter' ? 'backdropFilter' : hit === 'content-visibility' ? 'contentVisibility' : hit === 'will-change' ? 'willChange' : hit]).slice(0, 60) }; break; }
    }
  }

  const composerBottom = composer.getBoundingClientRect().bottom;
  const chromeTop = chrome.getBoundingClientRect().top;
  return {
    found: true,
    shellPosition: cs.position,
    trapped: cs.position === 'fixed' && shell.offsetParent !== null,
    culprit,
    overlapPx: Math.round(composerBottom - chromeTop),
  };
}`;

async function probe(page: import("@playwright/test").Page) {
  await page.goto("/chat");
  // The reservation is published by a ResizeObserver; give layout a beat to
  // settle so this measures the steady state rather than first paint.
  await page.locator("textarea").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1_000);
  return page.evaluate(PROBE) as Promise<Record<string, unknown>>;
}

test.describe("/chat geometry invariants", () => {
  test("the chat shell resolves against the viewport, not a trapping ancestor", async ({ page }) => {
    const r = await probe(page);
    expect(r.found, "chat shell / composer / tab bar not found — selectors drifted").toBe(true);
    expect(r.shellPosition).toBe("fixed");

    // PR #1369. The failure message names the offending ancestor AND the
    // property, so the next person does not have to re-derive it.
    expect(
      r.trapped,
      `chat shell is trapped by an ancestor containing block: ${JSON.stringify(r.culprit)}\n` +
        `A fixed element's inset-0 only means "the viewport" while NO ancestor sets ` +
        `transform / filter / backdrop-filter / perspective / contain / content-visibility / will-change.`,
    ).toBe(false);
  });

  test("the composer never sits underneath the bottom tab bar", async ({ page }) => {
    const r = await probe(page);
    expect(r.found).toBe(true);

    // PR #1371. One-sided on purpose: above the bar is fine, below is the bug.
    expect(
      r.overlapPx as number,
      `composer bottom is ${r.overlapPx}px BELOW the top of the bottom tab bar — ` +
        `it is being painted over. Check for an inline height on the chat island ` +
        `(inline beats h-full) or a new ancestor containing block.`,
    ).toBeLessThanOrEqual(2);
  });
});

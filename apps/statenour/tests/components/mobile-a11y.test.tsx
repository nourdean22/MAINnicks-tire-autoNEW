/**
 * tests/components/mobile-a11y.test.tsx · v10.0.528
 *
 * Locks down the deferred Wave-2 mobile a11y fixes from the v525 audit
 * (docs/audits/a11y-motion-perf-mobile-2026-05-12.md). The vitest env
 * is Node (no jsdom · no testing-library) so we test two ways:
 *
 *   1. SSR markup output via renderToStaticMarkup — for components
 *      that can be rendered in isolation (GlobalTopTicker hides on
 *      "/" so we read its source · BottomPulseTicker requires data ·
 *      ReasoningTrace renders cleanly with just props).
 *   2. Source-file regex assertions for the composer buttons + Send
 *      button + textarea in app/(mastery)/chat/page.tsx — rendering
 *      the whole chat page would require a streaming chat transport
 *      mock the size of which is out of scope. Asserting the literal
 *      Tailwind classname strings is enough to lock the touch-target
 *      contract.
 *
 * Five tests · covering A2 (composer ≥ 44px on mobile · two buttons +
 * Send + textarea) · A3 (ticker min-height ≥ 32px on mobile) · A6 (top
 * + bottom tickers have role="region") · A7 (reasoning-trace toggle
 * has aria-controls pointing at the disclosed contents id).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Cross-domain residuals slice (2026-05-22) · the A7 ReasoningTrace
// test dropped its `renderToStaticMarkup` SSR smoke-render — the
// component now depends on the tRPC Context (it migrated its lazy
// trace fetch onto `trpc.system.agentTraceByMessage`). The a11y
// contract is locked source-side, matching the A6 ticker test. With
// that render gone, `renderToStaticMarkup` + the `ReasoningTrace`
// import are no longer needed in this file.

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readSource(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
}

// ─── 1 · A2 · composer touch targets ─────────────────────────────────

describe("A2 · composer buttons + textarea hit 44px Apple HIG on mobile", () => {
  // 2026-05-25 · Wave X.h · the textarea + composer chrome lifted out
  // of page.tsx into chat-composer.tsx · prior Wave 83 had already
  // extracted composer-toolbar.tsx + composer-send-button.tsx. All
  // touch-target classname contracts now live in components/chat/
  // sibling files · scan each for its specific contract.
  const composerSrc = readSource("components/chat/chat-composer.tsx");
  const toolbarSrc = readSource("components/chat/composer-toolbar.tsx");
  const sendBtnSrc = readSource("components/chat/composer-send-button.tsx");

  it("mic + paperclip + phone buttons render w-11 h-11 on mobile (44px)", () => {
    // The three always-visible composer buttons on mobile.
    // Pattern matches the literal Tailwind classname segments.
    const mic = toolbarSrc.match(
      /shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all/,
    );
    expect(mic).not.toBeNull();

    // Paperclip + Phone share the same w-11 h-11 sm:w-8 sm:h-8 prefix.
    // There must be at least 3 occurrences (mic + paperclip + phone).
    const occurrences = toolbarSrc.match(/w-11 h-11 sm:w-8 sm:h-8/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("Send/Stop button stays at w-11 h-11 sm:w-9 sm:h-9 (44 mobile, 36 desktop)", () => {
    // The Send/Stop button was already at 44px mobile · this asserts
    // the contract didn't regress when the other buttons were bumped.
    const send = sendBtnSrc.match(/shrink-0 relative w-11 h-11 sm:w-9 sm:h-9 rounded-xl/);
    expect(send).not.toBeNull();
  });

  it("textarea min-height is 44px on mobile, 36px on desktop", () => {
    // Was min-h-[40px] sm:min-h-[32px] — both failed Apple HIG (40 < 44)
    // and made the textarea visually shorter than the Send chip on
    // desktop. New contract: min-h-[44px] sm:min-h-[36px].
    expect(composerSrc).toContain("min-h-[44px] sm:min-h-[36px]");
    expect(composerSrc).not.toContain("min-h-[40px] sm:min-h-[32px]");
  });
});

// ─── 2 · A6 · top ticker landmark (source-level check) ───────────────

describe("A6 · GlobalTopTicker source declares role=region landmark", () => {
  it("file contains role='region' + aria-label='Live alerts' + aria-live='off'", () => {
    // Phase B.6a · the inner <Ticker /> migrated onto a tRPC
    // `useQuery`, which needs a QueryClientProvider — so the sticky
    // shell can no longer be SSR-rendered in isolation via
    // renderToStaticMarkup. Source-level check instead · same pattern
    // as the BottomPulseTicker landmark test below.
    const src = readSource("components/hud/global-top-ticker.tsx");
    // Screen reader users get a landmark to jump to / skip past.
    expect(src).toContain('role="region"');
    expect(src).toContain('aria-label="Live alerts"');
    // Marquee items rotate every ~55s · we never want them announced.
    expect(src).toContain('aria-live="off"');
  });
});

// ─── 3 · A6 · bottom ticker landmark (source-level check) ────────────

describe("A6 · BottomPulseTicker source declares role=region landmark", () => {
  it("file contains role='region' + aria-label='System pulse' + aria-live='off'", () => {
    // The bottom ticker returns null when data is null (SSR · no API
    // call) so we read the source to lock the landmark contract.
    const src = readSource("components/ultron/bottom-pulse-ticker.tsx");
    expect(src).toContain('role="region"');
    expect(src).toContain('aria-label="System pulse"');
    expect(src).toContain('aria-live="off"');
  });
});

// ─── 4 · A3 · ticker container ≥ 32px on mobile ──────────────────────

describe("A3 · ticker container bumped to min-h 32px on mobile", () => {
  it("top-strip/ticker.tsx uses min-h-[32px] sm:h-5 (32 mobile, 20 desktop)", () => {
    const src = readSource("components/ultron/top-strip/ticker.tsx");
    // Was h-5 universally · now scales to 32px on mobile for HIG.
    expect(src).toContain("min-h-[32px] sm:h-5");
    // The bare h-5 outer container should be gone — replaced with the
    // responsive version above. (h-5 still appears in the empty-state
    // div's responsive sm:h-5 modifier · that's expected.)
    const bareH5 = src.match(/className="h-5 overflow-hidden/g) ?? [];
    expect(bareH5.length).toBe(0);
  });

  it("bottom-pulse-ticker.tsx uses min-h-[32px] sm:h-5 on the visible state", () => {
    const src = readSource("components/ultron/bottom-pulse-ticker.tsx");
    expect(src).toContain("min-h-[32px] sm:h-5");
  });
});

// ─── 5 · A7 · reasoning-trace aria-controls ──────────────────────────

describe("A7 · ReasoningTrace toggle has aria-controls pointing at disclosed contents", () => {
  it("the toggle button's aria-controls matches the disclosed div's id (when open)", () => {
    // Cross-domain residuals slice (2026-05-22) · ReasoningTrace
    // migrated its lazy trace fetch off `authedFetch` onto
    // `trpc.system.agentTraceByMessage` via `trpc.useUtils()`, which
    // needs a tRPC Context provider — so the component can no longer be
    // SSR-rendered in isolation via renderToStaticMarkup. Source-level
    // check instead · the SAME pattern the A6 GlobalTopTicker test above
    // already adopted for the identical cause (Phase B.6a). The
    // useId() · aria-controls={contentsId} · id={contentsId} regex below
    // fully locks the a11y wiring contract.
    const src = readSource("components/chat/reasoning-trace.tsx");
    expect(src).toContain("const contentsId = useId();");
    // The toggle button declares aria-controls + aria-expanded + the
    // accessible label · all three are the disclosure-pattern contract.
    expect(src).toContain("aria-controls={contentsId}");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain('aria-label="Toggle reasoning trace"');
    // The disclosed contents div carries the matching stable id.
    expect(src).toContain("id={contentsId}");
  });
});

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
  it("top-strip/ticker.tsx uses min-h-[40px] sm:min-h-[28px] (40 mobile, 28 desktop)", () => {
    const src = readSource("components/ultron/top-strip/ticker.tsx");
    // 2026-05-31 · Edge Feed rebuild — the 55s marquee (10px, hover-gated
    // pause/dismiss → dead on touch) became ONE readable/tappable item; the
    // strip min-height grew to 40px mobile / 28px desktop (≥ the 32px HIG
    // floor, and now a real tap target that opens the feed sheet).
    expect(src).toContain("min-h-[40px] sm:min-h-[28px]");
    // The marquee is gone — no `h-5 overflow-hidden` track and no CSS-scroll
    // animation (continuous peripheral motion is the banner-blindness trap the
    // rebuild removed; advance is now a fade on change).
    const bareH5 = src.match(/className="h-5 overflow-hidden/g) ?? [];
    expect(bareH5.length).toBe(0);
    expect(src).not.toContain("ultron-ticker-track");
  });

  it("bottom-pulse-ticker.tsx uses min-h-[32px] sm:h-5 (Edge Feed rebuild — no marquee)", () => {
    const src = readSource("components/ultron/bottom-pulse-ticker.tsx");
    expect(src).toContain("min-h-[32px] sm:h-5");
    // 2026-05-31 · Edge Feed rebuild — the 60s marquee (hover-pause → dead on
    // touch) became a one-item static strip + tap-to-open pulse feed, matching
    // the top ticker. The CSS-scroll track + its keyframes are gone.
    expect(src).not.toContain("ultron-bottom-ticker-track");
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

// ─── 6 · A6 · settings GroupHeading landmark (source-level check) ─────

describe("A6 · Settings GroupHeading declares role=region landmark", () => {
  it("each IA group divider is a labelled region (useId + role=region + aria-labelledby/id pair)", () => {
    // GroupHeading draws the Settings IA cluster dividers (Automation /
    // AI / Scoring …). Pre-2026-06-19 it was a bare <div> → screen
    // readers heard orphaned uppercase labels with no landmark to jump
    // to / skip past. The page is a "use client" tRPC shell that can't
    // SSR in isolation, so we lock the contract source-side · the SAME
    // pattern as the A6 ticker tests + A7 ReasoningTrace above.
    const src = readSource("app/(mastery)/settings/page.tsx");
    expect(src).toContain("const headingId = useId();");
    // Each divider is a navigable landmark labelled by its own heading.
    expect(src).toContain('role="region"');
    expect(src).toContain("aria-labelledby={headingId}");
    expect(src).toContain("id={headingId}");
    // The gold divider rule is purely decorative · hidden from a11y tree.
    expect(src).toContain('aria-hidden="true"');
  });
});

// ─── 7 · A8 · Settings + Home control a11y (2026-06-19 audit) ─────────
// Source-level guards for the 6 confirmed a11y fixes from the multi-lens
// Settings→Home audit. The components are "use client" tRPC shells that
// can't SSR in isolation, so we lock the contracts source-side — same
// pattern as the A6/A7 landmark tests above.

describe("A8 · settings toggles expose switch role + state + name", () => {
  it("push-notification toggle is a role=switch with aria-checked + aria-label", () => {
    // Was a bare <button> → screen readers heard an unnamed button with
    // no on/off state. Matches the in-app Toggle pattern (ai-settings /
    // journal-brain panels already use role=switch + aria-checked).
    const src = readSource("components/settings/push-notification-toggle.tsx");
    expect(src).toContain('role="switch"');
    expect(src).toContain("aria-checked={isSubscribed}");
    expect(src).toContain("aria-label={isSubscribed");
  });

  it("cron kill-switch is a role=switch with aria-checked + aria-label", () => {
    // State was conveyed by colour + knob position only. The decorative
    // Power icon + knob are now aria-hidden.
    const src = readSource("components/settings/cron-control-panel.tsx");
    expect(src).toContain('role="switch"');
    expect(src).toContain("aria-checked={r.enabled}");
    expect(src).toContain("aria-label={`${r.jobName} cron");
  });
});

describe("A8 · home Action Hub tabs expose selected state", () => {
  it("each view-switcher button declares aria-pressed (house pattern, not a partial tablist)", () => {
    // Active tab was colour/underline only. aria-pressed matches the
    // in-card selector idiom (brain/board-tab.tsx) — honest about there
    // being no roving-tabindex arrow-key tab navigation.
    const src = readSource("components/home/home-action-hub.tsx");
    expect(src).toContain("aria-pressed={isActive}");
  });
});

describe("A8 · home triage form controls have accessible names", () => {
  it("inbox-tasks-triage date inputs are labelled (schedule + snooze)", () => {
    // Bare <input type=date> has no intrinsic name; the nearby caption
    // was not programmatically associated (WCAG 4.1.2).
    const src = readSource("components/home/inbox-tasks-triage.tsx");
    expect(src).toContain('aria-label="Select due date"');
    expect(src).toContain('aria-label="Snooze until custom date"');
  });

  it("inbox-triage-card next-action input is labelled (not placeholder-only)", () => {
    // A placeholder is not a reliable accessible name.
    const src = readSource("components/home/inbox-triage-card.tsx");
    expect(src).toContain('aria-label="Next physical action"');
  });
});

// ─── 8 · A9 · Settings + Home audit batch 2 (2026-06-19) ─────────────
// Source-level guards for the 28-finding second-pass audit fixes.

describe("A9 · settings selector/filter groups expose aria-pressed", () => {
  it("skill-library tabs + journal/ai SegmentedSelect + intelligence filters declare aria-pressed", () => {
    expect(readSource("components/settings/skill-library-panel.tsx")).toContain("aria-pressed={sel}");
    // SegmentedSelect/Toggle were de-duplicated into settings-controls.tsx —
    // assert the shared source carries the contract and both panels consume it.
    const controls = readSource("components/settings/settings-controls.tsx");
    expect(controls).toContain("aria-pressed={value === o}");
    expect(controls).toContain('role="switch"');
    expect(readSource("components/settings/ai-settings-panel.tsx")).toContain('from "./settings-controls"');
    expect(readSource("components/settings/journal-brain-panel.tsx")).toContain('from "./settings-controls"');
    const flags = readSource("components/settings/intelligence-flags-panel.tsx");
    expect(flags).toContain("aria-pressed={statusFilter === s}");
    expect(flags).toContain('aria-pressed={overrideState === "ENV"}');
    expect(readSource("components/settings/cron-control-panel.tsx")).toContain("aria-pressed={showDisabledOnly}");
  });

  it("operating-rhythm toggle is a role=switch with aria-checked", () => {
    // Critic's #1 miss — the 3rd toggle-by-colour, same class as the
    // push/cron toggles fixed in PR #224's first batch.
    const src = readSource("components/settings/operating-rhythm-toggle.tsx");
    expect(src).toContain('role="switch"');
    expect(src).toContain("aria-checked={enabled}");
  });
});

describe("A9 · settings icon-only buttons have accessible names", () => {
  it("skill-library row actions + cron fire + identity pin declare aria-label", () => {
    const skill = readSource("components/settings/skill-library-panel.tsx");
    expect(skill).toContain('aria-label="Drop skill"');
    expect(skill).toContain('aria-label="Edit trigger and action"');
    expect(readSource("components/settings/cron-control-panel.tsx")).toContain("aria-label={`fire ${r.jobName} now`}");
    expect(readSource("components/settings/identity-panel.tsx")).toContain("override`}");
    expect(readSource("components/settings/intelligence-flags-panel.tsx")).toContain('aria-label="Search feature flags"');
  });
});

describe("A9 · coach-event dismiss is reachable on the iOS PWA", () => {
  it("uses a valid hover-none Tailwind variant, not the broken raw-CSS string", () => {
    // HIGH: the old "@media (hover: none) {!important opacity:100}" string
    // emitted garbage tokens, leaving the opacity-0 dismiss button
    // permanently invisible on touch (no hover/focus path in standalone PWA).
    const src = readSource("components/mastery/coach-event-banner.tsx");
    expect(src).toContain("[@media(hover:none)]:opacity-100");
    expect(src).not.toContain("{!important opacity:100}");
  });
});

describe("A9 · ultron cards bind to a defined text token", () => {
  it("system-health / hq-errors / deploy-chip no longer reference the undefined --text-muted", () => {
    // --text-muted is defined nowhere in globals.css, so the arbitrary
    // value resolved to an invalid colour. All swapped to --text-tertiary.
    for (const f of [
      "components/ultron/system-health-card.tsx",
      "components/ultron/hq-errors-card.tsx",
      "components/ultron/deploy-chip.tsx",
    ]) {
      expect(readSource(f)).not.toContain("var(--text-muted)");
    }
  });
});

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

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

// BottomPulseTicker's data hooks, mocked so the component renders under the
// Node vitest env (no QueryClientProvider). The module-scope lets remain
// reassignable so the null-branch control below can prove the mock is
// load-bearing.
const defaultPulse = () => ({
  items: [{ id: "p1", kind: "reflection", glyph: "◉", label: "BRAIN", text: "reflection is 3 days old", tone: "info" as const }],
});
const defaultTicker = () => ({ items: [] as unknown[] });
let pulseData: ReturnType<typeof defaultPulse> | null = defaultPulse();
let tickerData: ReturnType<typeof defaultTicker> | null = defaultTicker();

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      personalPulse: { useQuery: () => ({ data: pulseData, refetch: vi.fn() }) },
      ticker: { useQuery: () => ({ data: tickerData }) },
      resolveCommitment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/use-dismissed-ticker", () => ({
  useDismissedTicker: () => ({ dismissed: new Set<string>(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/state/nour-state", () => ({
  useNourState: () => ({ currentState: "focus", setState: vi.fn() }),
}));

import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";

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
  // 2026-07-11 · wave 4 · the v1 chat-composer/composer-toolbar/
  // composer-send-button stack was deleted (dead code). The LIVE composer
  // is features/chat-v2/components/chat-composer.tsx — this test now
  // guards ITS touch-target contract so the regression the v1 test was
  // watching for can't reappear on the surface that actually ships.
  const composerSrc = readSource("features/chat-v2/components/chat-composer.tsx");

  it("composer icon buttons render h-11 w-11 (44px) — now on ALL breakpoints", () => {
    // 2026-07-25 pin refresh: the #1035 composer restyle DROPPED the
    // `sm:h-9 sm:w-9` desktop shrink — buttons keep 44px everywhere,
    // an a11y upgrade. Pin the current spelling; the contract is
    // unchanged (≥2 icon buttons at 44px: attach + mic minimum).
    const occurrences = composerSrc.match(/h-11 w-11/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("Send ⇄ Stop morph button is 44px on mobile (h-11 w-11)", () => {
    // Both the streaming-Stop button and the idle-Send button are
    // h-11 w-11 shrink-0 (44px). At least 2 occurrences (Stop + Send).
    const occurrences = composerSrc.match(/h-11 w-11 shrink-0/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("textarea min-height is 44px on mobile", () => {
    // 2026-07-25 pin refresh: `min-h-11` is Tailwind's spacing-scale
    // spelling of the same 44px the old arbitrary `min-h-[44px]` pinned.
    expect(composerSrc).toContain("min-h-11");
  });
});

// ─── 2-4 · A6 + A3 · the LIVE ticker, RENDERED (audit W-3, 2026-09-01) ──
//
// These used to be `readFileSync(...).toContain(...)` on three files. A
// source-text assertion cannot tell a correctly-styled live component from a
// correctly-styled dead one: GlobalTopTicker had been unmounted since #158
// (2026-06-16) and its A6 test stayed green for eleven weeks. That file and
// its top-strip children (ticker.tsx, hq-status-chips.tsx) are deleted;
// tests/repo/ui-mount-graph.test.ts owns the status of what remains parked.
// The one ticker that ships, BottomPulseTicker, is now
// rendered with its data hooks mocked and the landmark + min-height are
// asserted on the MARKUP it produces.

describe("A6 + A3 · BottomPulseTicker renders the landmark and the 32px floor", () => {
  it("renders role=region + aria-label='System pulse' + aria-live='off' with one item", () => {
    const markup = renderToStaticMarkup(<BottomPulseTicker />);
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="System pulse"');
    expect(markup).toContain('aria-live="off"');
  });

  it("the rendered strip carries min-h-[32px] sm:h-5 (Edge Feed rebuild — no marquee)", () => {
    const markup = renderToStaticMarkup(<BottomPulseTicker />);
    expect(markup).toContain("min-h-[32px] sm:h-5");
    expect(markup).not.toContain("ultron-bottom-ticker-track");
  });

  it("control · renders NOTHING when both feeds are empty (the null branch is real)", () => {
    pulseData = null;
    tickerData = null;
    try {
      expect(renderToStaticMarkup(<BottomPulseTicker />)).toBe("");
    } finally {
      pulseData = defaultPulse();
      tickerData = defaultTicker();
    }
  });
});

// ─── 5 · A7 · reasoning-trace aria-controls ──────────────────────────
// REMOVED 2026-07-11 (wave 4): guarded components/chat/reasoning-trace.tsx,
// which was deleted as dead code (zero importers; the live surface is
// reasoning-trace-live.tsx, a streaming panel with no disclosure toggle).

// ─── 6 · A6 · settings GroupHeading landmark (source-level check) ─────

describe("A6 · Settings GroupHeading declares role=region landmark", () => {
  it("each IA group divider is a labelled region (useId + role=region + aria-labelledby/id pair)", () => {
    // GroupHeading draws the Settings IA cluster dividers (Automation /
    // AI / Scoring …). Pre-2026-06-19 it was a bare <div> → screen
    // readers heard orphaned uppercase labels with no landmark to jump
    // to / skip past. The page is a "use client" tRPC shell that can't
    // SSR in isolation, so we lock the contract source-side · the SAME
    // pattern as the A6 ticker tests + A7 ReasoningTrace above.
    const src = readSource("components/settings/settings-console.tsx");
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

describe("A8 · home form controls have accessible names", () => {
  // The 2026-06-19 triage components this block originally guarded were
  // deleted in the Command Surface rebuild (2026-09-01); the contract
  // moves to the new page's form controls in nick-command-line.tsx.
  it("nick command line input is labelled (not placeholder-only)", () => {
    // A placeholder is not a reliable accessible name (WCAG 4.1.2).
    const src = readSource("components/home/nick-command-line.tsx");
    expect(src).toContain('aria-label="Ask Nick"');
    expect(src).toContain('aria-label="send"');
  });

  it("nick response region is a labelled live log", () => {
    const src = readSource("components/home/nick-command-line.tsx");
    expect(src).toContain('role="log"');
    expect(src).toContain(`aria-label="Nick's response"`);
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

// ─── 9 · A10 · settings mutation feedback announces to AT (2026-06-19) ─
// A conditionally-mounted error/confirm banner with no live-region role
// is silently inserted — screen readers don't announce it. role="alert"
// is assertive and announces on insertion (the correct choice for
// conditionally-rendered content; people-scoring's "saved" uses an
// always-mounted role="status" because polite regions must pre-exist).

describe("A10 · settings panels announce mutation errors / confirms to AT", () => {
  it("conditionally-mounted error + confirm banners carry role=alert", () => {
    // push-notification + journal-brain + operating-rhythm rendered a bare
    // <p>/<span> only when the error/confirm was truthy → never announced.
    expect(readSource("components/settings/push-notification-toggle.tsx")).toContain('<p role="alert"');
    expect(readSource("components/settings/journal-brain-panel.tsx")).toContain('<p role="alert"');
    const rhythm = readSource("components/settings/operating-rhythm-toggle.tsx");
    expect(rhythm).toContain('<p role="alert"'); // mutationError banner
    expect(rhythm).toContain('<span role="alert"'); // pending-disable confirm prompt
  });

  it("people-scoring keeps the always-mounted role=status saved announcer (the reference)", () => {
    // Regression guard: the polite "saved" region must stay always-mounted
    // (conditional content, unconditional element) or it stops announcing.
    const src = readSource("components/settings/people-scoring-panel.tsx");
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
  });
});

// ─── 10 · A11 · ultron diagnostics a11y/token hardening (2026-06-19) ──
// Extends the Settings/Home token + tap-target sweep (#224/#226/#228)
// across the ultron HQ surface. Source-asserted — the cards need live
// tRPC + auth to render, so we lock the literal class contracts exactly
// like the A2 composer + A9 ultron-token guards above.
//
// Verified-residue-only scope (an adversarial audit of all 27 ultron
// files found ZERO missing-aria and ZERO native-dialog issues — ARIA and
// the in-DOM confirm primitives were already in place; only neutral-token
// and sub-44px tap-target residue remained).

describe("A11 · ultron diagnostics bind neutral colours to tokens", () => {
  // Only the NEUTRAL families have globals.css tokens, so only they were
  // swapped. Semantic status hues (rose/amber/emerald/sky/red/blue/violet)
  // correctly STAY raw — no token exists for them. The regex fails loudly
  // if a sibling re-introduces a raw neutral into a tokenized file.
  const NEUTRAL_RAW = /\b(?:bg|text|border)-(?:zinc|slate|gray|neutral)-\d{2,3}\b/;
  it("fully-tokenized ultron files contain no raw neutral-palette classes", () => {
    for (const f of [
      "components/ultron/command-spine-pulse.tsx",
      "components/ultron/decision-replay-card.tsx",
      "components/ultron/preferences-card.tsx",
      // situation-card + hq-status-chips dropped 2026-09-01 (audit W-3):
      // no entrypoint reaches them — tests/repo/ui-mount-graph.test.ts
      // owns their status; asserting source text of dead files is a
      // silent instrument.
    ]) {
      expect(readSource(f)).not.toMatch(NEUTRAL_RAW);
    }
  });

  // omni-capture test dropped 2026-09-01 (audit W-3): components/ultron/ask/
  // omni-capture.tsx is an unreachable duplicate of the live
  // components/actions/omni-capture-modal.tsx (see ui-mount-graph PARKED).
});

describe("A11 · ultron interactive controls reach 44px on mobile", () => {
  it("isolated icon buttons grow to 44px on mobile, collapse to dense desktop size", () => {
    // min-* floors win on mobile; sm: returns the control to its original
    // dense desktop dimensions, so desktop is pixel-identical.
    const collapseToMin = "min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px]";
    // contradictions-card / situation-card / next-action-whisperer /
    // active-task-companion dropped 2026-09-01 (audit W-3): unreachable from
    // every entrypoint (ui-mount-graph PARKED). Only live subjects remain.
    expect(readSource("components/ultron/decision-replay-card.tsx")).toContain(collapseToMin);
    expect(readSource("components/ultron/preferences-card.tsx")).toContain(collapseToMin);
  });

  it("dense multi-button rows grow height-only on mobile (no horizontal crowding)", () => {
    // persona-drift's 3-button row + contradiction's 4 resolve choices keep
    // their natural width (adding min-w-[44px] x3/x4 would crowd the
    // excerpt on a 375px screen) and only grow the vertical tap dimension.
    expect(readSource("components/ultron/persona-drift-card.tsx")).toContain("min-h-[44px] sm:min-h-[24px]");
    // contradictions-card assertion + the whole "primary action + disclosure"
    // case dropped 2026-09-01 (audit W-3): both subjects are unreachable.
  });
});

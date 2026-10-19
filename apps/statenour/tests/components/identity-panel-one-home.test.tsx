/**
 * UI v3 W5a: IdentityPanel has one home. The settings census (docs/design/settings-census-2026-10-02.md,
 * section 1) kept it in Settings ("CONFIG", pins written to the self-model) and noted the second mount
 * on /brain's Memory tab with "the ADR should name one home". It is edited in Settings, Identity and
 * Behavior (the default domain), so the Memory tab now carries a one-line link there instead of a
 * second copy of the same editor.
 *
 * Rendered with renderToStaticMarkup; every child panel is a marker, so the count is of mounts.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const { mark, trpcProxy } = vi.hoisted(() => {
  const idle = { data: undefined, isError: false, isLoading: true, isFetching: false, error: null, refetch: async () => {} };
  const handler: ProxyHandler<() => void> = {
    get: (_t, key) => (key === "useQuery" || key === "useInfiniteQuery" ? () => idle : key === "useMutation" ? () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }) : proxy),
    apply: () => proxy,
  };
  const proxy: unknown = new Proxy(() => {}, handler);
  return {
    mark: (name: string) => () => <div data-mark={name} />,
    trpcProxy: proxy,
  };
});

vi.mock("@/lib/trpc/client", () => ({ trpc: trpcProxy }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-idle-warmup", () => ({ useIdleWarmup: () => {} }));

vi.mock("@/components/settings/identity-panel", () => ({ IdentityPanel: mark("identity-panel") }));
vi.mock("@/components/settings/skill-library-panel", () => ({ SkillLibraryPanel: mark("skill-library") }));
vi.mock("@/components/settings/journal-brain-panel", () => ({ JournalBrainPanel: mark("journal-brain") }));
vi.mock("@/components/settings/people-scoring-panel", () => ({ PeopleScoringPanel: mark("people-scoring") }));
vi.mock("@/components/settings/ai-settings-panel", () => ({ AiSettingsPanel: mark("ai-settings") }));
vi.mock("@/components/settings/intelligence-flags-panel", () => ({ IntelligenceFlagsPanel: mark("flags") }));
vi.mock("@/components/settings/operating-rhythm-toggle", () => ({ OperatingRhythmToggle: mark("rhythm") }));
vi.mock("@/components/settings/push-notification-toggle", () => ({ PushNotificationToggle: mark("push") }));
vi.mock("@/components/settings/ticker-dismissal-card", () => ({ TickerDismissalReset: mark("ticker") }));
vi.mock("@/components/brain/memory-of-day-card", () => ({ MemoryOfDayCard: mark("memory-of-day") }));
vi.mock("@/components/brain/qualitative-identity-panel", () => ({ QualitativeIdentityPanel: mark("qualitative-identity") }));
vi.mock("@/components/mastery/coach-event-banner", () => ({ CoachEventBanner: mark("coach") }));
vi.mock("@/components/mastery/mission-breadcrumb", () => ({ MissionBreadcrumb: mark("breadcrumb") }));
vi.mock("@/components/brain/beliefs-panel", () => ({ BeliefsPanel: mark("beliefs") }));
vi.mock("@/components/brain/contradiction-resolution-panel", () => ({ ContradictionResolutionPanel: mark("contradictions") }));
vi.mock("@/components/ultron/ghost-nick/ghost-nick-strip", () => ({ GhostNickStrip: mark("ghost") }));
vi.mock("@/components/ultron/decision-replay-card", () => ({ DecisionReplayCard: mark("replay") }));
vi.mock("@/components/ultron/preferences-card", () => ({ PreferencesCard: mark("preferences") }));
vi.mock("@/components/ultron/persona-drift-card", () => ({ PersonaDriftCard: mark("drift") }));
vi.mock("@/components/brain/nudge-panel", () => ({ NudgePanel: mark("nudge") }));
vi.mock("@/components/brain/brain-maturity-header", () => ({ BrainMaturityHeader: mark("maturity") }));
vi.mock("@/components/brain/prediction-streaks-card", () => ({ PredictionStreaksCard: mark("streaks") }));
vi.mock("@/components/brain/active-alerts-card", () => ({ ActiveAlertsCard: mark("alerts") }));
vi.mock("@/components/brain/tool-telemetry-panel", () => ({ ToolTelemetryPanel: mark("tool-telemetry") }));
vi.mock("@/components/brain/pinned-context-panel", () => ({ PinnedContextPanel: mark("pinned") }));
vi.mock("@/components/brain/suggestion-telemetry-panel", () => ({ SuggestionTelemetryPanel: mark("suggestion-telemetry") }));
vi.mock("@/components/brain/insight-ribbon", () => ({ InsightRibbon: mark("ribbon") }));
vi.mock("@/components/brain/brain-insights-panel", () => ({ BrainInsightsPanel: mark("insights") }));
vi.mock("@/components/brain/self-critique-card", () => ({ SelfCritiqueCard: mark("critique") }));
vi.mock("@/components/brain/recall-inbox-panel", () => ({ RecallInboxPanel: mark("recall-inbox") }));
vi.mock("@/components/brain/recall-preview-panel", () => ({ RecallPreviewPanel: mark("recall-preview") }));
vi.mock("@/components/brain/pattern-card", () => ({ PatternCard: mark("pattern") }));
vi.mock("@/components/brain/anti-patterns-panel", () => ({ AntiPatternsPanel: mark("anti-patterns") }));
vi.mock("@/components/chat/nick-suggestions", () => ({ NickSuggestions: mark("nick-suggestions") }));

import { MemoryTab } from "@/components/brain/memory-tab";
import { SettingsConsole } from "@/components/settings/settings-console";

const count = (html: string, name: string) => html.split(`data-mark="${name}"`).length - 1;

describe("IdentityPanel · one home", () => {
  const brain = renderToStaticMarkup(<MemoryTab />);
  const settings = renderToStaticMarkup(<SettingsConsole />);

  it("the subject is real: both surfaces render their other panels", () => {
    expect(count(brain, "qualitative-identity")).toBe(1);
    expect(count(brain, "beliefs")).toBe(1);
    expect(count(settings, "journal-brain")).toBe(1);
  });

  it("Settings, Identity and Behavior (the default domain) mounts it once", () => {
    expect(count(settings, "identity-panel")).toBe(1);
  });

  it("the Brain Memory tab does not mount a second copy", () => {
    expect(count(brain, "identity-panel")).toBe(0);
  });

  it("the Brain Memory tab links to where it is edited", () => {
    const m = brain.match(/<a [^>]*href="\/settings"[^>]*>([\s\S]*?)<\/a>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/identity/i);
  });
});

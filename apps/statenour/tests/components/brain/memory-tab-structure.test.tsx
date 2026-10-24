/**
 * tests/components/brain/memory-tab-structure.test.tsx - bdnick wave D (2026-10-24).
 *
 * The Brain page's one decision is "correct what the brain believes". The Memory tab used to stack
 * 28 components in six labelled sections, so the contradictions sat under self-model and telemetry
 * panels. It is now nine visible blocks in a fixed order, then three CLOSED native folds (Signals,
 * Self-model, Context). Each fold's summary counts the rows that actually rendered and says
 * "(n unreadable)" when a child's read failed, because a closed fold hides a failed read along with
 * the content (empty-vs-error). The four telemetry and drift panels moved to the Health tab and must
 * not mount here any more (assert-the-consumer: tests/components/brain/health-tab-moves.test.tsx).
 *
 * Every child is a stub except the two inline lines (identity delta, calibration), which read through
 * a proxied tRPC mock. MemoryTab itself is real, so a tab that stops mounting a block or a fold fails.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  q: {} as Record<string, unknown>,
  fail: new Set<string>(),
  lateFail: new Set<string>(),
}));

vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false });
        if (k === "useUtils") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("@/hooks/use-idle-warmup", () => ({ useIdleWarmup: () => undefined }));
vi.mock("@/lib/events/data-change", () => ({ onDataChanged: () => () => undefined }));

/** A child block: one root element, a failed-read marker when told to fail (now or after mount). */
function stub(name: string) {
  return function Stub() {
    const [late, setLate] = useState(false);
    useEffect(() => {
      if (h.lateFail.has(name)) Promise.resolve().then(() => setLate(true));
    }, []);
    if (h.fail.has(name) || late) {
      return <p data-testblock={name} data-read-failed="">{name} couldn&apos;t load</p>;
    }
    return <section data-testblock={name}>{name}</section>;
  };
}

vi.mock("@/components/mastery/coach-event-banner", () => ({ CoachEventBanner: stub("CoachEventBanner") }));
vi.mock("@/components/mastery/mission-breadcrumb", () => ({ MissionBreadcrumb: stub("MissionBreadcrumb") }));
vi.mock("@/components/brain/brain-maturity-header", () => ({ BrainMaturityHeader: stub("BrainMaturityHeader") }));
vi.mock("@/components/brain/memory-verdict", () => ({ MemoryVerdict: stub("MemoryVerdict") }));
vi.mock("@/components/brain/contradiction-resolution-panel", () => ({ ContradictionResolutionPanel: stub("ContradictionResolutionPanel") }));
vi.mock("@/components/brain/beliefs-panel", () => ({ BeliefsPanel: stub("BeliefsPanel") }));
vi.mock("@/components/brain/recall-inbox-panel", () => ({ RecallInboxPanel: stub("RecallInboxPanel") }));
vi.mock("@/components/chat/nick-suggestions", () => ({ NickSuggestions: stub("NickSuggestions") }));
vi.mock("@/components/brain/wisdom-section", () => ({ WisdomSection: stub("WisdomSection") }));
// Signals
vi.mock("@/components/brain/insight-ribbon", () => ({ InsightRibbon: stub("InsightRibbon") }));
vi.mock("@/components/brain/brain-insights-panel", () => ({ BrainInsightsPanel: stub("BrainInsightsPanel") }));
vi.mock("@/components/brain/pattern-card", () => ({ PatternCard: stub("PatternCard") }));
vi.mock("@/components/brain/active-alerts-card", () => ({ ActiveAlertsCard: stub("ActiveAlertsCard") }));
// Self-model
vi.mock("@/components/brain/memory-of-day-card", () => ({ MemoryOfDayCard: stub("MemoryOfDayCard") }));
vi.mock("@/components/settings/skill-library-panel", () => ({ SkillLibraryPanel: stub("SkillLibraryPanel") }));
vi.mock("@/components/brain/qualitative-identity-panel", () => ({ QualitativeIdentityPanel: stub("QualitativeIdentityPanel") }));
vi.mock("@/components/brain/self-critique-card", () => ({ SelfCritiqueCard: stub("SelfCritiqueCard") }));
vi.mock("@/components/ultron/decision-replay-card", () => ({ DecisionReplayCard: stub("DecisionReplayCard") }));
vi.mock("@/components/brain/anti-patterns-panel", () => ({ AntiPatternsPanel: stub("AntiPatternsPanel") }));
vi.mock("@/components/brain/prediction-streaks-card", () => ({ PredictionStreaksCard: stub("PredictionStreaksCard") }));
vi.mock("@/components/ultron/ghost-nick/ghost-nick-strip", () => ({ GhostNickStrip: stub("GhostNickStrip") }));
vi.mock("@/components/ultron/preferences-card", () => ({ PreferencesCard: stub("PreferencesCard") }));
// Context
vi.mock("@/components/brain/nudge-panel", () => ({ NudgePanel: stub("NudgePanel") }));
vi.mock("@/components/brain/pinned-context-panel", () => ({ PinnedContextPanel: stub("PinnedContextPanel") }));
vi.mock("@/components/brain/recall-preview-panel", () => ({ RecallPreviewPanel: stub("RecallPreviewPanel") }));
// Moved to Health: if the Memory tab still imports any of these, the stub renders and the test fails.
vi.mock("@/components/brain/tool-telemetry-panel", () => ({ ToolTelemetryPanel: stub("ToolTelemetryPanel") }));
vi.mock("@/components/brain/suggestion-telemetry-panel", () => ({ SuggestionTelemetryPanel: stub("SuggestionTelemetryPanel") }));
vi.mock("@/components/ultron/persona-drift-card", () => ({ PersonaDriftCard: stub("PersonaDriftCard") }));
vi.mock("@/components/brain/learning-velocity-scoreboard", () => ({ LearningVelocityScoreboard: stub("LearningVelocityScoreboard") }));

import { MemoryTab } from "@/components/brain/memory-tab";

const ok = (data: unknown) => ({ data, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() });
const failed = { data: undefined, isError: true, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryTab />);
  });
  // Let late reads land and the folds' observers report.
  await act(async () => {
    await Promise.resolve();
    // the shared observer takes its first measure on the next animation frame
    await new Promise((r) => setTimeout(r, 40));
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  h.q = {};
  h.fail = new Set();
  h.lateFail = new Set();
});

// Round 5: the verdict leads, before the coach banner and the rest (the tab's one decision first).
const VISIBLE = [
  "MemoryVerdict",
  "CoachEventBanner",
  "MissionBreadcrumb",
  "BrainMaturityHeader",
  "ContradictionResolutionPanel",
  "BeliefsPanel",
  "RecallInboxPanel",
  "NickSuggestions",
  "WisdomSection",
];

function visibleBlocks(): string[] {
  return [...host.querySelectorAll<HTMLElement>("[data-testblock]")]
    .filter((el) => !el.closest("details"))
    .map((el) => el.dataset.testblock!);
}

function fold(title: string): HTMLDetailsElement {
  const match = [...host.querySelectorAll("details")].find((d) =>
    d.querySelector("summary")?.textContent?.trim().startsWith(title),
  );
  expect(match, `fold "${title}" not rendered`).toBeTruthy();
  return match as HTMLDetailsElement;
}

const summary = (title: string) => fold(title).querySelector("summary")!.textContent!.replace(/\s+/g, " ").trim();
const members = (title: string) =>
  [...fold(title).querySelectorAll<HTMLElement>("[data-testblock]")].map((el) => el.dataset.testblock!);

describe("Memory tab: nine visible blocks around the one decision", () => {
  it("shows the eight mounted blocks outside any fold, in order", async () => {
    await mount();
    expect(visibleBlocks()).toEqual(VISIBLE);
  });

  it("puts the identity delta line between Beliefs and the recall inbox, outside any fold", async () => {
    h.q["brain.identityDelta"] = ok({ delta: "Rhythm shifted toward mornings." });
    await mount();
    const line = [...host.querySelectorAll("p")].find((p) => p.textContent?.includes("Rhythm shifted"));
    expect(line, "identity delta line not rendered").toBeTruthy();
    expect(line!.closest("details")).toBeNull();
    const beliefs = host.querySelector('[data-testblock="BeliefsPanel"]')!;
    const inbox = host.querySelector('[data-testblock="RecallInboxPanel"]')!;
    expect(beliefs.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inbox.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("keeps the #contradictions anchor the ticker and Home link to", async () => {
    await mount();
    const anchor = host.querySelector("#contradictions");
    expect(anchor?.querySelector('[data-testblock="ContradictionResolutionPanel"]')).toBeTruthy();
  });

  it("no longer mounts the panels that moved to Health", async () => {
    await mount();
    for (const moved of ["ToolTelemetryPanel", "SuggestionTelemetryPanel", "PersonaDriftCard", "LearningVelocityScoreboard"]) {
      expect(host.querySelector(`[data-testblock="${moved}"]`), moved).toBeNull();
    }
  });
});

describe("Memory tab: three closed folds that count what they hide", () => {
  it("renders exactly three native folds, all closed, with children mounted", async () => {
    await mount();
    const folds = [...host.querySelectorAll("details")];
    expect(folds).toHaveLength(3);
    for (const d of folds) expect(d.open).toBe(false);
    expect(members("Signals")).toEqual(["InsightRibbon", "BrainInsightsPanel", "PatternCard", "ActiveAlertsCard"]);
    expect(members("Self-model")).toEqual([
      "MemoryOfDayCard",
      "SkillLibraryPanel",
      "QualitativeIdentityPanel",
      "SelfCritiqueCard",
      "DecisionReplayCard",
      "AntiPatternsPanel",
      "PredictionStreaksCard",
      "GhostNickStrip",
      "PreferencesCard",
    ]);
    expect(members("Context")).toEqual(["NudgePanel", "PinnedContextPanel", "RecallPreviewPanel"]);
  });

  it("counts the rows that rendered in each summary", async () => {
    await mount();
    expect(summary("Signals")).toMatch(/^Signals \(4\)$/);
    // Nine stubs plus the Settings identity line; the calibration line renders nothing on an empty window.
    expect(summary("Self-model")).toMatch(/^Self-model \(10\)$/);
    expect(summary("Context")).toMatch(/^Context \(3\)$/);
  });

  it("says (n unreadable) when a child's read failed, in every fold", async () => {
    h.fail = new Set(["PatternCard", "AntiPatternsPanel", "RecallPreviewPanel"]);
    h.q["brain.calibrationSummary"] = failed;
    await mount();
    expect(summary("Signals")).toBe("Signals (4) (1 unreadable)");
    // The failed calibration read renders its own line, so it is a row AND unreadable.
    expect(summary("Self-model")).toBe("Self-model (11) (2 unreadable)");
    expect(summary("Context")).toBe("Context (3) (1 unreadable)");
  });

  it("says (1 offline) when the skill library read is paused before any data (Codex 4368647109)", async () => {
    h.q["operator.skills"] = { data: undefined, isError: false, isPending: true, isLoading: false, fetchStatus: "paused", refetch: () => Promise.resolve() };
    await mount();
    expect(summary("Self-model")).toBe("Self-model (10) (1 offline)");
  });

  it("a failed refresh over cached data says stale: identity delta visible, calibration and skills counted in Self-model", async () => {
    const stale = (data: unknown) => ({ data, isError: true, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() });
    h.q["brain.identityDelta"] = stale({ delta: "Rhythm shifted toward mornings." });
    h.q["brain.calibrationSummary"] = stale({ resolved: 0 });
    h.q["operator.skills"] = stale({ active: [], pending: [] });
    await mount();
    const line = [...host.querySelectorAll("p")].find((p) => p.textContent?.includes("Rhythm shifted"))!;
    expect(line.closest("div.space-y-1")?.querySelector('[data-read-state="stale"]')).not.toBeNull();
    // the calibration note is its own row (an empty window); the skills note sits in the skills row
    expect(summary("Self-model")).toBe("Self-model (11) (2 stale)");
  });

  it("follows a read that fails after mount", async () => {
    h.lateFail = new Set(["BrainInsightsPanel"]);
    await mount();
    expect(summary("Signals")).toBe("Signals (4) (1 unreadable)");
  });
});

/**
 * tests/components/brain/stale-reads.test.tsx - bdnick wave D round 6 (Codex 4368942057, 4368942058 and
 * the class sweep).
 *
 * "Stale" (lib/query-state.ts): data is cached but the LAST REFRESH FAILED. A block that keeps drawing the
 * cached rows must say so with the house ReadStateNote (data-read-state="stale"), and a block whose cached
 * answer is empty (so it would hide) must still show the note: a failed refresh is never invisible. Every
 * query-reading block on the Brain Memory tab and its folds is driven here with cached data plus a failed
 * refetch.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false });
        if (k === "useUtils") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch" || k === "setData") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("@/lib/events/data-change", () => ({ onDataChanged: () => () => undefined }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(), info: vi.fn() }) }));

import { MemoryVerdict } from "@/components/brain/memory-verdict";
import { BrainMaturityHeader } from "@/components/brain/brain-maturity-header";
import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";
import { BeliefsPanel } from "@/components/brain/beliefs-panel";
import { RecallInboxPanel } from "@/components/brain/recall-inbox-panel";
import { InsightRibbon } from "@/components/brain/insight-ribbon";
import { PatternCard } from "@/components/brain/pattern-card";
import { MemoryOfDayCard } from "@/components/brain/memory-of-day-card";
import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";
import { AntiPatternsPanel } from "@/components/brain/anti-patterns-panel";
import { PredictionStreaksCard } from "@/components/brain/prediction-streaks-card";
import { NudgePanel } from "@/components/brain/nudge-panel";
import { PinnedContextPanel } from "@/components/brain/pinned-context-panel";
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";
import { PreferencesCard } from "@/components/ultron/preferences-card";

/** Cached data, then a refetch that failed. */
const stale = (data: unknown) => ({ data, isError: true, isPending: false, isLoading: false, fetchStatus: "idle", dataUpdatedAt: Date.now() - 60_000, error: { message: "refetch failed" }, refetch: () => Promise.resolve() });

const maturity = {
  score: 40,
  scoreMax: 90,
  components: {
    skills: { active: 1, graduated: 0, pending: 0 },
    identity: { axes_filled: 4, history_days: 3 },
    qualitative: { entries: 2 },
    beliefs: { active: 5, candidates: 0 },
    contradictions: { open: 3 },
    ghost: { hits: 0, surprises: 0, accuracy: null },
    chat_memory: { importance_rows: 0, distilled_sessions: 0 },
  },
  failedReads: [],
  computed_at: new Date().toISOString(),
};

const CASES: Array<[string, Record<string, unknown>, React.ReactNode]> = [
  ["memory verdict", { "brain.maturity": stale(maturity) }, <MemoryVerdict key="v" />],
  ["maturity line", { "brain.maturity": stale(maturity) }, <BrainMaturityHeader key="m" />],
  ["contradictions", { "brain.contradictions": stale({ contradictions: [], table: { total: 0, shown: 0 } }) }, <ContradictionResolutionPanel key="c" />],
  ["beliefs", { "brain.beliefs": stale({ active: [], candidates: [] }) }, <BeliefsPanel key="b" />],
  ["recall inbox (empty cache)", { "brain.recallInbox": stale({ totalCount: 0 }) }, <RecallInboxPanel key="r" />],
  ["insight ribbon (empty cache)", { "brain.insightsRibbon": stale({ insights: [] }) }, <InsightRibbon key="i" />],
  ["patterns (empty cache)", { "brain.patterns": stale({ patterns: [] }) }, <PatternCard key="p" />],
  ["memory of the day (empty cache)", { "brain.memoryOfTheDay": stale({ memory: null }) }, <MemoryOfDayCard key="d" />],
  ["qualitative identity", { "brain.qualitativeIdentity": stale({ identity: null }) }, <QualitativeIdentityPanel key="q" />],
  ["anti-patterns", { "systemBrain.antiPatterns": stale({ items: [], summary: { total: 0, bySeverity: { critical: 0, warn: 0 } } }) }, <AntiPatternsPanel key="a" />],
  ["prediction streaks", { "brain.predictionStreaks": stale({ topActive: null, freshBreaks: [], byCategory: [] }) }, <PredictionStreaksCard key="s" />],
  ["nudges (empty cache)", { "brain.nudges": stale({ nudges: [] }) }, <NudgePanel key="n" />],
  ["pinned context", { "brain.pinned": stale({ pins: [] }) }, <PinnedContextPanel key="pc" />],
  ["decision replays (empty cache)", { "system.decisionReplays": stale({ due: { unconsumed: [], consumedTodayCount: 0 }, recent: [] }) }, <DecisionReplayCard key="dr" />],
  ["Ghost Nick (empty cache)", { "brain.ghostPredict": stale({ bundle: { predictions: [], predicted_at: new Date().toISOString() }, accuracy: null }) }, <GhostNickStrip key="g" />],
  ["preferences", { "system.preferenceVector": stale({}) }, <PreferencesCard key="pf" />],
];

let host: HTMLDivElement;
let root: Root;
async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  h.q = {};
});

describe("a failed refresh over cached data says stale, never current", () => {
  it.each(CASES)("%s", async (_name, q, node) => {
    h.q = q;
    await mount(node);
    expect(host.querySelector('[data-read-state="stale"]'), host.innerHTML.slice(0, 300)).not.toBeNull();
  });
});

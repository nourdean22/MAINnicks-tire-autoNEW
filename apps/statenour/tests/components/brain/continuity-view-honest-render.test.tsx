/**
 * tests/components/brain/continuity-view-honest-render.test.tsx · 2026-09-02.
 *
 * THREE LABELS ON THIS VIEW DESCRIBED SOMETHING OTHER THAN WHAT THEY DREW.
 *
 * 1 · `:155` rendered `totals.expired` and `:157-161` rendered the IDENTICAL
 *     value as "~N decayed/pruned in the last cycle". A row cannot be both
 *     past-TTL-awaiting-the-sweep and already-pruned; the second label was
 *     the false one, so it read near-zero right after a healthy sweep.
 *
 * 2 · `:190` rendered `+{m.delta24h}/24h` and `:173-174` lit a "hot" flame
 *     from it — but the number was a touched-row count, and recall bumps
 *     `updatedAt` on every wisdom row it returns. A memory that was READ
 *     counted as growth.
 *
 * 3 · `:355` printed `{Math.round(m.confidence * 100)}%` — FORTY LINES below
 *     MemoryRow's own comment (`:314-317`) saying the percentage "was the
 *     lie" and had been removed. `confidence` is a re-sighting counter
 *     (0.5 + 0.1×(sightings−1), capped at 1.0), not a probability;
 *     lib/brain/attention-label.ts exists to make this unrepeatable and says
 *     so: "One helper, so this cannot drift back."
 *
 * The confidence leaderboard is the sharpest case because of what it
 * selects: `confidence >= 0.85` (brain-continuity.ts:200) is almost
 * entirely writer-stamped 0.9/1.0 rows seen ONCE, so "90%" was printed
 * beside memories with no re-sighting history at all.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Payload = ReturnType<typeof payload>;
let reportData: Payload | null = null;

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      continuityReport: {
        useQuery: () => ({
          data: reportData,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
// All three children own their own tRPC reads; none is under test here.
// (BrainChangeLine — `brain.changesSince`, 2026-09-15 wave 3 — has its own
// states test in tests/components/change-set-line-states.test.tsx.)
vi.mock("@/components/brain/receipts-timeline", () => ({
  ReceiptsTimeline: () => null,
}));
vi.mock("@/components/brain/judgment-quality-panel", () => ({
  JudgmentQualityPanel: () => null,
}));
vi.mock("@/components/brain/brain-change-line", () => ({
  BrainChangeLine: () => null,
}));

import { BrainContinuityView } from "@/components/brain/continuity-view";

function memory(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m1",
    category: "wisdom",
    key: "k1",
    content: "ship before it is ready",
    confidence: 0.9,
    seenCount: 1,
    source: "output_critic",
    lastSeen: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...over,
  };
}

function payload() {
  return {
    totals: { allTime: 17_926, active: 17_800, expired: 3, byCategory: {} },
    recent: {
      created: [],
      reinforced: [],
      decayed: [],
      promoted: [],
      prunedLast24h: 137,
    },
    topReinforced: [],
    // A writer-stamped 0.9 seen exactly once — the row the leaderboard is
    // made of, and the row "90%" lied about hardest.
    topConfidence: [memory()],
    categoryMovers: [
      { category: "insight", created24h: 4, created7d: 9, total: 1046 },
      { category: "wisdom", created24h: 0, created7d: 1, total: 254 },
    ],
    computedAt: "2026-09-02T00:00:00.000Z",
  };
}

function render(p: Payload): string {
  reportData = p;
  return renderToStaticMarkup(<BrainContinuityView />);
}

/**
 * The TEXT of every confidence-leaderboard badge. Scoped deliberately: the
 * Sparkline emits `style="width:100%"`, so a whole-document search for
 * "100%" is a false positive — a test that fails against a correct render.
 */
function confidenceBadges(html: string): string[] {
  return [...html.matchAll(/text-violet-400">([^<]*)<\/span>/g)].map(
    (m) => m[1],
  );
}

describe("BrainContinuityView · confidence is never printed as a percentage", () => {
  it("shows the sighting count, not 90%", () => {
    const badges = confidenceBadges(render(payload()));

    expect(badges).toEqual(["seen once"]);
    expect(badges.join(" ")).not.toContain("%");
  });

  it("falls back to the attention label when seenCount is absent", () => {
    const p = payload();
    p.topConfidence = [memory({ seenCount: 0, confidence: 1.0 })];

    const badges = confidenceBadges(render(p));

    // describeConfidenceAsAttention(1.0) — the ceiling, stated as a ceiling.
    expect(badges).toEqual(["seen 6×+"]);
    expect(badges.join(" ")).not.toContain("%");
  });

  it("says what the leaderboard's ordering actually means", () => {
    const html = render(payload());

    expect(html).toContain("a re-sighting counter, not a probability");
  });
});

describe("BrainContinuityView · expired and pruned are two different numbers", () => {
  it("renders the real tombstone count, not the expired backlog again", () => {
    const html = render(payload());

    expect(html).toContain("137");
    expect(html).toContain("tombstoned in the last 24h");
    expect(html).toContain("awaiting the nightly sweep");
    // The old copy, which restated `expired` under a second label.
    expect(html).not.toContain("decayed/pruned in the last cycle");
  });
});

describe("BrainContinuityView · movers show growth, not reads", () => {
  it("renders the new-row count and labels the card accordingly", () => {
    const html = render(payload());

    expect(html).toContain("Category movers · new rows, last 24h");
    expect(html).toContain("+4");
    expect(html).toContain("+9");
  });

  it("CONTROL · a category with real growth still renders its delta", () => {
    // Without this, rendering a hard-coded 0 would satisfy the mover
    // assertions while deleting the signal.
    const p = payload();
    p.categoryMovers = [
      { category: "insight", created24h: 512, created7d: 900, total: 1046 },
    ];
    expect(render(p)).toContain("+512");
  });
});

/**
 * tests/components/board-tab-surfaces-mood-gating.test.tsx · 2026-09-02.
 *
 * The Board tab is the ONLY operator surface for a pattern whose stated
 * premise is that it "preserves divergence rather than fusing lenses into
 * one answer", used "when a decision has compound consequences".
 *
 * Defect 1 · lib/ai/board/consult.ts MOOD_DROP_RULES removes 3 of the
 * strategic board's 5 advisors when mood=depleted and 4 when
 * mood=scattered. `consultBoard` returns `droppedAdvisorIds` and
 * `operatorState`, and a comment there claimed the operator could see
 * both — but `grep -rn "droppedAdvisorIds\|operatorState" components/ app/`
 * returned ZERO matches. Meanwhile the strategic chip promised "5 distinct
 * lenses" and the header printed the count AFTER gating. On a depleted day
 * a "5 lenses" board consulted 3, reported "3 advisors", and explained
 * nothing.
 *
 * Defect 3 · the recent-consultations section was guarded by
 * `recents.length > 0` over `data?.consultations ?? []` with no error
 * branch, so a failed query and an empty history rendered identically —
 * the operator was told they had no history when the truth was that it
 * could not be read.
 *
 * No jsdom or testing-library in this repo (see
 * tests/components/wisdom-pill.test.tsx), so these assert the SSR markup
 * the component actually produces, driven through a mocked tRPC client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type QueryState = {
  data?: { consultations: unknown[] };
  isError: boolean;
  isLoading: boolean;
  error?: { message: string };
  refetch: () => void;
};
type MutationState = {
  data?: { consultation: unknown };
  isPending: boolean;
  isError: boolean;
  error?: { message: string };
  mutateAsync: () => Promise<unknown>;
};

const state = vi.hoisted(() => ({
  query: null as unknown,
  mutation: null as unknown,
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      consultBoard: { useMutation: () => state.mutation },
      recentBoardConsultations: { useQuery: () => state.query },
    },
    useUtils: () => ({
      brain: { recentBoardConsultations: { invalidate: vi.fn() } },
    }),
  },
}));

import { BoardTab } from "@/components/brain/board-tab";

function setQuery(over: Partial<QueryState> = {}) {
  state.query = {
    data: { consultations: [] },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    ...over,
  } satisfies QueryState;
}

function setMutation(over: Partial<MutationState> = {}) {
  state.mutation = {
    isPending: false,
    isError: false,
    mutateAsync: vi.fn(),
    ...over,
  } satisfies MutationState;
}

function take(advisorId: string) {
  return {
    advisorId,
    advisorName: advisorId,
    lensOneLine: "a lens",
    keyInsight: "an insight",
    recommendation: "do the thing",
    confidence: 0.7,
    provider: "venice",
  };
}

function consultation(over: Record<string, unknown> = {}) {
  return {
    boardId: "strategic",
    boardName: "Strategic Board",
    question: "should I raise alignment prices",
    takes: [take("warren-buffett"), take("inversion")],
    synthesis: {
      consensus: [],
      divergences: [],
      recommendation: "hold the price for now",
      confidence: 0.6,
    },
    durationMs: 1200,
    ranAt: "2026-09-02T12:00:00Z",
    operatorState: { mood: "depleted", focus: 0.3, capacity: 0.2, drift: 0.4, momentum: 0.1, confidence: 0.8 },
    droppedAdvisorIds: ["elon-musk", "steve-jobs", "growth-engine"],
    ...over,
  };
}

/** Strip tags so assertions read the operator-visible TEXT, not markup. */
function text(): string {
  return renderToStaticMarkup(<BoardTab />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  setQuery();
  setMutation();
});

describe("defect 1 · the mood gate is visible on the surface it shrinks", () => {
  it("PLANTED POSITIVE · an ungated consultation renders a plain advisor count", () => {
    // Guards the vacuous case: if the component rendered the gating strip
    // unconditionally, every assertion below would pass while proving
    // nothing about the gate.
    setMutation({ data: { consultation: consultation({ droppedAdvisorIds: [], operatorState: null }) } });
    const out = text();
    expect(out).toContain("2 advisors");
    expect(out).not.toContain("lenses withheld");
    expect(out).not.toMatch(/\d+ of \d+ advisors/);
  });

  it("prints the DENOMINATOR when advisors were gated out", () => {
    // "2 advisors" on a 5-advisor board is a silent subtraction. "2 of 5"
    // is a stated one.
    setMutation({ data: { consultation: consultation() } });
    expect(text()).toContain("2 of 5 advisors");
  });

  it("names the advisors that were withheld", () => {
    setMutation({ data: { consultation: consultation() } });
    const out = text();
    expect(out).toContain("lenses withheld (3)");
    expect(out).toContain("elon-musk");
    expect(out).toContain("steve-jobs");
    expect(out).toContain("growth-engine");
  });

  it("names the mood that drove the gate — the absence must have a reason", () => {
    setMutation({ data: { consultation: consultation() } });
    expect(text()).toContain("depleted");
  });

  it("says the synthesis does not speak for the withheld lenses", () => {
    // The synthesis is the operator's primary read; it must not be taken
    // as the board's whole view when 3 of 5 lenses never ran.
    setMutation({ data: { consultation: consultation() } });
    expect(text()).toContain("does not speak for them");
  });

  it("qualifies the advisor-takes header too", () => {
    setMutation({ data: { consultation: consultation() } });
    expect(text()).toContain("advisor takes (2 of 5)");
  });
});

describe("defect 3 · recent consultations distinguish empty from unreadable", () => {
  it("PLANTED POSITIVE · rows render when the query succeeds", () => {
    setQuery({
      data: {
        consultations: [
          {
            id: "r1",
            boardId: "strategic",
            boardName: "Strategic Board",
            question: "should I raise prices",
            ranAt: "2026-09-02T11:00:00Z",
            recommendation: "hold",
            consensusCount: 1,
            divergenceCount: 0,
            confidence: 0.6,
            tension: null,
            advisorCount: 2,
            erroredCount: 0,
            droppedAdvisorIds: [],
            moodAtConsult: null,
            createdAt: "2026-09-02T11:00:00Z",
          },
        ],
      },
    });
    const out = text();
    expect(out).toContain("recent consultations (1)");
    expect(out).toContain("should I raise prices");
  });

  it("a FAILED query says state unknown, not empty", () => {
    setQuery({ data: undefined, isError: true, error: { message: "503 upstream" } });
    const out = text();
    expect(out).toContain("state unknown, not empty");
    expect(out).toContain("503 upstream");
    // and must NOT claim there is no history
    expect(out).not.toContain("no consultations recorded yet");
  });

  it("a genuinely empty history says so, and only then", () => {
    setQuery({ data: { consultations: [] } });
    const out = text();
    expect(out).toContain("no consultations recorded yet");
    expect(out).not.toContain("state unknown");
  });

  it("says nothing about history while the query is still loading", () => {
    setQuery({ data: undefined, isLoading: true });
    const out = text();
    expect(out).not.toContain("no consultations recorded yet");
    expect(out).not.toContain("state unknown");
  });

  it("a history row carries its own gate verdict", () => {
    // Without this a 2-advisor row in history is indistinguishable from a
    // 2-advisor board, on a decision the operator has already acted on.
    setQuery({
      data: {
        consultations: [
          {
            id: "r1",
            boardId: "strategic",
            boardName: "Strategic Board",
            question: "should I raise prices",
            ranAt: "2026-09-02T11:00:00Z",
            recommendation: "hold",
            consensusCount: 1,
            divergenceCount: 0,
            confidence: 0.6,
            tension: null,
            advisorCount: 2,
            erroredCount: 0,
            droppedAdvisorIds: ["elon-musk", "steve-jobs", "growth-engine"],
            moodAtConsult: "depleted",
            createdAt: "2026-09-02T11:00:00Z",
          },
        ],
      },
    });
    const out = text();
    expect(out).toContain("2 of 5 lenses");
    expect(out).toContain("depleted");
  });
});

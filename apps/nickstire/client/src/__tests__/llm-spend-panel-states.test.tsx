/**
 * What the panel SAYS must match which of the facts is actually true.
 *
 * server/llmLedgerRead.test.ts proves the reader keeps writer-state and
 * read-state separate. That is not a render. Per the argument already made in
 * admin-leads-panels-outage.test.tsx, a branch can be present in the source,
 * correctly ordered, typecheck clean, and still never paint — a wrong
 * truthiness test, a sibling branch shadowing it, a crash inside the block.
 * This mounts the real panel and asserts the operator's screen.
 *
 * Three claims are load-bearing and each has a case below:
 *   · a failed read says UNKNOWN, never zero;
 *   · recording being off does NOT hide history, and does NOT let an empty
 *     window be described as a real zero;
 *   · the headline totals are the unbounded ones, and when the lane list is a
 *     subset the panel says so instead of implying the rows add up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Lane = {
  lane: string;
  provider: string;
  calls: number;
  failed: number;
  callsWithTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
};

type Summary = {
  recording: "on" | "off" | "stopped_after_error";
  read: "ok" | "unreadable";
  windowDays: number;
  lanes: Lane[];
  lanesTruncated: boolean;
  totals: {
    calls: number;
    failed: number;
    callsWithTokens: number;
    promptTokens: number;
    completionTokens: number;
    groups: number;
  };
  generatedAt: string;
};

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { system: { llmLedger: { useQuery: () => h.result } } },
}));

import { LlmSpendPanel } from "@/pages/admin/intelligence/LlmSpendPanel";

const laneRow = (over: Partial<Lane> = {}): Lane => ({
  lane: "generateweeklyinsight",
  provider: "gemini",
  calls: 10,
  failed: 2,
  callsWithTokens: 10,
  promptTokens: 1000,
  completionTokens: 500,
  avgLatencyMs: 800,
  maxLatencyMs: 2000,
  ...over,
});

const summary = (over: Partial<Summary>): Summary => ({
  recording: "on",
  read: "ok",
  windowDays: 7,
  lanes: [],
  lanesTruncated: false,
  totals: { calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0, groups: 0 },
  generatedAt: "2026-09-16T13:00:00.000Z",
  ...over,
});

const set = (data: unknown, extra: Partial<typeof h.result> = {}) => {
  Object.assign(h.result, { data, isLoading: false, isError: false, error: null }, extra);
};

describe("LlmSpendPanel — a failed read is UNKNOWN, never zero", () => {
  beforeEach(() => set(undefined));

  it("read: unreadable paints UNKNOWN", () => {
    set(summary({ read: "unreadable" }));
    render(<LlmSpendPanel />);
    expect(screen.getByText(/UNKNOWN, not zero/i)).toBeTruthy();
  });

  it("a failed QUERY also paints UNKNOWN", () => {
    set(undefined, { isError: true, error: { message: "network down" } });
    render(<LlmSpendPanel />);
    expect(screen.getByText(/UNKNOWN, not zero/i)).toBeTruthy();
  });
});

describe("LlmSpendPanel — the writer's state is shown WITH the history, not instead of it", () => {
  beforeEach(() => set(undefined));

  it("recording off still renders the rows already recorded", () => {
    // The regression this exists for: the first draft suppressed the read when
    // recording was off, hiding real history at the moment it mattered most.
    set(
      summary({
        recording: "off",
        lanes: [laneRow()],
        totals: { calls: 10, failed: 2, callsWithTokens: 10, promptTokens: 1000, completionTokens: 500, groups: 1 },
      }),
    );
    render(<LlmSpendPanel />);

    expect(screen.getByText("generateweeklyinsight")).toBeTruthy();
    expect(screen.getByText(/Not recording/i)).toBeTruthy();
    expect(screen.getByText(/will not grow/i)).toBeTruthy();
  });

  it("a writer stopped by a write failure says so, and says the data is a snapshot", () => {
    set(
      summary({
        recording: "stopped_after_error",
        lanes: [laneRow()],
        totals: { calls: 10, failed: 2, callsWithTokens: 10, promptTokens: 1000, completionTokens: 500, groups: 1 },
      }),
    );
    render(<LlmSpendPanel />);

    expect(screen.getByText(/stopped after a write failure/i)).toBeTruthy();
    expect(screen.getByText(/snapshot, not as current usage/i)).toBeTruthy();
  });

  it("recording ON and nothing ran is the ONE case allowed to claim a real zero", () => {
    set(summary({ recording: "on", lanes: [] }));
    render(<LlmSpendPanel />);
    expect(screen.getByText(/real zero/i)).toBeTruthy();
  });

  it("recording OFF and nothing in the window must NOT be called a real zero", () => {
    set(summary({ recording: "off", lanes: [] }));
    render(<LlmSpendPanel />);
    expect(screen.queryByText(/real zero/i)).toBeNull();
    expect(screen.getByText(/not evidence about how much AI ran/i)).toBeTruthy();
  });
});

describe("LlmSpendPanel — totals are the unbounded ones", () => {
  beforeEach(() => set(undefined));

  it("headline numbers come from totals, not from summing the listed lanes", () => {
    // Two lanes shown; the window really holds 140 groups and 5,000 calls.
    set(
      summary({
        lanes: [laneRow({ calls: 10, failed: 0 }), laneRow({ lane: "other", calls: 4, failed: 0 })],
        lanesTruncated: true,
        totals: {
          calls: 5000,
          failed: 250,
          callsWithTokens: 5000,
          promptTokens: 900000,
          completionTokens: 100000,
          groups: 140,
        },
      }),
    );
    render(<LlmSpendPanel />);

    expect(screen.getByText("5,000")).toBeTruthy(); // not 14
    expect(screen.getByText("5.0%")).toBeTruthy(); // 250/5000, not 0/14
    expect(screen.getByText("1,000,000")).toBeTruthy(); // prompt + completion
  });

  it("a truncated lane list is disclosed rather than implying the rows add up", () => {
    set(
      summary({
        lanes: [laneRow()],
        lanesTruncated: true,
        totals: { calls: 5000, failed: 0, callsWithTokens: 5000, promptTokens: 10, completionTokens: 0, groups: 140 },
      }),
    );
    render(<LlmSpendPanel />);
    expect(screen.getByText(/busiest of 140 lane\/provider combinations/i)).toBeTruthy();
  });

  it("partial token coverage is disclosed as a FLOOR", () => {
    set(
      summary({
        lanes: [laneRow({ callsWithTokens: 3 })],
        totals: { calls: 10, failed: 0, callsWithTokens: 3, promptTokens: 200, completionTokens: 100, groups: 1 },
      }),
    );
    render(<LlmSpendPanel />);
    expect(screen.getByText(/is a floor, not/i)).toBeTruthy();
  });

  it("never shows a dollar figure", () => {
    set(
      summary({
        lanes: [laneRow()],
        totals: { calls: 5, failed: 0, callsWithTokens: 5, promptTokens: 900, completionTokens: 100, groups: 1 },
      }),
    );
    const { container } = render(<LlmSpendPanel />);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

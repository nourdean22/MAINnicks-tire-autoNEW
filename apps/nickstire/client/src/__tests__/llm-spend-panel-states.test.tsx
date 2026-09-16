/**
 * "Not recording" must not PAINT as "no AI usage".
 *
 * server/llmLedgerRead.test.ts proves the reader returns three distinct states.
 * That is not a render. Per the argument already made in
 * admin-leads-panels-outage.test.tsx, a branch can be present in the source,
 * correctly ordered, typecheck clean, and still never paint — a wrong
 * truthiness test, a sibling branch shadowing it, a crash inside the block.
 * This mounts the real panel and asserts what the operator's screen says.
 *
 * The distinction matters because the whole reason llm_calls went unread for
 * two weeks is that nobody could see it. A panel that renders an ambiguous
 * zero would be worse than the silence it replaces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Summary = {
  state: "live" | "not_recording" | "unreadable";
  windowDays: number;
  lanes: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  generatedAt: string;
};

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { system: { llmLedger: { useQuery: () => h.result } } },
}));

import { LlmSpendPanel } from "@/pages/admin/intelligence/LlmSpendPanel";

const summary = (over: Partial<Summary>): Summary => ({
  state: "live",
  windowDays: 7,
  lanes: [],
  totals: { calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0 },
  generatedAt: "2026-09-16T13:00:00.000Z",
  ...over,
});

const set = (data: unknown, extra: Partial<typeof h.result> = {}) => {
  h.result.data = data;
  h.result.isLoading = false;
  h.result.isError = false;
  h.result.error = null;
  Object.assign(h.result, extra);
};

describe("LlmSpendPanel — the three states are visually distinct", () => {
  beforeEach(() => set(undefined));

  it("gate off paints NOT RECORDING and names the flag", () => {
    set(summary({ state: "not_recording" }));
    render(<LlmSpendPanel />);

    expect(screen.getByText(/Not recording/i)).toBeTruthy();
    expect(screen.getByText(/LLM_LEDGER_ENABLED/)).toBeTruthy();
    // The load-bearing sentence: it must refuse to characterise AI usage.
    expect(screen.getByText(/says nothing about how much/i)).toBeTruthy();
  });

  it("a failed server read paints UNKNOWN, not zero", () => {
    set(summary({ state: "unreadable" }));
    render(<LlmSpendPanel />);
    expect(screen.getByText(/UNKNOWN, not zero/i)).toBeTruthy();
  });

  it("a failed QUERY (not just a failed read) also paints UNKNOWN", () => {
    set(undefined, { isError: true, error: { message: "network down" } });
    render(<LlmSpendPanel />);
    expect(screen.getByText(/UNKNOWN, not zero/i)).toBeTruthy();
  });

  it("live + no lanes is the ONE case allowed to call itself a real zero", () => {
    set(summary({ state: "live", lanes: [] }));
    render(<LlmSpendPanel />);
    expect(screen.getByText(/real zero/i)).toBeTruthy();
    expect(screen.queryByText(/Not recording/i)).toBeNull();
  });

  it("renders lane rows and a failure rate when calls exist", () => {
    set(
      summary({
        state: "live",
        lanes: [
          {
            lane: "generateweeklyinsight",
            provider: "gemini",
            calls: 10,
            failed: 2,
            callsWithTokens: 10,
            promptTokens: 1000,
            completionTokens: 500,
            avgLatencyMs: 800,
            maxLatencyMs: 2000,
            lastCallAt: null,
          },
        ],
        totals: { calls: 10, failed: 2, callsWithTokens: 10, promptTokens: 1000, completionTokens: 500 },
      }),
    );
    render(<LlmSpendPanel />);

    expect(screen.getByText("generateweeklyinsight")).toBeTruthy();
    expect(screen.getByText("20.0%")).toBeTruthy(); // 2 of 10 failed
    expect(screen.getByText("1,500")).toBeTruthy(); // prompt + completion
  });

  it("partial token coverage is disclosed as a FLOOR, not presented as the total", () => {
    set(
      summary({
        state: "live",
        lanes: [
          {
            lane: "somelane",
            provider: "ollama",
            calls: 10,
            failed: 0,
            callsWithTokens: 3,
            promptTokens: 200,
            completionTokens: 100,
            avgLatencyMs: 100,
            maxLatencyMs: 200,
            lastCallAt: null,
          },
        ],
        totals: { calls: 10, failed: 0, callsWithTokens: 3, promptTokens: 200, completionTokens: 100 },
      }),
    );
    render(<LlmSpendPanel />);
    expect(screen.getByText(/is a floor, not/i)).toBeTruthy();
  });

  it("never shows a dollar figure", () => {
    set(
      summary({
        state: "live",
        lanes: [
          {
            lane: "somelane",
            provider: "gemini",
            calls: 5,
            failed: 0,
            callsWithTokens: 5,
            promptTokens: 900,
            completionTokens: 100,
            avgLatencyMs: 50,
            maxLatencyMs: 90,
            lastCallAt: null,
          },
        ],
        totals: { calls: 5, failed: 0, callsWithTokens: 5, promptTokens: 900, completionTokens: 100 },
      }),
    );
    const { container } = render(<LlmSpendPanel />);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

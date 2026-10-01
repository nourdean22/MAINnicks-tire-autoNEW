/**
 * Q-23 phase 7 · the AI Health score and the AI-usage numbers wear their provenance.
 *
 * AI Health printed a 0-100 "Health Score" in the same type as a count, with
 * nothing saying it is a weighted composite of heuristics. The AI-usage panel
 * printed calls, failure rate and tokens as plain numbers even while the ledger
 * writer was off (the window may be missing calls) or while a third of calls
 * returned no token usage (the total is a floor). Each now carries the word
 * from `@shared/tileProvenance`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  master: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
  ledger: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    intelligence: { masterReport: { useQuery: () => h.master } },
    system: { llmLedger: { useQuery: () => h.ledger } },
  },
}));

import { AIHealthPanel } from "../pages/admin/intelligence/AIHealthPanel";
import { LlmSpendPanel } from "../pages/admin/intelligence/LlmSpendPanel";

afterEach(cleanup);

const master = (summary: Record<string, unknown>) => {
  h.master.data = {
    summary: {
      topAlert: "x", topOpportunity: "y", topRisk: "z",
      score: 72, scoreBreakdown: [], failures: [],
      scoreReliable: true, enginesFailed: 0, enginesTotal: 28,
      ...summary,
    },
  };
};

const scoreTag = (c: HTMLElement) =>
  c.querySelector("[data-score-provenance] [data-provenance]")?.getAttribute("data-provenance");

describe("AIHealthPanel · the score is an estimate, or unknown", () => {
  it("a reliable score is tagged ESTIMATE, never MEASURED", () => {
    master({});
    const { container } = render(<AIHealthPanel />);
    expect(scoreTag(container)).toBe("ESTIMATE");
  });

  it("a score whose engines mostly failed is tagged UNMEASURED", () => {
    master({ scoreReliable: false, enginesFailed: 12 });
    const { container } = render(<AIHealthPanel />);
    expect(scoreTag(container)).toBe("UNMEASURED");
  });
});

const totals = (over: Record<string, number> = {}) => ({
  calls: 10, failed: 2, callsWithTokens: 10, promptTokens: 1000, completionTokens: 500, groups: 1, ...over,
});

const ledger = (over: Record<string, unknown>) => {
  h.ledger.data = {
    recording: "on",
    read: "ok",
    windowDays: 7,
    lanes: [{
      lane: "generateweeklyinsight", provider: "gemini", calls: 10, failed: 2, callsWithTokens: 10,
      promptTokens: 1000, completionTokens: 500, avgLatencyMs: 800, maxLatencyMs: 2000,
    }],
    lanesTruncated: false,
    totals: totals(),
    generatedAt: "2026-10-01T01:00:00.000Z",
    ...over,
  };
};

const tagFor = (c: HTMLElement, what: string) =>
  c.querySelector(`[data-provenance-for="${what}"] [data-provenance]`)?.getAttribute("data-provenance");

describe("LlmSpendPanel · headline numbers wear their provenance", () => {
  it("recording on, full token coverage: all three MEASURED", () => {
    ledger({});
    const { container } = render(<LlmSpendPanel />);
    expect([tagFor(container, "calls"), tagFor(container, "failed"), tagFor(container, "tokens")])
      .toEqual(["MEASURED", "MEASURED", "MEASURED"]);
  });

  it("partial token coverage makes the token total an ESTIMATE, the counts stay MEASURED", () => {
    ledger({ totals: totals({ callsWithTokens: 6 }) });
    const { container } = render(<LlmSpendPanel />);
    expect(tagFor(container, "calls")).toBe("MEASURED");
    expect(tagFor(container, "tokens")).toBe("ESTIMATE");
  });

  it.each(["off", "stopped_after_error"])("recording %s makes every count a lower bound: ESTIMATE", (recording) => {
    ledger({ recording });
    const { container } = render(<LlmSpendPanel />);
    expect([tagFor(container, "calls"), tagFor(container, "failed"), tagFor(container, "tokens")])
      .toEqual(["ESTIMATE", "ESTIMATE", "ESTIMATE"]);
  });

  it("an empty window is a MEASURED zero only while recording", () => {
    ledger({ lanes: [], totals: totals({ calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0, groups: 0 }) });
    const on = render(<LlmSpendPanel />);
    expect(on.container.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("MEASURED");
    cleanup();

    ledger({ recording: "off", lanes: [], totals: totals({ calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0, groups: 0 }) });
    const off = render(<LlmSpendPanel />);
    expect(off.container.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("UNMEASURED");
  });

  it("an unreadable ledger is tagged UNMEASURED", () => {
    ledger({ read: "unreadable" });
    const { container } = render(<LlmSpendPanel />);
    expect(container.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("UNMEASURED");
  });
});

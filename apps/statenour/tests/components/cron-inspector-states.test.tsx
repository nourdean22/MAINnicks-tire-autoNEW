// Mutation receipt (2026-09-15): cron-inspector.tsx zero-runs branch disabled (`h.counts.total === -1`) so an empty
// window renders the metrics -> 1 failed | 3 passed; red: "zero runs is a ZERO empty state" expected the markup to
// contain 'data-provenance="ZERO"' (the metrics rendered over nothing instead). Restored byte-for-byte from the scratchpad copy.
/**
 * CronInspector states (2026-09-15). Two reads: the deck row and the run
 * history. A name the deck does not know is NOT-FOUND (not an empty
 * history); a known job with zero runs is a ZERO empty state, never a
 * success-rate metric over nothing; a failed history read is the ERROR
 * notice inside the runs section with the header intact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({ data: undefined, isLoading: false, isError: false, error: null });
  return { deck: blank(), history: blank(), blank };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    systemAutomation: { cronDeck: { useQuery: () => stubs.deck }, cronRunHistory: { useQuery: () => stubs.history } },
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/system/crons",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { CronInspector } from "@/components/inspector/panels/cron-inspector";

const ENTITY = { kind: "cron", id: "daily-brief" } as const;
const ROW = {
  name: "daily-brief",
  schedule: "15 14 * * *",
  mode: "active",
  category: "brain",
  description: "The 10:15 executive brief push",
  enabled: true,
  lastRunAt: "2026-09-15T14:15:00.000Z",
  lastStatus: "success",
  nextRunAt: "2026-09-16T14:15:00.000Z",
  drift: null,
};
const HISTORY = {
  jobName: "daily-brief",
  sinceDays: 7,
  counts: { total: 7, success: 6, fail: 1 },
  successRate: 85.7,
  median: 1200,
  p95: 2400,
  runs: [
    { id: "r1", status: "success", durationMs: 1200, errorPreview: null, createdAt: "2026-09-15T14:15:00.000Z" },
    { id: "r2", status: "failed", durationMs: 300, errorPreview: "ECONNRESET upstream", createdAt: "2026-09-14T14:15:00.000Z" },
  ],
  generatedAt: "2026-09-15T15:00:00.000Z",
};

beforeEach(() => {
  stubs.deck = { ...stubs.blank(), data: { rows: [ROW] } };
  stubs.history = { ...stubs.blank(), data: HISTORY };
});

const render = () => renderToStaticMarkup(<CronInspector entity={ENTITY} mode="inspect" />);

describe("CronInspector", () => {
  it("deck loading → loading; deck error → error; unknown name → not-found", () => {
    stubs.deck = { ...stubs.blank(), isLoading: true };
    expect(render()).toContain('data-inspector-state="loading"');
    stubs.deck = { ...stubs.blank(), isError: true, error: new Error("boom") };
    expect(render()).toContain('data-inspector-state="error"');
    stubs.deck = { ...stubs.blank(), data: { rows: [] } };
    const nf = render();
    expect(nf).toContain('data-inspector-state="not-found"');
    expect(nf).not.toContain("data-cron-runs");
  });

  it("a known job renders schedule, description, the three metrics and its runs", () => {
    const html = render();
    expect(html).toContain('data-cron-inspector="daily-brief"');
    expect(html).toContain("15 14 * * *");
    expect(html).toContain("The 10:15 executive brief push");
    expect(html).toContain('data-cron-runs="7"');
    expect((html.match(/data-metric-status="measured"/g) ?? []).length).toBe(3);
    expect(html).toContain("data-metric-out-of-range"); // 85.7% is below the 95-100 band
    expect(html).toContain('data-cron-run="failed"');
    expect(html).toContain("ECONNRESET upstream");
  });

  it("zero runs is a ZERO empty state — no success-rate over nothing", () => {
    stubs.history = { ...stubs.blank(), data: { ...HISTORY, counts: { total: 0, success: 0, fail: 0 }, successRate: null, median: null, p95: null, runs: [] } };
    const html = render();
    expect(html).toContain('data-cron-runs="0"');
    expect(html).toContain('data-provenance="ZERO"');
    expect(html).toContain("No runs in the last 7d");
    expect(html).not.toContain("data-metric-status");
  });

  it("a failed history read is the ERROR notice inside the runs section, header intact", () => {
    stubs.history = { ...stubs.blank(), isError: true, error: new Error("timeout") };
    const html = render();
    expect(html).toContain('data-cron-inspector="daily-brief"');
    expect(html).toContain('data-inspector-state="error"');
    expect(html).not.toContain("data-metric-status");
  });
});

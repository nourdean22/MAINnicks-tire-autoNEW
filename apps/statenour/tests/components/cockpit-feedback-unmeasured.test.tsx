/**
 * The cockpit Avg Feedback tile with no thumbs in 30 days (audit 06-F9-N1). The service now returns
 * kpis.averageFeedback = null for "no feedback", and the tile called .toFixed(1) on it: the whole
 * cockpit threw. It renders "unmeasured" instead; a real average still renders signed.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stubs = vi.hoisted(() => ({ stats: undefined as unknown }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      cockpitStats: { useQuery: () => ({ data: stubs.stats, isFetching: false, refetch: async () => {} }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { CockpitObservabilityView } from "@/components/system/cockpit-observability-view";

const kpis = (averageFeedback: number | null) => ({
  kpis: { totalCostCents: 0, p95TtftMs: 0, averageFeedback, pendingApprovalsCount: 0, avgDurationMs: 0 },
});

function feedbackTile(): string {
  const html = renderToStaticMarkup(<CockpitObservabilityView />);
  const start = html.indexOf("Avg Feedback");
  expect(start).toBeGreaterThan(-1); // anchor found, or the checks below scan nothing
  return html.slice(start, start + 600);
}

describe("cockpit Avg Feedback tile", () => {
  it("no feedback in the window renders 'unmeasured', not a crash or +0.0", () => {
    stubs.stats = kpis(null);
    const tile = feedbackTile();
    expect(tile).toContain("unmeasured");
    expect(tile).not.toContain("+0.0");
  });

  it("control: a measured average still renders signed to one decimal", () => {
    stubs.stats = kpis(0.42);
    expect(feedbackTile()).toContain("+0.4");
    stubs.stats = kpis(-0.5);
    expect(feedbackTile()).toContain("-0.5");
  });

  it("before the first load the tile is not a confident +0.0", () => {
    stubs.stats = undefined;
    expect(feedbackTile()).not.toContain("+0.0");
  });
});

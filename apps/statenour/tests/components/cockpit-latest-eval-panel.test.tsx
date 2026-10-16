/**
 * Cockpit "Latest eval" panel (2026-10-10): eval_result has had no writer
 * since 2026-05-28, and the panel drew the leftover 0/75 row as the latest
 * eval. The service now nulls a run older than 7 days and ships its date as
 * `evalLastRanAt`; this pins what the panel RENDERS for each case.
 * Static markup, mocked trpc (alert-inspector-states.test.tsx pattern).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stubs = vi.hoisted(() => ({ stats: undefined as unknown }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      cockpitStats: {
        useQuery: () => ({ data: stubs.stats, isFetching: false, refetch: async () => {} }),
      },
      setActivePromptVersion: { useMutation: () => ({ mutateAsync: async () => {} }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { CockpitObservabilityView } from "@/components/system/cockpit-observability-view";

/** The "Latest eval" panel's markup only, so other panels cannot satisfy a match. */
function evalPanel(): string {
  const html = renderToStaticMarkup(<CockpitObservabilityView />);
  const start = html.indexOf("Latest eval");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

beforeEach(() => {
  stubs.stats = undefined;
});

describe("cockpit Latest eval panel", () => {
  it("a stale run shows its date and no pass rate", () => {
    stubs.stats = { eval: null, evalLastRanAt: "2026-05-27T06:00:00.000Z" };
    const panel = evalPanel();
    expect(panel).toContain("last eval run 2026-05-27, no runs since");
    expect(panel).not.toMatch(/\d+%/);
    expect(panel).not.toContain("No persisted eval result");
  });

  it("positive control: a fresh run still shows its pass rate", () => {
    stubs.stats = {
      eval: { passRate: 0.9, passed: 9, totalRan: 10, ranAt: "2026-10-09T06:00:00.000Z" },
      evalLastRanAt: null,
    };
    const panel = evalPanel();
    expect(panel).toContain("90%");
    expect(panel).toContain("9/10 passed");
  });

  it("no row at all keeps the plain empty copy", () => {
    stubs.stats = { eval: null, evalLastRanAt: null };
    expect(evalPanel()).toContain("No persisted eval result");
  });
});

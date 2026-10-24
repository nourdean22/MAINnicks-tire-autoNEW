/**
 * /system digest cards: a failed read is unknown, never empty, and a receipt's
 * status is never colour alone (audit 2026-10-10 · 09-F7, 09-F8).
 *
 * THE DEFECT. Each of the three digest cards branched `isLoading ? skeleton :
 * data ? content : "No X available."`. A failed tRPC read lands in the last
 * branch, so the page said "No change digest available." / "No evaluations
 * available." / "No recent receipts available." about a read that never
 * completed. The eval card also printed "All grounded truth evaluations are
 * passing!" whenever `failed === 0`, which is true of a run that evaluated
 * nothing (total 0, or every eval "manual" because docs/ is not bundled).
 * And each receipt's status was a 6px colour dot with no word (SC 1.4.1).
 *
 * Rendered with renderToStaticMarkup (node, no DOM: the house pattern). The
 * page's own children panels are stubbed; only the three digest cards are
 * the subject here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

type Q = {
  data: unknown;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string } | null;
  dataUpdatedAt: number;
  refetch: () => Promise<void>;
};

const q = (over: Partial<Q> = {}): Q => ({
  data: undefined,
  isError: false,
  isLoading: false,
  isFetching: false,
  error: null,
  dataUpdatedAt: 0,
  refetch: async () => {},
  ...over,
});

const stub = vi.hoisted(() => ({
  diagnostics: null as unknown,
  changeDigest: null as unknown,
  memoryEvals: null as unknown,
  receiptFeed: null as unknown,
}));

vi.mock("@/lib/trpc/client", () => {
  const idle = () => ({
    data: undefined,
    isError: false,
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: 0,
    refetch: async () => {},
  });
  return {
    trpc: {
      system: {
        diagnostics: { useQuery: () => stub.diagnostics ?? idle() },
        outboxHealth: { useQuery: idle },
        outboxRedrive: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
        healthSummary: { useQuery: idle },
        agendaItems: { useQuery: idle },
        changeDigest: { useQuery: () => stub.changeDigest },
        memoryEvals: { useQuery: () => stub.memoryEvals },
        receiptFeed: { useQuery: () => stub.receiptFeed },
      },
      brain: { status: { useQuery: idle } },
    },
  };
});

vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/hooks/use-pull-refresh", () => ({
  usePullRefresh: () => ({ refreshing: false, onTouchStart: () => {}, onTouchEnd: () => {} }),
}));
const { none } = vi.hoisted(() => ({ none: () => null }));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: none }));
vi.mock("@/components/ultron/deploy-chip", () => ({ DeployChip: none }));
vi.mock("@/components/system/hub-grid", () => ({ SystemHubGrid: none }));
vi.mock("@/components/system/agenda-desk", () => ({ AgendaDesk: none }));
vi.mock("@/components/ultron/observability/observability-row", () => ({ ObservabilityRow: none }));
vi.mock("@/components/ai/page-nick", () => ({ PageNick: none }));
vi.mock("@/components/system/wiring-census-panel", () => ({ WiringCensusPanel: none }));
vi.mock("@/components/system/trust-ladder-panel", () => ({ TrustLadderPanel: none }));
vi.mock("@/components/system/home-decision-panel", () => ({ HomeDecisionPanel: none }));
vi.mock("@/components/system/tool-usage-census-panel", () => ({ ToolUsageCensusPanel: none }));
vi.mock("@/components/system/evidence-gate-panel", () => ({ EvidenceGatePanel: none }));
vi.mock("@/components/system/observability-status-panel", () => ({ ObservabilityStatusPanel: none }));
vi.mock("@/components/system/owner-panel", () => ({ OwnerPanel: none }));
vi.mock("@/components/system/stale-data-panel", () => ({ StaleDataPanel: none }));

import SystemPage from "@/app/(mastery)/system/page";

const evals = (over: Record<string, unknown> = {}) => ({
  total: 4,
  passed: 4,
  failed: 0,
  manual: 0,
  results: [],
  byCategory: {},
  sourcesFound: 2,
  sourcesExpected: 2,
  ...over,
});

const receipt = (status: string, id: string) => ({
  receiptId: id,
  toolName: `tool_${id}`,
  status,
  createdAt: new Date().toISOString(),
  userVisibleSummary: `summary ${id}`,
  metadata: null,
});

const render = () => renderToStaticMarkup(<SystemPage />);

beforeEach(() => {
  stub.diagnostics = null;
  stub.changeDigest = q();
  stub.memoryEvals = q({ data: evals() });
  stub.receiptFeed = q({ data: { items: [], counts: { success: 0, failed: 0 } } });
});

describe("/system digest cards · a failed read is unknown, not empty", () => {
  it("change digest: a failed read says unknown, never 'No change digest available.'", () => {
    stub.changeDigest = q({ isError: true, error: { message: "upstream 500" } });
    const html = render();
    expect(html).not.toContain("No change digest available.");
    expect(html).toContain("unknown · read failed");
    expect(html).toContain("upstream 500");
  });

  it("memory evals: a failed read says unknown, never 'No evaluations available.'", () => {
    stub.memoryEvals = q({ isError: true, error: { message: "boom" } });
    const html = render();
    expect(html).not.toContain("No evaluations available.");
    expect(html).toContain("unknown · read failed");
  });

  it("receipt feed: a failed read says unknown, never 'No recent receipts available.'", () => {
    stub.receiptFeed = q({ isError: true, error: { message: "boom" } });
    const html = render();
    expect(html).not.toContain("No recent receipts available.");
    expect(html).toContain("unknown · read failed");
  });

  it("POSITIVE CONTROL: a successful read with no rows keeps its empty copy", () => {
    const html = render();
    expect(html).toContain("No recent actions recorded.");
    expect(html).not.toContain("read failed");
  });
});

describe("/system eval card · no vacuous pass", () => {
  it("total 0 says no evals ran, never 'passing'", () => {
    stub.memoryEvals = q({ data: evals({ total: 0, passed: 0, failed: 0, manual: 0 }) });
    const html = render();
    expect(html).toContain("no evals ran");
    expect(html).not.toMatch(/passing/i);
  });

  it("every eval manual (docs not bundled) also ran nothing, never 'passing'", () => {
    stub.memoryEvals = q({ data: evals({ total: 6, passed: 0, failed: 0, manual: 6 }) });
    const html = render();
    expect(html).toContain("no evals ran");
    expect(html).not.toMatch(/passing/i);
  });

  it("POSITIVE CONTROL: evals that ran and all passed still say so", () => {
    const html = render();
    expect(html).toContain("no failures");
    expect(html).not.toContain("no evals ran");
  });
});

describe("/system receipt feed · status carries a word, not colour alone", () => {
  it("each status renders a distinct screen-reader word and glyph", () => {
    stub.receiptFeed = q({
      data: {
        items: [
          receipt("success", "a"),
          receipt("failed", "b"),
          receipt("needs_approval", "c"),
          receipt("skipped", "d"),
          receipt("partial", "e"),
        ],
        counts: { success: 1, failed: 1 },
      },
    });
    const html = render();
    for (const word of ["succeeded", "failed", "needs approval", "skipped", "partial"]) {
      expect(html).toContain(`<span class="sr-only">${word}</span>`);
    }
    for (const glyph of ["✓", "×", "!", "◌", "?"]) {
      expect(html).toContain(`>${glyph}</span>`);
    }
    // The colour-only dot is gone.
    expect(html).not.toContain("h-1.5 w-1.5 rounded-full");
  });
});

describe("/system control tower · an offline first load is not 'measuring'", () => {
  it("a paused diagnostics read says NOT MEASURED beside the Offline note, never MEASURING", () => {
    stub.diagnostics = q({ isPending: true, fetchStatus: "paused" } as Partial<Q>);
    const html = render();
    expect(html).toContain("Offline. The tower shows when the connection returns.");
    expect(html).toContain("NOT MEASURED");
    expect(html).not.toContain("MEASURING");
  });

  it("POSITIVE CONTROL: a read still in flight is MEASURING", () => {
    stub.diagnostics = q({ isLoading: true, isPending: true, fetchStatus: "fetching" } as Partial<Q>);
    const html = render();
    expect(html).toContain("MEASURING");
    expect(html).not.toContain("NOT MEASURED");
  });
});

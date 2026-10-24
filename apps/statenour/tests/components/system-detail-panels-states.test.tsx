/**
 * The /system Detail fold hides eight blocks behind a closed summary (wave E1, 2026-10-24).
 * Two promises, asserted per block:
 *   1. empty-vs-error: a failed read renders its own "state unknown" line AND carries
 *      `data-read-failed`, the marker the fold summary counts, so a closed fold can say
 *      "n unreadable" for blocks that fetch for themselves.
 *   2. idiom: the loading state is the house ShimmerSkeleton (`data-skeleton`), not a hand-rolled
 *      animate-pulse bar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; isFetching?: boolean; error?: { message: string } | null };
const state = vi.hoisted(() => ({ q: {} as Q }));

vi.mock("@/lib/trpc/client", () => {
  const node: unknown = new Proxy(function () {}, {
    get: (_t, key: string) => {
      if (key === "useQuery") return () => ({ refetch: async () => {}, dataUpdatedAt: 0, ...state.q });
      if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
      if (key === "useUtils") return () => node;
      return node;
    },
    apply: () => node,
  });
  return { trpc: node };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { WiringCensusPanel } from "@/components/system/wiring-census-panel";
import { TrustLadderPanel } from "@/components/system/trust-ladder-panel";
import { HomeDecisionPanel } from "@/components/system/home-decision-panel";
import { ToolUsageCensusPanel } from "@/components/system/tool-usage-census-panel";
import { EvidenceGatePanel } from "@/components/system/evidence-gate-panel";
import { StaleDataPanel } from "@/components/system/stale-data-panel";
import { ObservabilityStatusPanel } from "@/components/system/observability-status-panel";
import { AgendaDesk } from "@/components/system/agenda-desk";

const FAILED: Q = { data: undefined, isError: true, isLoading: false, error: { message: "boom" } };
const LOADING: Q = { data: undefined, isError: false, isLoading: true };

const blocks: { name: string; render: () => string; skeleton: boolean }[] = [
  { name: "wiring census", render: () => renderToStaticMarkup(<WiringCensusPanel />), skeleton: true },
  { name: "trust ladder", render: () => renderToStaticMarkup(<TrustLadderPanel />), skeleton: true },
  { name: "home decision", render: () => renderToStaticMarkup(<HomeDecisionPanel />), skeleton: true },
  { name: "tool usage census", render: () => renderToStaticMarkup(<ToolUsageCensusPanel />), skeleton: true },
  { name: "evidence gate", render: () => renderToStaticMarkup(<EvidenceGatePanel />), skeleton: true },
  { name: "stale data", render: () => renderToStaticMarkup(<StaleDataPanel />), skeleton: false },
  { name: "observability status", render: () => renderToStaticMarkup(<ObservabilityStatusPanel />), skeleton: false },
  {
    name: "agenda desk",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: () => renderToStaticMarkup(<AgendaDesk queryResult={{ ...state.q } as any} />),
    skeleton: true,
  },
];

afterEach(() => {
  state.q = {};
});

describe("Detail fold blocks: failed read", () => {
  for (const b of blocks) {
    it(`${b.name} marks its failed read so the closed fold can count it`, () => {
      state.q = FAILED;
      const html = b.render();
      expect(html, b.name).toContain("data-read-failed");
      expect(html, b.name).toMatch(/unknown|not (empty|healthy|clean|zero|ready)|failed/i);
    });
  }

  it("control: a loading block is not marked failed", () => {
    for (const b of blocks) {
      state.q = LOADING;
      expect(b.render(), b.name).not.toContain("data-read-failed");
    }
  });
});

describe("Detail fold blocks: loading uses ShimmerSkeleton", () => {
  for (const b of blocks.filter((x) => x.skeleton)) {
    it(`${b.name} loading state is a house skeleton, not animate-pulse`, () => {
      state.q = LOADING;
      const html = b.render();
      expect(html, b.name).toContain("data-skeleton");
      expect(html, b.name).not.toContain("animate-pulse");
    });
  }
});

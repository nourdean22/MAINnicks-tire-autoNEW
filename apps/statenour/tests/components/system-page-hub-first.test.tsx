/**
 * UI v3 W5a: /system is triage first. The hub grid (its attention strip, then the groups) sits
 * directly under the Control tower; the owner panel, the ops row, Nick and the census panels follow
 * it, unchanged and all still mounted. Before W5a the hub rendered LAST, under six panels, so the
 * "Needs attention" strip was a long scroll away on a phone.
 *
 * Rendered with renderToStaticMarkup (the system-page-read-failed pattern): every child panel is a
 * marker, so the assertion is on the order the page actually mounts them, not on source text.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

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
        diagnostics: { useQuery: idle },
        healthSummary: { useQuery: idle },
        agendaItems: { useQuery: idle },
        changeDigest: { useQuery: idle },
        memoryEvals: { useQuery: idle },
        receiptFeed: { useQuery: idle },
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
const { none, mark } = vi.hoisted(() => ({
  none: () => null,
  mark: (name: string) => () => <div data-mark={name} />,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: none }));
vi.mock("@/components/ultron/deploy-chip", () => ({ DeployChip: none }));
vi.mock("@/components/system/agenda-desk", () => ({ AgendaDesk: none }));
vi.mock("@/components/system/hub-grid", () => ({ SystemHubGrid: mark("hub") }));
vi.mock("@/components/system/outbox-redrive-row", () => ({ OutboxRedriveRow: mark("outbox") }));
vi.mock("@/components/system/owner-panel", () => ({ OwnerPanel: mark("owner") }));
vi.mock("@/components/ultron/observability/observability-row", () => ({ ObservabilityRow: mark("observability") }));
vi.mock("@/components/ai/page-nick", () => ({ PageNick: mark("nick") }));
vi.mock("@/components/system/wiring-census-panel", () => ({ WiringCensusPanel: mark("wiring") }));
vi.mock("@/components/system/trust-ladder-panel", () => ({ TrustLadderPanel: mark("trust") }));
vi.mock("@/components/system/home-decision-panel", () => ({ HomeDecisionPanel: mark("home-decision") }));
vi.mock("@/components/system/observability-status-panel", () => ({ ObservabilityStatusPanel: mark("obs-status") }));
vi.mock("@/components/system/tool-usage-census-panel", () => ({ ToolUsageCensusPanel: mark("tool-census") }));
vi.mock("@/components/system/evidence-gate-panel", () => ({ EvidenceGatePanel: mark("evidence") }));
vi.mock("@/components/system/stale-data-panel", () => ({ StaleDataPanel: mark("stale") }));

import SystemPage from "@/app/(mastery)/system/page";

const html = renderToStaticMarkup(<SystemPage />);
const at = (needle: string) => html.indexOf(needle);
const markAt = (name: string) => at(`data-mark="${name}"`);

describe("/system · triage first", () => {
  it("the subject is real: the tower and every panel render once", () => {
    expect(at('id="tower-heading"')).toBeGreaterThan(-1);
    for (const name of ["hub", "outbox", "owner", "observability", "nick", "wiring", "trust", "home-decision", "obs-status", "tool-census", "evidence", "stale"]) {
      expect(html.split(`data-mark="${name}"`).length - 1, name).toBe(1);
    }
  });

  it("the hub grid is the first thing under the Control tower", () => {
    const tower = at('id="tower-heading"');
    const hub = markAt("hub");
    expect(hub).toBeGreaterThan(tower);
    for (const later of ["owner", "observability", "nick", "wiring", "obs-status", "tool-census", "evidence", "stale"]) {
      expect(markAt(later), later).toBeGreaterThan(hub);
    }
  });

  it("the outbox redrive row (the Fleet page's one action, kept) sits right under the hub and before the owner panel", () => {
    expect(markAt("outbox")).toBeGreaterThan(markAt("hub"));
    expect(markAt("outbox")).toBeLessThan(markAt("owner"));
  });

  it("the panels after the hub keep their old order", () => {
    const order = ["owner", "observability", "nick", "wiring", "trust", "home-decision", "obs-status", "tool-census", "evidence", "stale"].map(markAt);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

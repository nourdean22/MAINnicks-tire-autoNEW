/**
 * /system, wave E1 (2026-10-24): the answer to "is anything broken that needs me" is the tower, the
 * exceptions, the hub grid, the outbox row and the owner panel. The nine detail blocks that used to
 * stack under them sit in ONE closed "Detail" fold. A closed fold must not hide a failed read, so its
 * summary says how many blocks inside are unreadable.
 *
 * Same static-render pattern as system-page-hub-first.test.tsx: child panels are markers, the page is
 * rendered once per query state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; error?: { message: string } | null };
const q = vi.hoisted(() => ({ map: {} as Record<string, Q> }));

vi.mock("@/lib/trpc/client", () => {
  const procedure = (name: string) => ({
    useQuery: () => ({
      data: undefined,
      isError: false,
      isLoading: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: 0,
      refetch: async () => {},
      ...(q.map[name] ?? {}),
    }),
  });
  const ns = (names: string[]) => Object.fromEntries(names.map((n) => [n, procedure(n)]));
  return {
    trpc: {
      system: ns(["diagnostics", "healthSummary", "agendaItems", "changeDigest", "memoryEvals", "receiptFeed"]),
      brain: ns(["status"]),
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
vi.mock("@/components/system/agenda-desk", () => ({ AgendaDesk: mark("agenda") }));
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

const render = () => renderToStaticMarkup(<SystemPage />);
afterEach(() => {
  q.map = {};
});

const fold = (html: string) => {
  const start = html.indexOf('aria-label="Detail"');
  if (start < 0) return null;
  const open = html.lastIndexOf("<details", start);
  const end = html.indexOf("</details>", start);
  return { open, tag: html.slice(open, html.indexOf(">", start)), summary: html.slice(html.indexOf("<summary", start), html.indexOf("</summary>", start)), inside: html.slice(html.indexOf("</summary>", start), end) };
};

describe("/system Detail fold", () => {
  it("holds the nine detail blocks in ONE closed fold, below the first-screen answer", () => {
    const html = render();
    expect(html.match(/aria-label="Detail"/g)?.length).toBe(1);
    const f = fold(html);
    expect(f).not.toBeNull();
    expect(f!.tag).not.toMatch(/\sopen/);
    for (const name of ["wiring", "trust", "home-decision", "obs-status", "tool-census", "evidence", "stale", "agenda"]) {
      expect(f!.inside, name).toContain(`data-mark="${name}"`);
    }
    expect(f!.inside).toContain("Reconciliation Summary");
    // The first-screen answer stays above the fold, in today's order.
    for (const name of ["hub", "outbox", "owner", "observability", "nick"]) {
      const at = html.indexOf(`data-mark="${name}"`);
      expect(at, name).toBeGreaterThan(-1);
      expect(at, name).toBeLessThan(f!.open);
    }
  });

  it("measured nothing wrong: the summary claims nothing unreadable", () => {
    const f = fold(render());
    expect(f).not.toBeNull();
    expect(f!.summary).not.toMatch(/unreadable/);
  });

  it("the closed summary says how many page-level reads inside failed", () => {
    // The page's own three reads are counted at render; the self-fetching blocks (AgendaDesk and the
    // census panels) mark `data-read-failed` and the fold counts them after mount
    // (system-detail-panels-states.test.tsx, detail-fold below).
    q.map = {
      changeDigest: { isError: true, error: { message: "boom" } },
      memoryEvals: { isError: true, error: { message: "boom" } },
      receiptFeed: { isError: true, error: { message: "boom" } },
    };
    const f = fold(render());
    expect(f).not.toBeNull();
    expect(f!.summary).toMatch(/3 unreadable/);
  });

  it("a single failed read is counted once, and a failed read still renders its own unknown line inside", () => {
    q.map = { memoryEvals: { isError: true, error: { message: "boom" } } };
    const f = fold(render());
    expect(f).not.toBeNull();
    expect(f!.summary).toMatch(/1 unreadable/);
    expect(f!.inside).toContain("unknown · read failed");
  });
});

/**
 * /system/crons: a job with no runs in 14 days has no success rate (audit
 * 2026-10-10, controller ruling).
 *
 * THE DEFECT. The cron deck used to score a job with zero runs as 100%, so a
 * cron that never fired read as perfectly healthy. The backend now returns
 * `successRate: null` for 0 runs (lib/services/system-pages.ts
 * buildCronCommandDeck). The page typed it `number` and printed
 * `{row.successRate}%`, so null would render as a red "%" (null >= 80 is
 * false). It must say "no runs": not a red %, not 100%.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const stub = vi.hoisted(() => ({ deck: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ system: { cronDeck: { invalidate: async () => {} } } }),
    systemAutomation: {
      cronDeck: { useQuery: () => stub.deck },
      setCronEnabled: { useMutation: () => ({ mutateAsync: async () => ({}) }) },
      runManifestCron: { useMutation: () => ({ mutateAsync: async () => ({}) }) },
    },
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));
vi.mock("@/components/system/knowledge-refresh-panel", () => ({ KnowledgeRefreshPanel: () => null }));
vi.mock("@/components/system/cron-fold-tree", () => ({ CronFoldTree: () => null }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));

import CronsPage from "@/app/(mastery)/system/crons/page";

const row = (name: string, successRate: number | null, runs: number) => ({
  name,
  schedule: "*/5 * * * *",
  mode: "active",
  category: "ingest",
  description: `${name} job`,
  enabled: true,
  lastSuccessAt: null,
  lastFailAt: null,
  success14d: runs,
  fail14d: 0,
  successRate,
  recentDurations: [],
  lastRunAt: null,
  lastRunMs: null,
  lastStatus: null,
  nextRunAt: null,
  drift: null,
});

/** The success-rate cell of one row: the text between its tabular-nums div and the "14d" label. */
function rateCell(html: string, name: string): string {
  const at = html.indexOf(`data-entity="cron:${name}"`);
  expect(at, `row ${name} not rendered`).toBeGreaterThan(-1);
  const rest = html.slice(at);
  const end = rest.indexOf(">14d<");
  const cell = rest.slice(0, end);
  const open = cell.lastIndexOf("font-mono text-sm tabular-nums");
  return cell.slice(open);
}

beforeEach(() => {
  stub.deck = {
    data: {
      rows: [row("never-ran", null, 0), row("all-good", 100, 12), row("all-bad", 0, 9)],
      summary: undefined,
      generatedAt: new Date().toISOString(),
    },
    isPending: false,
    isFetching: false,
    refetch: () => {},
  };
});

describe("/system/crons success rate", () => {
  const html = () => renderToStaticMarkup(<CronsPage />);

  it("a job with no runs says 'no runs', never a percentage", () => {
    const cell = rateCell(html(), "never-ran");
    expect(cell).toContain("no runs");
    expect(cell).not.toContain("%");
    expect(cell).not.toContain("text-rose");
    expect(cell).not.toContain("text-emerald");
  });

  it("POSITIVE CONTROL: measured rates still render as a coloured %", () => {
    expect(rateCell(html(), "all-good")).toContain("100%");
    expect(rateCell(html(), "all-good")).toContain("text-emerald");
    expect(rateCell(html(), "all-bad")).toContain("0%");
    expect(rateCell(html(), "all-bad")).toContain("text-rose");
  });
});

/**
 * /system/crons, wave E1 (2026-10-24): the seven big SummaryCell tiles are one summary line. Every
 * count is still on the page, as words; a tile that existed only because a number exists is gone.
 * No summary (the deck did not load) means no line, never a line of zeros (empty-vs-error).
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
vi.mock("@/components/system/cron-fold-tree", () => ({ CronFoldTree: () => <div data-mark="fold-tree" /> }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));

import CronsPage from "@/app/(mastery)/system/crons/page";

const deck = (summary: unknown) => ({
  data: { rows: [], summary, generatedAt: new Date().toISOString() },
  isPending: false,
  isFetching: false,
  refetch: () => {},
});
const html = () => renderToStaticMarkup(<CronsPage />);
const line = (h: string) => {
  const at = h.indexOf('aria-label="cron summary"');
  return at < 0 ? null : h.slice(at, h.indexOf("</p>", at)).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
};

beforeEach(() => {
  stub.deck = deck({ active: 3, disabled: 1, folded: 2, retired: 1, runs24h: 40, failures24h: 2, drifted: 0 });
});

describe("/system/crons summary", () => {
  it("is ONE line that carries all seven counts as words, ahead of the fold tree", () => {
    const h = html();
    expect(h.match(/aria-label="cron summary"/g)?.length).toBe(1);
    expect(line(h)).toContain("3 active, 1 killed, 2 folded, 1 retired. 40 runs in 24h, 2 failed, 0 drifted.");
    expect(h.indexOf('aria-label="cron summary"')).toBeLessThan(h.indexOf('data-mark="fold-tree"'));
  });

  it("no longer draws seven stat tiles", () => {
    expect(html()).not.toContain("text-2xl font-bold tabular-nums");
  });

  it("a failed deck (no summary) draws no line of zeros", () => {
    stub.deck = deck(undefined);
    expect(line(html())).toBeNull();
  });

  it("failures and drift only take a warning hue when they are above zero", () => {
    expect(html()).toMatch(/class="text-rose-300">2 failed/);
    stub.deck = deck({ active: 3, disabled: 0, folded: 0, retired: 0, runs24h: 5, failures24h: 0, drifted: 0 });
    const quiet = html();
    expect(quiet).toContain("0 failed");
    expect(quiet).not.toMatch(/text-rose-300">0 failed/);
  });
});

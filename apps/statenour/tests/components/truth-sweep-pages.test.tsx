/**
 * Truth sweep 2026-10-23, acceptance 1: the two pages whose failed read showed the wrong thing.
 *
 *  · /system/crons printed "loading…" forever on a failed read (0 isError checks) and, paused,
 *    printed the same.
 *  · Brain insights hid itself on a failed read (`.catch(() => null)` per feed), the same pixels
 *    as "clean week".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const q = vi.hoisted(() => ({ cron: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc/client", () => {
  const mutation = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false };
  return {
    trpc: {
      useUtils: () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: async () => {} }) }) }),
      systemAutomation: {
        cronDeck: { useQuery: () => q.cron },
        setCronEnabled: { useMutation: () => mutation },
        runManifestCron: { useMutation: () => mutation },
      },
    },
  };
});
vi.mock("@/components/system/knowledge-refresh-panel", () => ({ KnowledgeRefreshPanel: () => null }));
vi.mock("@/components/system/cron-fold-tree", () => ({ CronFoldTree: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ open: () => {}, close: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import CronsPage from "@/app/(mastery)/system/crons/page";
import { BrainInsightsView, loadInsightFeeds } from "@/components/brain/brain-insights-panel";

const base = { data: undefined, isLoading: false, isPending: false, isError: false, isFetching: false, fetchStatus: "idle", refetch: () => {} };

beforeEach(() => {
  q.cron = {};
});

describe("/system/crons", () => {
  it("a failed read says state unknown, not 'loading…'", () => {
    q.cron = { ...base, isError: true };
    const html = renderToStaticMarkup(<CronsPage />);
    expect(html).toContain("State unknown, not empty");
    expect(html).not.toContain("loading…");
    expect(html).toContain("Retry");
  });
  it("a paused read says offline, not 'loading…'", () => {
    q.cron = { ...base, isPending: true, fetchStatus: "paused" };
    const html = renderToStaticMarkup(<CronsPage />);
    expect(html).toContain("Offline.");
    expect(html).not.toContain("loading…");
  });
  it("control: a read in flight still says loading", () => {
    q.cron = { ...base, isLoading: true, isPending: true, isFetching: true, fetchStatus: "fetching" };
    expect(renderToStaticMarkup(<CronsPage />)).toContain("loading…");
  });
});

const violation = { id: "v1", key: "k", content: "a principle", origin: "o", violationRate: 0.5, matches: ["m"], confidence: 0.8 };

describe("Brain insights", () => {
  it("every feed failed: says so, naming the count, and is not hidden", () => {
    const html = renderToStaticMarkup(
      <BrainInsightsView violations={null} evolution={null} improve={null} failed={["violations", "evolution", "improve"]} offline={false} />,
    );
    expect(html).toContain("3 of 3 feeds could not load");
    expect(html).toContain("State unknown, not empty");
  });
  it("offline: names the cause and the next action", () => {
    const html = renderToStaticMarkup(
      <BrainInsightsView violations={null} evolution={null} improve={null} failed={["violations", "evolution", "improve"]} offline />,
    );
    expect(html).toContain("Offline. Brain insights shows when the connection returns.");
  });
  it("one feed failed beside one with signal: the signal shows, the failed feed does not claim health", () => {
    const html = renderToStaticMarkup(
      <BrainInsightsView violations={{ violations: [violation], total: 1 }} evolution={null} improve={{ hypotheses: [] }} failed={["evolution"]} offline={false} />,
    );
    expect(html).toContain("a principle");
    expect(html).toContain("1 of 3 feeds could not load");
    expect(html).not.toContain("corpus is healthy");
  });
  it("control: three healthy empty feeds hide the card (a clean week)", () => {
    const html = renderToStaticMarkup(
      <BrainInsightsView violations={{ violations: [] }} evolution={{ totalCandidates: 0 }} improve={{ hypotheses: [] }} failed={[]} offline={false} />,
    );
    expect(html).toBe("");
  });
});

describe("loadInsightFeeds", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  it("lists a non-200 feed and a thrown feed as failed, and keeps the good one", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("violations")) return ok({ violations: [violation] });
      if (url.includes("evolution")) return { ok: false, json: async () => ({}) } as Response;
      throw new Error("network down");
    });
    const res = await loadInsightFeeds(fetchFn as unknown as typeof fetch);
    expect(res.failed.sort()).toEqual(["evolution", "improve"]);
    expect(res.violations?.violations).toHaveLength(1);
  });
  it("control: three good feeds fail nothing", async () => {
    const fetchFn = vi.fn(async () => ok({}));
    expect((await loadInsightFeeds(fetchFn as unknown as typeof fetch)).failed).toEqual([]);
  });
});

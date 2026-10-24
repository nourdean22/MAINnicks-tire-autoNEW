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
    // A paused query is not refreshing: the Refresh button must not claim work that cannot run.
    expect(html).not.toContain("Refreshing…");
  });
  it("a failed 30 s poll over cached rows keeps the deck AND says the refresh failed, with Retry", () => {
    q.cron = {
      ...base,
      isError: true,
      data: { rows: [], summary: { active: 7, disabled: 0, folded: 0, retired: 0, runs24h: 0, failures24h: 0, drifted: 0 }, generatedAt: "2026-10-24T12:00:00Z" },
    };
    const html = renderToStaticMarkup(<CronsPage />);
    expect(html).toContain("7 active");
    expect(html).toContain("Last refresh failed.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("State unknown, not empty");
  });
  it("a failed read with Retry running says Retrying and disables the button", () => {
    q.cron = { ...base, isError: true, isFetching: true, fetchStatus: "fetching" };
    const html = renderToStaticMarkup(<CronsPage />);
    expect(html).toContain("Retrying");
  });
  it("control: a healthy read prints no failure note", () => {
    q.cron = { ...base, data: { rows: [], summary: { active: 7, disabled: 0, folded: 0, retired: 0, runs24h: 0, failures24h: 0, drifted: 0 }, generatedAt: "2026-10-24T12:00:00Z" } };
    const html = renderToStaticMarkup(<CronsPage />);
    expect(html).toContain("7 active");
    expect(html).not.toContain("Last refresh failed.");
    expect(html).not.toContain("State unknown");
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
  it("online with failed feeds: the note offers Retry and wires it", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      <BrainInsightsView violations={null} evolution={null} improve={null} failed={["violations", "evolution", "improve"]} offline={false} onRetry={onRetry} />,
    );
    expect(html).toContain("3 of 3 feeds could not load");
    expect(html).toContain("Retry");
    expect(renderToStaticMarkup(
      <BrainInsightsView violations={null} evolution={null} improve={null} failed={["violations"]} offline={false} onRetry={onRetry} retrying />,
    )).toContain("Retrying");
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

/**
 * tests/ai/deep-research-synth-lanes.test.ts · 2026-10-07
 *
 * Prod logged 8 `[guardian:research-synth] api_timeout after 2 attempt(s)`
 * between 2026-09-18 and 09-29: the synth step was guarded at 15s while aiChat
 * gives "deep" a 100s budget, so a slow deep lane threw away reports whose
 * searches had succeeded, and the async path told the operator "no sources".
 *
 * Pins: a hung deep lane is aborted and the fast lane answers; aiChat's
 * no-throw sentinel is a lane failure, not a report; when every lane fails the
 * report says `synth_failed` (not `no_sources`) and nothing is persisted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { content: string; provider: string; model: string };
const aiChatImpl = vi.fn<(messages: unknown, task: string, opts?: { signal?: AbortSignal }) => Promise<Reply>>();

vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (messages: unknown, task: string, opts?: { signal?: AbortSignal }) =>
    aiChatImpl(messages, task, opts),
}));
vi.mock("@/lib/tools/guardian", () => ({
  withGuardian: (_name: string, fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/integrations/perplexity", () => ({ smartWebSearch: vi.fn() }));
vi.mock("@/lib/ai/multi-search", () => ({
  multiSourceSearch: vi.fn().mockResolvedValue({
    consensus: "Wan 2.2 is the newest open-weight Wan release.",
    sources: [],
    citations: [{ url: "https://example.com/wan" }],
  }),
}));
vi.mock("@/lib/integrations/firecrawl", () => ({ isFirecrawlConfigured: () => false }));
const remember = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember } }));
vi.mock("@/lib/ai/personas/scorer", () => ({ recordPersonaUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { runDeepResearch, synthesizeWithLanes } from "@/lib/ai/deep-research";

const ok = (content: string, provider = "ollama"): Reply => ({ content, provider, model: "m" });
const hangUntilAborted = (opts?: { signal?: AbortSignal }) =>
  new Promise<Reply>((_, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(opts.signal?.reason ?? new Error("aborted")));
  });

// Planner + gap-check run on "classify"; synthesis on "deep" then "fast".
function routeClassify(task: string): Promise<Reply> | null {
  if (task !== "classify") return null;
  return Promise.resolve(ok('{"subQueries": ["latest open Wan model"], "gaps": []}'));
}

beforeEach(() => {
  aiChatImpl.mockReset();
  remember.mockClear();
  delete process.env.PERPLEXITY_API_KEY;
});

describe("synthesizeWithLanes", () => {
  it("aborts a hung deep lane and returns the fast lane's synthesis", async () => {
    aiChatImpl.mockImplementation((_m, task, opts) =>
      task === "deep" ? hangUntilAborted(opts) : Promise.resolve(ok("fast report [1]")),
    );
    const text = await synthesizeWithLanes([{ role: "user", content: "q" }], [
      { lane: "deep", ms: 20 },
      { lane: "fast", ms: 1_000 },
    ]);
    expect(text).toBe("fast report [1]");
    const deepCall = aiChatImpl.mock.calls.find((c) => c[1] === "deep");
    expect(deepCall?.[2]?.signal?.aborted).toBe(true);
  });

  it("treats aiChat's no-throw sentinel as a failed lane, never as a report", async () => {
    aiChatImpl.mockResolvedValue(ok("All providers are unavailable right now.", "emergency"));
    await expect(
      synthesizeWithLanes([{ role: "user", content: "q" }], [
        { lane: "deep", ms: 1_000 },
        { lane: "fast", ms: 1_000 },
      ]),
    ).rejects.toThrow(/no synthesis \(provider=emergency\)/);
  });
});

describe("runDeepResearch synthesisStatus", () => {
  it("is ok and persists when a lane synthesizes", async () => {
    aiChatImpl.mockImplementation((_m, task) => routeClassify(task) ?? Promise.resolve(ok("cited report [1]")));
    const report = await runDeepResearch({ question: "what is the newest open Wan model?" });
    expect(report.synthesisStatus).toBe("ok");
    expect(report.synthesis).toBe("cited report [1]");
    expect(remember).toHaveBeenCalledTimes(1);
  });

  it("is synth_failed (searches had content) when every lane fails, and persists nothing", async () => {
    aiChatImpl.mockImplementation((_m, task) =>
      routeClassify(task) ?? Promise.reject(new Error("upstream 503")),
    );
    const report = await runDeepResearch({ question: "what is the newest open Wan model?" });
    expect(report.synthesis).toBe("");
    expect(report.synthesisStatus).toBe("synth_failed");
    expect(report.rounds.some((r) => r.content)).toBe(true);
    expect(report.allCitations).toContain("https://example.com/wan");
    expect(remember).not.toHaveBeenCalled();
  });
});

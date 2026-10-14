/**
 * Journal ingest timeout in runDeferredBackgroundWork (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: the journal extraction was wrapped with a 20s timeout and silentTimeout, but the
 * provider timeout for non-long-form tasks is 45s. A slow extraction was always cut off first,
 * and the cut-off reached only the console. Fake timers drive a 25s and a 70s extraction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: any }> = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: unknown) => {
            calls.push({ op: `${name}.${method}`, args });
            return Promise.resolve(null);
          };
        },
      },
    );
  const prisma = new Proxy(
    {},
    { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) },
  );
  return { calls, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

vi.mock("@/lib/brain/journal-ingest", () => ({ ingestJournal: vi.fn() }));
vi.mock("@/lib/ai/chat/brain-dump-detector", () => ({ looksLikeBrainDump: () => true }));
vi.mock("@/lib/ai/nick-agent", () => ({ parseActions: () => [], executeActions: vi.fn(async () => []) }));
vi.mock("@/lib/ai/memory", () => ({ recordInteraction: async () => undefined }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processConversation: async () => undefined }));
vi.mock("@/lib/brain/conversation-memory", () => ({ summarizeAndStoreConversation: async () => undefined }));
vi.mock("@/lib/chat/auto-rename", () => ({ maybeAutoRename: async () => undefined }));
vi.mock("@/lib/services/metrics", () => ({
  metricRecordedForTrace: async () => true,
  recordMetricStrict: async () => ({}),
}));
vi.mock("@/lib/ai/receipts/action-done-shadow-recorder", () => ({
  ACTION_DONE_SHADOW_METRIC: "action_done_shadow",
  recordActionDoneShadow: async () => "skipped",
}));
vi.mock("@/lib/ai/chat/recommendation-novelty-shadow", () => ({
  RECOMMENDATION_NOVELTY_METRIC: "recommendation_novelty",
  recordRecommendationNoveltyShadow: async () => undefined,
}));
vi.mock("@/lib/services/chat/prior-recommendations", () => ({ loadPriorRecommendations: async () => [] }));
vi.mock("@/lib/ai/content-feedback", () => ({
  detectContentFeedback: () => null,
  persistContentFeedback: async () => undefined,
}));
vi.mock("@/lib/personal/friction-tracker", () => ({
  detectFriction: () => null,
  persistFriction: async () => undefined,
}));
vi.mock("@/lib/ai/suggestion-cache", () => ({ warmSuggestionCache: () => undefined, heuristicSuggestions: () => [] }));
vi.mock("@/lib/utils/error-log", () => ({ logError: () => undefined }));

import { ingestJournal } from "@/lib/brain/journal-ingest";
import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";

// Substantive and over 200 chars, so the journal branch is taken.
const DUMP = `${"Planned the week: ".repeat(14)}call Bob about the tires.`;

const ctx = () =>
  ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    convId: "c1",
    traceId: "t-journal",
    provider: "openai",
    modelId: "m",
    mode: "standard",
    personality: "x",
    topicTier: "t",
    startedAt: Date.now(),
    userContent: DUMP,
    cleanedText: "On it.",
    text: "On it.",
    messages: [],
    createdAssistantId: "a1",
  }) as unknown as Parameters<typeof runDeferredBackgroundWork>[0];

const slowExtraction = (ms: number, onDone: () => void) =>
  new Promise((resolve) =>
    setTimeout(() => {
      onDone();
      resolve({ ok: true });
    }, ms),
  );

beforeEach(() => {
  db.calls.length = 0;
  vi.mocked(ingestJournal).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("journal ingest timeout", () => {
  it("a 25s extraction is not cut off by the timeout", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finished = false;
    vi.mocked(ingestJournal).mockImplementation(
      (() => slowExtraction(25_000, () => (finished = true))) as unknown as typeof ingestJournal,
    );
    await runDeferredBackgroundWork(ctx());
    await vi.advanceTimersByTimeAsync(25_000);
    expect(finished).toBe(true);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnings).not.toContain("chat:journal-ingest");
  });

  it("an extraction that outlasts the timeout leaves an audit row, not a silent drop", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ingestJournal).mockImplementation(
      (() => slowExtraction(70_000, () => undefined)) as unknown as typeof ingestJournal,
    );
    await runDeferredBackgroundWork(ctx());
    await vi.advanceTimersByTimeAsync(65_000);
    const audit = db.calls
      .filter((c) => c.op === "auditEvent.create")
      .map((c) => String(c.args?.data?.detail));
    // The timeout does not cancel the extraction: the audit row must say so, not read as "stopped".
    expect(audit.join("\n")).toContain("chat:journal-ingest: Task timed out after 60000ms; the work is still running");
    expect(audit.join("\n")).toContain("outcome is unknown");
  });
});

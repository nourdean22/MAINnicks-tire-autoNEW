/**
 * tests/ai/chat/private-mode-zero-persist.test.ts · 2026-10-10 (audit 05-M1, 07-SN-05, 07-SN-06, 04-F10)
 *
 * Private Lab promises "the turn persists NOTHING" (gate.ts contract). The
 * audit found the promise held only for the transcript: every mutating tool
 * stayed callable, the tool census wrote a system_metrics row, the Langfuse
 * gate ignored the turn, and the image lane stored its output.
 *
 * Each case is paired with a CONTROL that runs the same call outside a
 * private turn and shows the instrument does see the thing being refused —
 * otherwise "no write happened" could just mean "this fixture never writes".
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  writes: [] as Array<{ model: string; op: string }>,
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "metric-row" }),
  recordMetric: vi.fn().mockResolvedValue(undefined),
  markSearchToolsFired: vi.fn().mockResolvedValue(undefined),
  markInvokeToolFired: vi.fn().mockResolvedValue(undefined),
  pruneOpts: [] as Array<Record<string, unknown> | undefined>,
  generateImage: vi.fn(),
}));

// Every prisma write is recorded; reads return empty.
vi.mock("@/lib/prisma", () => {
  const WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (WRITE.has(op)) {
            return vi.fn(async () => {
              h.writes.push({ model: name, op });
              return { id: `${name}-row` };
            });
          }
          if (op === "findMany" || op === "groupBy") return vi.fn(async () => []);
          if (op === "count") return vi.fn(async () => 0);
          return vi.fn(async () => null);
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return vi.fn(async () => []);
        if (prop === "$executeRaw" || prop === "$executeRawUnsafe") {
          return vi.fn(async () => {
            h.writes.push({ model: "$raw", op: prop });
            return 0;
          });
        }
        return model(prop);
      },
    },
  );
  return { prisma };
});

vi.mock("@/lib/services/metrics", () => ({
  recordMetric: h.recordMetric,
  recordMetricStrict: h.recordMetricStrict,
}));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({
  markSearchToolsFired: h.markSearchToolsFired,
  markInvokeToolFired: h.markInvokeToolFired,
  recordToolSelection: vi.fn().mockResolvedValue(undefined),
}));

// The pruner offers a realistic mix: reads, memory writes, an outward send.
vi.mock("@/lib/ai/chat-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chat-mode")>();
  return {
    ...actual,
    pruneTools: vi.fn(async (_mode: string, all: Record<string, unknown>, _q: string, _e: number[], opts?: Record<string, unknown>) => {
      h.pruneOpts.push(opts);
      const pick: Record<string, unknown> = {};
      for (const n of ["searchMemories", "getShopSnapshot", "pinMemory", "createTask", "sendTelegram"]) {
        if (all[n]) pick[n] = all[n];
      }
      return pick;
    }),
  };
});

vi.mock("@/lib/ai/gemini-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini-image")>();
  return { ...actual, generateImageWithFallback: h.generateImage };
});

import { prepareTools } from "@/app/api/ai/chat/prepare-tools";
import { isReadSafeTool } from "@/lib/ai/capability-registry";
import { withTurnContext } from "@/lib/agent/turn-context";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { isLangfuseTelemetryEnabled, langfuseTelemetry } from "@/lib/observability/langfuse";
import { handleImage } from "@/lib/ai/chat/handlers/image";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function args(overrides: Partial<Parameters<typeof prepareTools>[0]> = {}): Parameters<typeof prepareTools>[0] {
  return {
    mode: "standard" as never,
    messages: [],
    userContent: "capture this into my brain: the warehouse lease ends in March",
    userEmbedding: [],
    aiConfig: null,
    // /capture's action intent force-adds pinMemory (action-vocab.ts) — the
    // strip must still win because it runs LAST.
    actionIntent: { intent: "capture", expectedTool: "pinMemory" } as never,
    webSearchIntent: false,
    queryShape: { shape: "default", tokenBudget: 0, needsTool: false, factualHints: [] } as never,
    finalSystemPromptLength: 100,
    actionPermission: "draft",
    traceId: "trace-private",
    conversationId: undefined,
    log,
    ...overrides,
  };
}

beforeEach(() => {
  h.writes.length = 0;
  h.pruneOpts.length = 0;
  h.recordMetricStrict.mockClear();
  h.markSearchToolsFired.mockClear();
  h.generateImage.mockReset();
});

describe("prepareTools · a private turn is handed no mutating tool and writes no census row", () => {
  it("CONTROL · a normal draft turn keeps pinMemory/createTask/sendTelegram and records tool.surfaced", async () => {
    const { prunedTools } = await prepareTools(args());
    const names = Object.keys(prunedTools);
    expect(names).toEqual(expect.arrayContaining(["pinMemory", "createTask", "sendTelegram", "searchMemories"]));
    await vi.waitFor(() => expect(h.recordMetricStrict).toHaveBeenCalledWith("tool.surfaced", expect.any(Number), expect.anything()));
    expect(h.pruneOpts[0]?.turnId).toBe("trace-private");
  });

  it("privateMode strips every non-read-safe tool even at draft permission and with a forced write intent", async () => {
    const { prunedTools } = await prepareTools(args({ privateMode: true } as never));
    const names = Object.keys(prunedTools);
    expect(names.length, "read tools survive (the strip is not 'no tools')").toBeGreaterThan(0);
    expect(names).toContain("searchMemories");
    for (const n of ["pinMemory", "createTask", "sendTelegram"]) expect(names).not.toContain(n);
    expect(names.filter((n) => !isReadSafeTool(n))).toEqual([]);
  });

  it("privateMode writes no tool.surfaced metric, no selection-telemetry row, and no recovery-lane marker", async () => {
    const { prunedTools } = await prepareTools(args({ privateMode: true } as never));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.recordMetricStrict).not.toHaveBeenCalled();
    expect(h.pruneOpts[0]?.turnId, "pruneTools records selection rows when handed a turnId").toBeUndefined();
    const search = (prunedTools as Record<string, { execute?: (i: unknown, o?: unknown) => Promise<unknown> }>).searchTools;
    if (search?.execute) await search.execute({ query: "lease" }, {});
    expect(h.markSearchToolsFired).not.toHaveBeenCalled();
  });
});

describe("evaluateToolAction · the policy engine denies writes inside a private turn", () => {
  it("CONTROL · memory.pin outside a private turn is not denied by the private rule", () => {
    const res = evaluateToolAction({ toolId: "memory.pin", actionType: "write" });
    expect(res.reason).not.toMatch(/private/i);
  });

  it("memory.pin inside a private turn is denied", () => {
    const res = withTurnContext({ privateMode: true }, () => evaluateToolAction({ toolId: "memory.pin", actionType: "write" }));
    expect(res.decision).toBe("deny");
    expect(res.reason).toMatch(/private/i);
  });

  it("a read-only tool inside a private turn is still allowed", () => {
    const res = withTurnContext({ privateMode: true }, () => evaluateToolAction({ toolId: "web.search.verified", actionType: "search" }));
    expect(res.decision).toBe("allow");
  });
});

describe("Langfuse · a private turn exports no span, even from helper LLM calls that never pass privateMode", () => {
  const g = globalThis as typeof globalThis & { __langfuseTracing?: unknown };
  const saved = g.__langfuseTracing;
  afterAll(() => {
    g.__langfuseTracing = saved;
  });

  it("CONTROL · with a started processor a normal turn is traced", () => {
    g.__langfuseTracing = { status: "started", processor: null };
    expect(withTurnContext({}, () => isLangfuseTelemetryEnabled())).toBe(true);
  });

  it("inside a private turn the gate is off for callers that do not thread privateMode (summarizer, classifier)", () => {
    g.__langfuseTracing = { status: "started", processor: null };
    expect(withTurnContext({ privateMode: true }, () => isLangfuseTelemetryEnabled())).toBe(false);
    expect(withTurnContext({ privateMode: true }, () => langfuseTelemetry({ functionId: "ai-chat-summary" }).isEnabled)).toBe(false);
  });
});

describe("image lane · a private turn generates and stores no image", () => {
  async function drain(res: Response) {
    await res.text().catch(() => "");
  }

  it("CONTROL · outside a private turn the generator runs (and would store the image)", async () => {
    h.generateImage.mockResolvedValue({ imageId: "img1", imageUrl: "/api/images/img1", model: "m", size: "1024x1024", prompt: "p" });
    await drain(await handleImage("conv_ctl", "/img a red barn", true));
    expect(h.generateImage).toHaveBeenCalledTimes(1);
  });

  it("inside a private turn the generator never runs and no row is written", async () => {
    h.generateImage.mockResolvedValue({ imageId: "img1", imageUrl: "/api/images/img1", model: "m", size: "1024x1024", prompt: "p" });
    const res = await withTurnContext({ privateMode: true }, () => handleImage("conv_private", "/img a red barn", true));
    await drain(res);
    expect(h.generateImage).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
});

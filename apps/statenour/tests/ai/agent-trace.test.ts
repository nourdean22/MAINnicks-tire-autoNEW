/**
 * v10 Track E.5 · Tests for AgentTrace contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentTrace: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  mintTraceId,
  recordTrace,
  wrapTrace,
  listRecentTraceChains,
} from "@/lib/ai/agent-trace";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10 E.5 · mintTraceId", () => {
  it("produces unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(mintTraceId());
    expect(ids.size).toBe(100);
  });

  it("prefixes with t_ and is sortable", () => {
    const a = mintTraceId();
    const b = mintTraceId();
    expect(a.startsWith("t_")).toBe(true);
    expect(b.startsWith("t_")).toBe(true);
    // Time-prefix means b should sort >= a (same ms tie possible).
    expect(b >= a).toBe(true);
  });
});

describe("v10 E.5 · recordTrace", () => {
  it("writes a complete row with all the captured fields", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    await recordTrace(
      {
        traceId: "t_abc",
        source: "chat",
        label: "auto-rename",
        provider: "venice",
        model: "venice/m",
        inputChars: 200,
      },
      {
        durationMs: 450,
        outputChars: 80,
        costCents: 2,
        toolCalls: 1,
      },
    );

    expect(prisma.agentTrace.create).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data).toMatchObject({
      traceId: "t_abc",
      source: "chat",
      label: "auto-rename",
      provider: "venice",
      durationMs: 450,
      outputChars: 80,
      toolCalls: 1,
    });
  });

  it("never throws on Prisma failure (fire-and-forget contract)", async () => {
    vi.mocked(prisma.agentTrace.create).mockRejectedValue(new Error("db down"));

    await expect(
      recordTrace(
        { traceId: "t_x", source: "chat", label: "test" },
        { durationMs: 100 },
      ),
    ).resolves.toBeUndefined();
  });

  it("slices errorMessage to 1000 chars", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);
    const long = "x".repeat(2000);

    await recordTrace(
      { traceId: "t_y", source: "chat", label: "test" },
      { durationMs: 0, errorClass: "boom", errorMessage: long },
    );

    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect((args?.data?.errorMessage as string).length).toBe(1000);
  });

  it("merges metadata from start + finish", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    await recordTrace(
      {
        traceId: "t_z",
        source: "chat",
        label: "test",
        metadata: { firstTokenAt: 100 },
      },
      {
        durationMs: 0,
        metadataDelta: { finalTokenAt: 500 },
      },
    );

    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.metadata).toEqual({
      firstTokenAt: 100,
      finalTokenAt: 500,
    });
  });
});

describe("v10 E.5 · wrapTrace", () => {
  it("returns the wrapped function's value on success", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    const result = await wrapTrace(
      { traceId: "t_w", source: "chat", label: "test" },
      async () => "the-answer",
    );

    expect(result).toBe("the-answer");
  });

  it("re-throws errors but still records the trace", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    await expect(
      wrapTrace(
        { traceId: "t_e", source: "chat", label: "test" },
        async () => {
          throw new Error("kaboom");
        },
      ),
    ).rejects.toThrow("kaboom");

    // The trace was recorded fire-and-forget — give the microtask
    // queue a tick to drain.
    await new Promise((r) => setTimeout(r, 0));
    expect(prisma.agentTrace.create).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.errorClass).toBe("wrap_trace_threw");
    expect((args?.data?.errorMessage as string)).toContain("kaboom");
  });

  it("captures outputChars + costCents + toolCalls via finishFromResult", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    const result = await wrapTrace(
      { traceId: "t_f", source: "chat", label: "test" },
      async () => ({ content: "hello world", costCents: 7, toolCallCount: 2 }),
      {
        finishFromResult: (r) => ({
          outputChars: r.content.length,
          costCents: r.costCents,
          toolCalls: r.toolCallCount,
        }),
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(result.content).toBe("hello world");
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.outputChars).toBe("hello world".length);
    expect(args?.data?.costCents).toBe(7);
    expect(args?.data?.toolCalls).toBe(2);
  });

  it("falls back to timing-only when finishFromResult throws", async () => {
    vi.mocked(prisma.agentTrace.create).mockResolvedValue({} as never);

    const result = await wrapTrace(
      { traceId: "t_g", source: "chat", label: "test" },
      async () => "ok",
      {
        finishFromResult: () => {
          throw new Error("attribution boom");
        },
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe("ok");
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    // Should record (timing-only) without re-throwing
    expect(args?.data?.outputChars).toBeNull();
    // The original call still succeeded — no error class
    expect(args?.data?.errorClass).toBeNull();
  });
});

describe("v10 E.5 · listRecentTraceChains", () => {
  it("groups rows by traceId + identifies the root call", async () => {
    const t1 = "t_one";
    const now = new Date("2026-04-30T10:00:00Z");
    vi.mocked(prisma.agentTrace.findMany)
      // First call: distinct traceIds
      .mockResolvedValueOnce([{ traceId: t1 }] as never)
      // Second call: rows for those traceIds
      .mockResolvedValueOnce([
        {
          id: "1",
          traceId: t1,
          parentId: null,
          source: "chat",
          provider: "venice",
          model: "venice/m",
          label: "chat-turn",
          startedAt: now,
          finishedAt: now,
          durationMs: 800,
          inputChars: 200,
          outputChars: 100,
          costCents: 5,
          toolCalls: 0,
          errorClass: null,
          errorMessage: null,
          metadata: null,
          createdAt: now,
        },
        {
          id: "2",
          traceId: t1,
          parentId: "1",
          source: "chat",
          provider: "venice",
          model: "venice/m",
          label: "auto-rename",
          startedAt: now,
          finishedAt: now,
          durationMs: 200,
          inputChars: 50,
          outputChars: 20,
          costCents: 1,
          toolCalls: 0,
          errorClass: null,
          errorMessage: null,
          metadata: null,
          createdAt: now,
        },
      ] as never);

    const chains = await listRecentTraceChains({ limit: 5 });
    expect(chains.length).toBe(1);
    expect(chains[0].traceId).toBe(t1);
    expect(chains[0].callCount).toBe(2);
    expect(chains[0].rootLabel).toBe("chat-turn");
    expect(chains[0].totalDurationMs).toBe(1000);
    expect(chains[0].totalCostCents).toBe(6);
    expect(chains[0].hasError).toBe(false);
    expect(chains[0].children.length).toBe(2);
  });

  it("returns empty when no traces exist", async () => {
    vi.mocked(prisma.agentTrace.findMany).mockResolvedValueOnce([] as never);

    const chains = await listRecentTraceChains();
    expect(chains.length).toBe(0);
    expect(prisma.agentTrace.findMany).toHaveBeenCalledTimes(1);
  });

  it("hasError flag set when any child has errorClass", async () => {
    const t = "t_err";
    const now = new Date();
    vi.mocked(prisma.agentTrace.findMany)
      .mockResolvedValueOnce([{ traceId: t }] as never)
      .mockResolvedValueOnce([
        {
          id: "1",
          traceId: t,
          parentId: null,
          source: "chat",
          provider: null,
          model: null,
          label: "root",
          startedAt: now,
          finishedAt: now,
          durationMs: 100,
          inputChars: 0,
          outputChars: 0,
          costCents: 0,
          toolCalls: 0,
          errorClass: "ai_call_failed",
          errorMessage: "boom",
          metadata: null,
          createdAt: now,
        },
      ] as never);

    const chains = await listRecentTraceChains();
    expect(chains[0].hasError).toBe(true);
  });
});

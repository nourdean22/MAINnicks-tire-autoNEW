/**
 * W6 PR 2 · POST /api/intent/compose. Owner only, flag gated, read-only. The compose core has its own
 * tests (tests/lib/intent/compose.test.ts); this pins the route around it: the flag, the body, the
 * trace that the kill read counts (label "intent-surface"), and the turn context the tools run in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { flagOn, generateText, fleet, recordTrace, inTurn } = vi.hoisted(() => ({
  flagOn: { value: false },
  generateText: vi.fn(),
  fleet: vi.fn(async () => ({ ok: true, statenour: [], nickstire: [], allFresh: true })),
  recordTrace: vi.fn(),
  inTurn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireQueueAuth: vi.fn(),
  requireDeviceAgentAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: (key: string) => (key === "W6_INTENT_SURFACE" ? { isOn: flagOn.value } : null),
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: (o: unknown) => generateText(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: vi.fn(() => "model-reason") }));
vi.mock("@/lib/ai/tools", () => ({ nourTools: { getFleetTruth: { description: "fleet", execute: fleet } } }));
vi.mock("@/lib/ai/agent-trace", () => ({ mintTraceId: () => "t_test", recordTrace: (...a: unknown[]) => recordTrace(...a) }));
vi.mock("@/lib/agent/turn-context", () => ({
  withTurnContext: (_seed: unknown, fn: () => unknown) => {
    inTurn();
    return fn();
  },
}));

import { POST } from "@/app/api/intent/compose/route";

function post(body: unknown) {
  return POST(new Request("http://localhost/api/intent/compose", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  generateText.mockReset();
  recordTrace.mockReset();
  inTurn.mockReset();
  generateText.mockImplementation(async (o: { tools: Record<string, { execute: (i: unknown) => unknown }> }) => {
    const output = await o.tools.getFleetTruth.execute({});
    return { steps: [{ content: [{ type: "tool-result", toolName: "getFleetTruth", toolCallId: "c0", input: {}, output }] }] };
  });
});

describe("POST /api/intent/compose", () => {
  it("flag off: 404 and no model call", async () => {
    flagOn.value = false;
    const res = await post({ intent: "is everything running" });
    expect(res.status).toBe(404);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("flag on, empty intent: 400 and no model call", async () => {
    flagOn.value = true;
    const res = await post({ intent: "" });
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("flag on, an intent over the cap: 400", async () => {
    flagOn.value = true;
    const res = await post({ intent: "x".repeat(301) });
    expect(res.status).toBe(400);
  });

  it("flag on: composes inside a turn context, returns parts, and records one intent-surface trace", async () => {
    flagOn.value = true;
    const res = await post({ intent: "is everything running" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.parts).toEqual([
      { type: "tool-getFleetTruth", state: "output-available", output: { ok: true, statenour: [], nickstire: [], allFresh: true } },
    ]);
    expect(inTurn).toHaveBeenCalledTimes(1);
    expect(fleet).toHaveBeenCalledTimes(1);
    expect(recordTrace).toHaveBeenCalledTimes(1);
    const [start, finish] = recordTrace.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(start.label).toBe("intent-surface");
    expect(finish.toolCalls).toBe(1);
    expect(generateText.mock.calls[0][0]).toMatchObject({ model: "model-reason", toolChoice: "required" });
  });

  it("a model failure is a 502 that says so, and still records a trace", async () => {
    flagOn.value = true;
    generateText.mockRejectedValueOnce(new Error("provider timed out"));
    const res = await post({ intent: "my day" });
    expect(res.status).toBe(502);
    expect(recordTrace).toHaveBeenCalledTimes(1);
    expect((recordTrace.mock.calls[0][1] as Record<string, unknown>).errorClass).toBe("intent_compose_failed");
  });
});

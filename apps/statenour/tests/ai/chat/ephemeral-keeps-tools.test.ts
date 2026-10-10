/**
 * tests/ai/chat/ephemeral-keeps-tools.test.ts · 2026-10-10 (audit 07-SN-05 root cause)
 *
 * One flag used to mean two things. Home's command line sent
 * `privateMode:true` only so its transcript would not be kept, and its
 * `/task` and `/capture` commands DEPEND on write tools (createTask,
 * pinMemory). Private Lab sent the same flag meaning "leave no trace".
 * The split: `ephemeral` = transcript not kept, tools allowed;
 * `privateMode` = no trace at all.
 *
 * This file pins the ephemeral half, so tightening Private Lab can never
 * silently break /task and /capture again.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ transportArgs: [] as unknown[] }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  class RecordingTransport {
    constructor(opts: unknown) {
      h.transportArgs.push(opts);
    }
  }
  return { ...actual, DefaultChatTransport: RecordingTransport };
});
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], sendMessage: vi.fn(), status: "ready" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { operator: { nickRemembersContext: { useQuery: () => ({ data: undefined }) } } },
}));
vi.mock("@/lib/services/metrics", () => ({
  recordMetric: vi.fn().mockResolvedValue(undefined),
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "m" }),
}));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({
  markSearchToolsFired: vi.fn(),
  markInvokeToolFired: vi.fn(),
  recordToolSelection: vi.fn(),
}));
vi.mock("@/lib/ai/chat-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chat-mode")>();
  return {
    ...actual,
    pruneTools: vi.fn(async (_m: string, all: Record<string, unknown>) => {
      const pick: Record<string, unknown> = {};
      for (const n of ["searchMemories", "createTask", "pinMemory"]) if (all[n]) pick[n] = all[n];
      return pick;
    }),
  };
});

vi.mock("@/lib/services/power-panel", () => ({ checkAiBudget: vi.fn(async () => ({ allowed: true })) }));

import { runGate, type GatePass } from "@/lib/ai/chat/gate";
import { NickCommandLine } from "@/components/home/nick-command-line";
import { prepareTools } from "@/app/api/ai/chat/prepare-tools";

let ip = 0;
async function gate(body: Record<string, unknown>): Promise<GatePass> {
  const res = await runGate(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      // a fresh client IP per call keeps the in-memory rate limiter out of the way
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": `203.0.113.${++ip}` },
      body: JSON.stringify({ messages: [{ role: "user", content: "Create a task: call the vendor" }], ...body }),
    }),
  );
  if (res.kind !== "pass") throw new Error("gate blocked the request");
  return res;
}

describe("gate · ephemeral and privateMode are separate controls", () => {
  it("ephemeral:true parses as ephemeral, NOT private", async () => {
    const c = await gate({ ephemeral: true });
    expect(c.ephemeral).toBe(true);
    expect(c.privateMode).toBe(false);
  });

  it("privateMode:true keeps its full meaning and is not reported as merely ephemeral", async () => {
    const c = await gate({ privateMode: true });
    expect(c.privateMode).toBe(true);
    expect(c.ephemeral).toBe(false);
  });

  it("only a literal true counts (a truthy string is not consent)", async () => {
    expect((await gate({ ephemeral: "true" })).ephemeral).toBe(false);
    expect((await gate({})).ephemeral).toBe(false);
  });
});

describe("home command line · /task and /capture ride an EPHEMERAL transport", () => {
  it("the transport body the line sends parses as ephemeral and not private", async () => {
    h.transportArgs.length = 0;
    renderToString(createElement(NickCommandLine));
    expect(h.transportArgs.length).toBeGreaterThan(0);
    const body = (h.transportArgs[0] as { body?: Record<string, unknown> }).body ?? {};
    expect(body.privateMode, "privateMode would strip createTask / pinMemory").toBeUndefined();
    const c = await gate(body);
    expect(c.ephemeral).toBe(true);
    expect(c.privateMode).toBe(false);
  });
});

describe("an ephemeral (non-private) turn keeps its write tools", () => {
  it("/capture keeps pinMemory and /task keeps createTask when privateMode is false", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    const { prunedTools } = await prepareTools({
      mode: "standard" as never,
      messages: [],
      userContent: "Capture this into my brain: lease ends in March",
      userEmbedding: [],
      aiConfig: null,
      actionIntent: { intent: "capture", expectedTool: "pinMemory" } as never,
      webSearchIntent: false,
      queryShape: { shape: "default", tokenBudget: 0, needsTool: false, factualHints: [] } as never,
      finalSystemPromptLength: 10,
      actionPermission: "draft",
      privateMode: false,
      log,
    } as never);
    expect(Object.keys(prunedTools)).toEqual(expect.arrayContaining(["pinMemory", "createTask"]));
  });
});

/**
 * Upgrade 9 wiring: dailyPulse carries at most one open-loop ask, and a failed read says
 * UNKNOWN (never "nothing open"). The answer goes through answerOpenLoop onto the ask's row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nextOpenLoopAsk: vi.fn(),
  answerOpenLoop: vi.fn(),
  currentTurn: vi.fn(),
}));
vi.mock("@/lib/agent/turn-context", () => ({ currentTurn: h.currentTurn }));
vi.mock("@/lib/brain/open-loops", () => ({ nextOpenLoopAsk: h.nextOpenLoopAsk, answerOpenLoop: h.answerOpenLoop }));
vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: vi.fn(),
  queryNickBatch: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findUnique: vi.fn().mockResolvedValue(null) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { tasksTools } from "@/lib/ai/tools/tasks";

type Exec = { execute: (args: unknown, opts?: unknown) => Promise<Record<string, unknown>> };
const run = (name: keyof typeof tasksTools, args: unknown = {}) => (tasksTools[name] as unknown as Exec).execute(args, {});

beforeEach(() => vi.clearAllMocks());

describe("dailyPulse · openLoop", () => {
  it("carries one ask with its ledger id when a loop is due", async () => {
    h.nextOpenLoopAsk.mockResolvedValue({
      state: "ask", id: "row-1", quote: "I'll call him Tuesday", saidOn: "2026-11-02", dueOn: "2026-11-03",
    });
    const out = await run("dailyPulse");
    expect(out.openLoop).toMatchObject({ id: "row-1", quote: "I'll call him Tuesday", saidOn: "2026-11-02", dueOn: "2026-11-03" });
  });

  it("is null when nothing is due (a measured none)", async () => {
    h.nextOpenLoopAsk.mockResolvedValue({ state: "none" });
    const out = await run("dailyPulse");
    expect(out.openLoop).toBeNull();
  });

  it("is UNKNOWN when the read fails, never null", async () => {
    h.nextOpenLoopAsk.mockRejectedValue(new Error("db down"));
    const out = await run("dailyPulse");
    expect(out.openLoop).not.toBeNull();
    expect(String(out.openLoop)).toMatch(/unknown/i);
  });

  it("a Private Lab turn records no ask (it writes nothing)", async () => {
    h.currentTurn.mockReturnValue({ privateMode: true });
    try {
      const out = await run("dailyPulse");
      expect(h.nextOpenLoopAsk).not.toHaveBeenCalled();
      expect(String(out.openLoop)).toMatch(/private/);
    } finally {
      h.currentTurn.mockReturnValue(undefined);
    }
  });

  it("the tool tells Nick to ask once and how to record the answer", () => {
    const desc = (tasksTools.dailyPulse as unknown as { description: string }).description;
    expect(desc).toMatch(/openLoop/);
    expect(desc).toMatch(/answerOpenLoop/);
  });
});

describe("answerOpenLoop tool", () => {
  it("records the answer on the ask's row", async () => {
    h.answerOpenLoop.mockResolvedValue(true);
    const out = await run("answerOpenLoop", { id: "row-1", answer: "done" });
    expect(h.answerOpenLoop).toHaveBeenCalledWith("row-1", "done");
    expect(out).toMatchObject({ recorded: true });
  });

  it("says so when the id is not an open-loop ask", async () => {
    h.answerOpenLoop.mockResolvedValue(false);
    const out = await run("answerOpenLoop", { id: "nope", answer: "not_yet" });
    expect(out).toMatchObject({ recorded: false });
  });
});

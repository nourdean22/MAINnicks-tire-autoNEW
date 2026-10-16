/**
 * runInterceptors hands the user's message, WITH its id, to ensureConvAndPersistUser at both of its
 * call sites (the F5 command shortcut and the shared fast-path front matter). The row it saves is the
 * only thing the turn guard can find a finished fast-path turn by, so dropping the id there re-opens
 * "a re-send fires the write again" with every other test green (second re-review of #3060: both call
 * sites and the route hand-off could drop it with 918 tests passing).
 *
 * Real runInterceptors and real ensureConvAndPersistUser over a tiny in-memory chat_messages store; the
 * handlers behind them are stubs, because what is pinned is the row, not the lane.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: { create: async () => ({ id: "conv-new" }), update: async () => ({}) },
    chatMessage: {
      create: async (a: { data: Record<string, unknown> }) => {
        h.rows.push(a.data);
        return { id: `row-${h.rows.length}` };
      },
      findFirst: async () => null,
      findMany: async () => [],
    },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/ai/chat/handlers/image", () => ({ handleImage: vi.fn(async () => new Response("image")) }));
vi.mock("@/lib/ai/chat/handlers/decision", () => ({ handleDecision: vi.fn(async () => new Response("decision")) }));
vi.mock("@/lib/ai/chat/handlers/brain-dump", () => ({ handleBrainDump: vi.fn(), handleSlashSave: vi.fn() }));
vi.mock("@/lib/ai/chat/command-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/command-registry")>()),
  runCommand: vi.fn(async () => ({ command: "today", result: { text: "Nothing due." } })),
}));

import { runInterceptors } from "@/lib/ai/chat/interceptors";

const userRows = () => h.rows.filter((r) => r.role === "user");

beforeEach(() => {
  h.rows = [];
});

describe("runInterceptors saves the user row under the id the client minted", () => {
  it("F5 command shortcut (/today)", async () => {
    const res = await runInterceptors({ userContent: "/today", lastUserMsg: { id: "m-cmd-1", role: "user" }, convId: "conv-1" });

    expect(res.kind).toBe("handled");
    expect(userRows()).toHaveLength(1);
    expect(userRows()[0]).toMatchObject({ conversationId: "conv-1", clientMessageId: "m-cmd-1" });
  });

  it("a logged decision (the shared front matter)", async () => {
    const res = await runInterceptors({
      userContent: "log this decision: move the swap queue",
      lastUserMsg: { id: "m-dec-1", role: "user" },
      convId: "conv-1",
    });

    expect(res.kind).toBe("handled");
    expect(userRows()).toHaveLength(1);
    expect(userRows()[0]).toMatchObject({ conversationId: "conv-1", clientMessageId: "m-dec-1" });
  });

  it("CONTROL - a message that passes through to the model saves nothing here (the model pipeline persists it)", async () => {
    const res = await runInterceptors({ userContent: "how are my brake pads", lastUserMsg: { id: "m-1", role: "user" }, convId: "conv-1" });

    expect(res.kind).toBe("pass");
    expect(userRows()).toHaveLength(0);
  });
});

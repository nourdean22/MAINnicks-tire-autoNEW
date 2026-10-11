/**
 * Audit 04-X7: the image interceptors ran BEFORE any budget check, so a paid
 * image generation fired on a day the AI budget was already spent. The chat
 * route's own budget gate sits after the interceptors.
 *
 * Pinned: an over-budget day answers "budget reached" and never calls
 * handleImage; an in-budget day generates; free interceptors stay ungated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { chatMessage: { findMany: async () => [], findFirst: async () => null } },
}));
const buildFastStream = vi.fn(async (_conv: string, text: string) => new Response(text));
vi.mock("@/lib/ai/chat/handlers/shared", () => ({
  buildFastStream: (...a: [string, string]) => buildFastStream(...a),
  ensureConvAndPersistUser: async (c: string | undefined) => c ?? "conv-new",
}));
const handleImage = vi.fn(async () => new Response("image"));
vi.mock("@/lib/ai/chat/handlers/image", () => ({ handleImage: () => handleImage() }));
vi.mock("@/lib/ai/chat/handlers/decision", () => ({ handleDecision: vi.fn() }));
vi.mock("@/lib/ai/chat/handlers/brain-dump", () => ({ handleBrainDump: vi.fn(), handleSlashSave: vi.fn() }));
vi.mock("@/lib/ai/chat/command-registry", () => ({ resolveCommand: () => ({ command: null }), runCommand: vi.fn() }));
const assertWithinBudget = vi.fn();
vi.mock("@/lib/ai/budget", () => ({ assertWithinBudget: () => assertWithinBudget() }));

import { runInterceptors } from "@/lib/ai/chat/interceptors";

const run = (userContent: string) =>
  runInterceptors({ userContent, lastUserMsg: { role: "user", content: userContent }, convId: undefined });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image interceptors respect the daily AI budget", () => {
  it("over budget: no image generation, and the reply says why", async () => {
    assertWithinBudget.mockResolvedValue({ ok: false, status: { overBudget: true } });
    const res = await run("/img a red truck");
    expect(res.kind).toBe("handled");
    expect(handleImage).not.toHaveBeenCalled();
    const text = await (res as { response: Response }).response.text();
    expect(text).toMatch(/budget/i);
  });

  it("control: within budget, the image is generated once", async () => {
    assertWithinBudget.mockResolvedValue({ ok: true, status: { overBudget: false } });
    const res = await run("/img a red truck");
    expect(res.kind).toBe("handled");
    expect(handleImage).toHaveBeenCalledTimes(1);
  });

  it("a budget read that fails does not block the image (fail open, as the chat route does)", async () => {
    assertWithinBudget.mockRejectedValue(new Error("db down"));
    await run("/img a red truck");
    expect(handleImage).toHaveBeenCalledTimes(1);
  });

  it("free interceptors stay ungated: /strict never reads the budget", async () => {
    const res = await run("/strict");
    expect(res.kind).toBe("handled");
    expect(assertWithinBudget).not.toHaveBeenCalled();
  });
});

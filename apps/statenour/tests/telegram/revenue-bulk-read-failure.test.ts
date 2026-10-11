/**
 * R3-16 item 5 (review R3 wave A, finding 5) - /approve_all and /reject_all
 * replied "no pending moves" when the read of today's moves FAILED:
 * listPendingMovesForDate turned a read error into [], and the callback
 * answered that empty list with a confident zero. The operator moved on and
 * the day's moves were never decided. A failed read is unknown, never empty.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  return {
    brainMemory: {
      findMany: vi.fn(),
      findUnique: vi.fn(async () => null),
      update: vi.fn(),
    },
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: h.brainMemory } }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram, formatTelegramNotification: vi.fn() }));
vi.mock("@/lib/services/bridge", () => ({ fetchShopSnapshot: vi.fn() }));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: vi.fn() }));

import { etDateKey } from "@/lib/services/revenue-decision-channel";
import { POST } from "@/app/api/telegram/revenue-decision-callback/route";

const DATE = etDateKey();
const pendingRow = {
  id: "m1", key: `move_${DATE}_1`, category: "revenue_move", content: "move 1",
  metadata: { status: "pending", moveIndex: 1, date: DATE, what: "move 1" },
  createdAt: new Date(), updatedAt: new Date(),
};
const say = (text: string) =>
  POST(new NextRequest("http://localhost/api/telegram/revenue-decision-callback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  }));
const replies = () => h.sendTelegram.mock.calls.map((c) => String(c[0]));

afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  h.brainMemory.findMany.mockReset();
});

describe("bulk decide - a failed read of today's moves is unknown, never zero", () => {
  for (const cmd of ["/approve_all", "/reject_all"]) {
    it(`${cmd}: the read fails -> says it could not read, never "no pending moves"`, async () => {
      h.brainMemory.findMany.mockRejectedValue(new Error("connection reset"));
      const res = await say(cmd);
      expect(res.status).toBe(200);
      expect(replies().join("\n")).not.toMatch(/no pending moves/);
      expect(replies().join("\n")).toMatch(/could not read today's moves, try again/);
      expect(h.brainMemory.update).not.toHaveBeenCalled();
    });
  }

  it("/approve_all: the second read inside the bulk decide fails -> same honest reply, no 'approved 0'", async () => {
    h.brainMemory.findMany.mockResolvedValueOnce([pendingRow]).mockRejectedValue(new Error("connection reset"));
    await say("/approve_all");
    expect(replies().join("\n")).not.toMatch(/approved 0/);
    expect(replies().join("\n")).toMatch(/could not read today's moves, try again/);
  });

  it("CONTROL - a read that succeeds with no pending moves still says so", async () => {
    h.brainMemory.findMany.mockResolvedValue([]);
    await say("/approve_all");
    expect(replies().join("\n")).toMatch(/no pending moves to approve/);
  });
});

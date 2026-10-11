/**
 * P-S10a (audit round 3) - /approve_all and /reject_all counted only `updated`
 * and `alreadyDecided`. A move whose write failed fell into neither bucket, so
 * the reply said "approved 1 move" for a day with two pending moves and the
 * failed one vanished from the operator's view. decideAllForDate now returns
 * the failed move numbers and the reply names them.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  const moves = new Map<string, { id: string; key: string; category: string; content: string; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date }>();
  const failKeys = new Set<string>();
  const brainMemory = {
    findMany: vi.fn(async () => [...moves.values()].map((m) => ({ ...m, metadata: { ...m.metadata } }))),
    findUnique: vi.fn(async ({ where }: { where: { category_key: { key: string } } }) => {
      const m = moves.get(where.category_key.key);
      return m ? { id: m.id, metadata: { ...m.metadata } } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { category_key: { key: string } }; data: { metadata: Record<string, unknown> } }) => {
      if (failKeys.has(where.category_key.key)) throw new Error("connection reset");
      const m = moves.get(where.category_key.key)!;
      m.metadata = data.metadata;
      return m;
    }),
  };
  return { moves, failKeys, brainMemory, sendTelegram: vi.fn(async (..._a: unknown[]) => true) };
});

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: h.brainMemory } }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram, formatTelegramNotification: vi.fn() }));
vi.mock("@/lib/services/bridge", () => ({ fetchShopSnapshot: vi.fn() }));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: vi.fn() }));

import { decideAllForDate, etDateKey } from "@/lib/services/revenue-decision-channel";
import { POST } from "@/app/api/telegram/revenue-decision-callback/route";

const DATE = etDateKey();
function seed(n: number) {
  const key = `move_${DATE}_${n}`;
  h.moves.set(key, {
    id: `m${n}`,
    key,
    category: "revenue_move",
    content: `move ${n}`,
    metadata: { status: "pending", moveIndex: n, date: DATE, what: `move ${n}` },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
const say = (text: string) =>
  POST(
    new NextRequest("http://localhost/api/telegram/revenue-decision-callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
    }),
  );

afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  h.moves.clear();
  h.failKeys.clear();
  seed(1);
  seed(2);
});

describe("bulk decide - a failed write is counted and named", () => {
  it("decideAllForDate reports the failed move", async () => {
    h.failKeys.add(`move_${DATE}_2`);
    const r = await decideAllForDate(DATE, "approved");
    expect(r).toEqual({ updated: 1, alreadyDecided: 0, failed: [2] });
  });

  it("/approve_all says 'approved 1, 1 failed' and names the move", async () => {
    h.failKeys.add(`move_${DATE}_2`);
    await say("/approve_all");
    const text = String(h.sendTelegram.mock.calls.at(-1)?.[0]);
    expect(text).toContain("approved 1");
    expect(text).toContain("1 failed");
    expect(text).toContain("2");
  });

  it("/reject_all reports the failure the same way", async () => {
    h.failKeys.add(`move_${DATE}_1`);
    await say("/reject_all");
    const text = String(h.sendTelegram.mock.calls.at(-1)?.[0]);
    expect(text).toContain("rejected 1");
    expect(text).toContain("1 failed");
  });

  it("CONTROL - with no failure the reply has no failure clause", async () => {
    const r = await decideAllForDate(DATE, "approved");
    expect(r).toEqual({ updated: 2, alreadyDecided: 0, failed: [] });
    h.moves.clear();
    seed(1);
    seed(2);
    await say("/approve_all");
    const text = String(h.sendTelegram.mock.calls.at(-1)?.[0]);
    expect(text).toContain("approved 2 moves");
    expect(text).not.toContain("failed");
  });
});

/**
 * The revenue-decision callback acts only for the owner (07-SN-12).
 *
 * THE DEFECT: the route checked the webhook secret and, ONLY when
 * TELEGRAM_CHAT_ID was set, the chat id. It never checked `message.from.id`,
 * so with TELEGRAM_CHAT_ID unset any Telegram user who could message the bot
 * (when this route is the registered webhook) could /approve_all the day's
 * revenue moves. The main webhook already requires
 * `from.id === TELEGRAM_OWNER_ID`; this mirrors it, failing closed when the
 * owner id is unset.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  return {
    decideMove: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, alreadyDecided: false, status: "approved" as const })),
    decideAllForDate: vi.fn(async (..._a: unknown[]) => ({ updated: 1, alreadyDecided: 0 })),
    listPendingMovesForDate: vi.fn(async (..._a: unknown[]) => [{ n: 1 }]),
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
  };
});

vi.mock("@/lib/services/revenue-decision-channel", () => ({
  decideMove: h.decideMove,
  decideAllForDate: h.decideAllForDate,
  listPendingMovesForDate: h.listPendingMovesForDate,
  etDateKey: () => "2026-10-10",
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));

import { POST } from "@/app/api/telegram/revenue-decision-callback/route";

afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
});

function msg(text: string, from?: { id: number }): NextRequest {
  return new NextRequest("http://localhost/api/telegram/revenue-decision-callback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 777 }, ...(from ? { from } : {}) } }),
  });
}

describe("revenue-decision callback owner check", () => {
  it("a foreign sender's /approve_1 decides nothing and sends nothing", async () => {
    const res = await POST(msg("/approve_1", { id: 999 }));
    expect(res.status).toBe(200);
    expect(h.decideMove).not.toHaveBeenCalled();
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("a foreign sender's /approve_all decides nothing", async () => {
    await POST(msg("/approve_all", { id: 999 }));
    expect(h.decideAllForDate).not.toHaveBeenCalled();
  });

  it("a message with no sender decides nothing", async () => {
    await POST(msg("/reject_1"));
    expect(h.decideMove).not.toHaveBeenCalled();
  });

  it("with TELEGRAM_OWNER_ID unset, nobody is the owner (fails closed)", async () => {
    vi.stubEnv("TELEGRAM_OWNER_ID", "");
    await POST(msg("/approve_1", { id: 4242 }));
    expect(h.decideMove).not.toHaveBeenCalled();
  });

  it("positive control: the owner's /approve_1 decides move 1", async () => {
    await POST(msg("/approve_1", { id: 4242 }));
    expect(h.decideMove).toHaveBeenCalledWith("2026-10-10", 1, "approved");
  });
});

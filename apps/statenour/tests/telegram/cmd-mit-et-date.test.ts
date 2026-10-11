/**
 * 03-F1 (Telegram half, audit round 3) - /mit and /commit keyed the day with
 * the UTC date. At 9:30 pm ET the UTC date is already tomorrow, so an evening
 * /mit was written under tomorrow's key and today's MIT read back empty. Every
 * reader keys the MIT on the ET business day (lib/services/mit.ts and the
 * /command HQ), and every other Commitment writer stamps dateMade with today().
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in this test");
    }),
  );
  const upsert = vi.fn(async (..._a: unknown[]) => ({}));
  const commitmentCreate = vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "c1", ...a.data }));
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const handlers: Record<string, Record<string, unknown>> = {
    brainMemory: { upsert },
    commitment: { create: commitmentCreate },
  };
  const prisma = new Proxy(
    {},
    { get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) },
  );
  return { prisma, upsert, commitmentCreate, sendTelegram: vi.fn(async (..._a: unknown[]) => true) };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: vi.fn(async () => true),
}));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));

import { POST } from "@/app/api/telegram/webhook/route";

const say = (text: string) =>
  POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 9:30 pm ET on Oct 10 = 01:30 UTC on Oct 11.
  vi.setSystemTime(new Date("2026-10-11T01:30:00Z"));
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Telegram day keys are the ET business day", () => {
  it("/mit at 9:30 pm ET writes today's ET key", async () => {
    await say("/mit ship the audit fixes");
    const where = (h.upsert.mock.calls[0]?.[0] as { where: { category_key: { key: string } } }).where;
    expect(where.category_key.key).toBe("2026-10-10");
  });

  it("/commit at 9:30 pm ET stamps today's ET date", async () => {
    await say("/commit call the supplier back");
    const data = (h.commitmentCreate.mock.calls[0]?.[0] as { data: { dateMade: string } }).data;
    expect(data.dateMade).toBe("2026-10-10");
  });

  it("CONTROL - at noon ET the key is the same day either way", async () => {
    vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
    await say("/mit noon check");
    const where = (h.upsert.mock.calls[0]?.[0] as { where: { category_key: { key: string } } }).where;
    expect(where.category_key.key).toBe("2026-10-10");
  });
});

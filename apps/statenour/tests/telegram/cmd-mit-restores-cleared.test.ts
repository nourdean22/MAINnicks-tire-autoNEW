/**
 * R3-16 item 6 (review R3 wave A, finding 9) - Telegram /mit could not bring
 * back a cleared MIT. Clearing today's MIT on HQ soft-deletes the row; /mit's
 * own raw upsert never cleared deletedAt, so the bot said "MIT locked" while
 * every reader (getMit: deletedAt null) still showed no MIT. The service setMit
 * (lib/services/mit.ts) clears it; /mit now goes through it like operator.setMit.
 *
 * The store keeps rows by (category, key) and the reader is the real getMit.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in this test"); }));
  const rows = new Map<string, Record<string, unknown>>();
  const id = (category: string, key: string) => `${category}|${key}`;
  const brainMemory = {
    upsert: vi.fn(async (a: { where: { category_key: { category: string; key: string } }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
      const k = id(a.where.category_key.category, a.where.category_key.key);
      const row = rows.get(k);
      if (row) { Object.assign(row, a.update, { updatedAt: new Date() }); return { ...row }; }
      const created = { deletedAt: null, updatedAt: new Date(), ...a.create };
      rows.set(k, created);
      return { ...created };
    }),
    findFirst: vi.fn(async (a: { where: { category: string; key: string; deletedAt?: null } }) => {
      const row = rows.get(id(a.where.category, a.where.key));
      if (!row) return null;
      if ("deletedAt" in a.where && row.deletedAt !== null) return null;
      return { ...row };
    }),
  };
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const handlers: Record<string, Record<string, unknown>> = { brainMemory };
  const prisma = new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) });
  return { rows, prisma, sendTelegram: vi.fn(async (..._a: unknown[]) => true) };
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
import { getMit } from "@/lib/services/mit";
import { today } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const say = (text: string) =>
  POST(new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  }));

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.clearAllMocks(); h.rows.clear(); });

describe("Telegram /mit after HQ cleared today's MIT", () => {
  it("the new MIT is readable, not hidden behind the old tombstone", async () => {
    h.rows.set(`${BRAIN_CATEGORIES.MIT}|${today()}`, { category: BRAIN_CATEGORIES.MIT, key: today(), content: "old focus", deletedAt: new Date(), updatedAt: new Date() });
    await say("/mit ship the audit fixes");
    const replies = h.sendTelegram.mock.calls.map((c) => String(c[0])).join("\n");
    expect(replies).toContain("MIT locked");
    expect((await getMit()).text).toBe("ship the audit fixes");
  });

  it("CONTROL - with no row yet, /mit creates a readable MIT", async () => {
    await say("/mit call the supplier");
    expect((await getMit()).text).toBe("call the supplier");
  });
});

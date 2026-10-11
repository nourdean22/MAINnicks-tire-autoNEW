/**
 * P-S4a (audit round 3) - a malformed staged-SMS or recall payload was settled
 * FAILED with `context: "Malformed payload: " + JSON.stringify(payload)`, so the
 * customer's full phone number (and anything else in the payload) was written
 * into the ActionReceipt row that /system/actions renders. The log line was
 * already masked (S4); the stored context now records keys and size only.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = { id: string; action: string; status: string; context: string | null; verificationPayload: unknown };

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
  const rows = new Map<string, Row>();
  let seq = 0;
  const actionReceipt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `trk_${++seq}`, context: null, verificationPayload: null, ...data } as Row;
      rows.set(row.id, row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      return r ? { ...r } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id)!;
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.get(where.id as string);
      if (!r || !Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    }),
  };
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const prisma = new Proxy(
    {},
    { get: (_t, model: string) => (model === "actionReceipt" ? actionReceipt : new Proxy({}, { get: (_m, method: string) => inert(method) })) },
  );
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { rows, prisma, log };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => h.log, info: h.log.info, warn: h.log.warn, error: h.log.error, debug: h.log.debug },
}));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: vi.fn(async () => true),
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: vi.fn(async () => true),
}));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));
vi.mock("@/lib/ai/agent-actions/shop-actions", () => ({
  callNickstire: vi.fn(async () => ({ result: {} })),
  isBridgeError: () => false,
}));

import { POST } from "@/app/api/telegram/webhook/route";

const PHONE = "2165550100";
const tap = (data: string) =>
  POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify({ callback_query: { id: "cq_1", data, from: { id: 4242 }, message: { message_id: 7, chat: { id: 4242 } } } }),
    }),
  );

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
});

describe("a malformed payload is settled without its contents", () => {
  it.each([
    ["approve", "shop.sendSms", "approve:rcpt_bad"],
    ["intell_recall", "intell_recall", "intell_recall:approve:rcpt_bad"],
  ])("%s: the FAILED receipt's context names keys and size, not the phone", async (_k, action, data) => {
    // Missing `message` / `smsBody`, so the schema rejects it.
    h.rows.set("rcpt_bad", { id: "rcpt_bad", action, status: "PENDING", context: null, verificationPayload: { phone: PHONE, customerName: "Pat Customer" } });
    await tap(data);
    const row = h.rows.get("rcpt_bad")!;
    expect(row.status).toBe("FAILED");
    expect(row.context).toContain("Malformed payload");
    expect(row.context).toContain("phone");
    expect(row.context).not.toContain(PHONE);
    expect(row.context).not.toContain("Pat Customer");
  });
});

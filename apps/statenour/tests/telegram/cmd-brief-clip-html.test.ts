/**
 * Telegram /brief sends the cached morning brief as parse_mode HTML. It was cut with a raw
 * `.slice(0, 3900)`; when the cut landed inside `&amp;` or an open `<b>`, Telegram answered
 * 400 "can't parse entities" and nothing was delivered. The reply must be within the limit
 * and parseable: no partial entity at the end, every opened tag closed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in this test"); }));
  const brief = { content: "" };
  const brainMemory = {
    findFirst: vi.fn(async (a: { where: { category?: string } }) => (a.where.category === "morning_brief" ? { content: brief.content } : null)),
  };
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const handlers: Record<string, Record<string, unknown>> = { brainMemory };
  const prisma = new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) });
  return { brief, prisma, sendTelegram: vi.fn(async (..._a: unknown[]) => true) };
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
  POST(new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  }));

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.clearAllMocks(); });

describe("Telegram /brief · a long brief still arrives", () => {
  it("the 3900th character landing inside &amp; inside <b> does not break the markup", async () => {
    // 3,894 chars, then "<b>&amp;...": the raw 3900 cut ends "<b>&am" (open tag + partial entity).
    const head = "x".repeat(3893) + "\n";
    h.brief.content = `${head}<b>&amp; brakes and the rest of a long line</b>\nmore`;
    expect(h.brief.content.slice(0, 3900)).toMatch(/<b>&am?p?$/);
    await say("/brief");
    const sent = String(h.sendTelegram.mock.calls.at(-1)?.[0] ?? "");
    expect(sent.length).toBeGreaterThan(3000);
    expect(sent.length).toBeLessThanOrEqual(3900);
    expect(sent).not.toMatch(/&[#a-z0-9]*$/i);
    expect((sent.match(/<b>/g) ?? []).length).toBe((sent.match(/<\/b>/g) ?? []).length);
  });
});

/**
 * Telegram job, lane 2 (2026-10-17) - every interaction sent 1-2 extra
 * acknowledgement messages ("routed as task", "Transcribing...", "Analyzing...")
 * before its result. Now a voice note or a link gets ONE message: the
 * placeholder is sent once and edited in place with the result. A failed edit
 * sends nothing more. Plain text no longer gets a "routed as" message: the
 * command's own reply already says what happened.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("HUGGINGFACE_API_KEY", "test-hf-key");
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/getFile")) return new Response(JSON.stringify({ result: { file_path: "voice/1.oga" } }));
    if (url.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3]));
    if (url.includes("whisper")) return new Response(JSON.stringify({ text: "pick up the tire order" }));
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const inert = (method: string) => async () => (method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null);
  const prisma = new Proxy({}, { get: () => new Proxy({}, { get: (_m, method: string) => inert(method) }) });
  return {
    prisma,
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
    sendTelegramForId: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; messageId?: number }> => ({ ok: true, messageId: 77 })),
    editTelegramMessage: vi.fn(async (..._a: unknown[]) => true),
    createTask: vi.fn(async (a: { title: string }) => ({ id: "task_12345678", title: a.title })),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  sendTelegramForId: h.sendTelegramForId,
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: h.editTelegramMessage,
}));
vi.mock("@/lib/brain/journal-ingest", () => ({ ingestJournal: vi.fn(async () => ({ entryType: "task", tasksCreated: 1 })) }));
vi.mock("@/lib/utils/url-safety", () => ({
  fetchPublicUrl: vi.fn(async () => ({ ok: false, code: "url_blocked", reason: "private address" })),
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: h.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn(async () => "m-inbox") }));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));

import { POST } from "@/app/api/telegram/webhook/route";

const deliver = (message: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { chat: { id: 4242 }, from: { id: 4242 }, ...message } }),
  }));
const voice = () => deliver({ voice: { file_id: "f1", duration: 4 } });
const link = () => {
  const text = "look at http://10.0.0.1/admin";
  return deliver({ text, entities: [{ type: "url", offset: 8, length: 21 }] });
};

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  h.sendTelegramForId.mockResolvedValue({ ok: true, messageId: 77 });
  h.editTelegramMessage.mockResolvedValue(true);
});

describe("acknowledgements are one message edited in place", () => {
  it("a voice note sends one message and edits it with the result", async () => {
    await voice();
    expect(h.sendTelegramForId).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).not.toHaveBeenCalled();
    const last = h.editTelegramMessage.mock.calls.at(-1)!;
    expect(last[0]).toBe(77);
    expect(String(last[1])).toContain("Ingested");
    expect(String(last[1])).toContain("pick up the tire order");
  });

  it("a failed edit sends nothing more", async () => {
    h.editTelegramMessage.mockResolvedValue(false);
    await voice();
    expect(h.sendTelegramForId).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("a link sends one message and edits it with the outcome", async () => {
    await link();
    expect(h.sendTelegramForId).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(String(h.editTelegramMessage.mock.calls.at(-1)![1])).toContain("Refused");
  });

  it("plain text gets no separate 'routed as' message", async () => {
    await deliver({ text: "todo call Mike about the alignment" });
    const texts = [...h.sendTelegram.mock.calls, ...h.sendTelegramForId.mock.calls].map((c) => String(c[0]));
    expect(texts.join("\n")).not.toContain("routed as");
    expect(texts).toHaveLength(1);
  });
});

/**
 * The `tut` callback branch of the Telegram webhook (Daily Tutor, 2026-10-16):
 * one additive branch next to `oc` that delegates to handleTutorAnswer and
 * answers the callback with its one line. Same owner gate as every callback.
 * Stubs mirror tests/telegram/webhook-followups.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in this test"); }));
  let seq = 0;
  const actionReceipt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `trk_${++seq}`, ...data })),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const prisma = new Proxy({}, {
    get: (_t, model: string) =>
      model === "actionReceipt" ? actionReceipt : new Proxy({}, { get: (_m, method: string) => inert(method) }),
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    actionReceipt,
    prisma,
    log,
    handleTutorAnswer: vi.fn(async (..._a: unknown[]) => ({ reply: "Right. Next ask in 1 day." })),
    telegram: {
      answerCallbackQuery: vi.fn(async (..._a: unknown[]) => true),
      editTelegramMessage: vi.fn(async (..._a: unknown[]) => true),
      sendTelegram: vi.fn(async (..._a: unknown[]) => true),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => h.log, info: h.log.info, warn: h.log.warn, error: h.log.error, debug: h.log.debug },
}));
vi.mock("@/lib/services/telegram", () => h.telegram);
vi.mock("@/lib/brain/tutor-pack", () => ({ handleTutorAnswer: h.handleTutorAnswer }));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { POST } from "@/app/api/telegram/webhook/route";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

let cq = 0;
function tap(data: string, fromId = 4242): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify({
        callback_query: { id: `cq_${++cq}`, data, from: { id: fromId }, message: { message_id: 7, chat: { id: 4242 } } },
      }),
    }),
  );
}
const answer = () => h.telegram.answerCallbackQuery.mock.calls.at(-1)?.[1];

describe("tut callback", () => {
  it("delegates ledgerId + choice to handleTutorAnswer and answers with its line", async () => {
    await tap("tut:led_1:B");
    expect(h.handleTutorAnswer).toHaveBeenCalledWith("led_1", "B");
    expect(answer()).toBe("Right. Next ask in 1 day.");
  });

  it("a non-owner tap never reaches the grader", async () => {
    await tap("tut:led_1:B", 9999);
    expect(h.handleTutorAnswer).not.toHaveBeenCalled();
  });

  it("a thrown grader is said, not swallowed as success", async () => {
    h.handleTutorAnswer.mockRejectedValueOnce(new Error("db down"));
    await tap("tut:led_1:B");
    expect(answer()).toBe("Could not record - try again.");
  });

  it("the grader's Malformed. verdict reaches the phone (missing choice segment)", async () => {
    h.handleTutorAnswer.mockResolvedValueOnce({ reply: "Malformed." });
    await tap("tut:led_1");
    expect(h.handleTutorAnswer).toHaveBeenCalledWith("led_1", "");
    expect(answer()).toBe("Malformed.");
  });
});

/**
 * Telegram job, lane 2 (2026-10-17) - Telegram redelivers an update when the
 * webhook answers non-200 or too slowly, and /task and /dump acted on every
 * copy. The webhook now claims each update_id in action_attempts (beginAttempt,
 * compare-and-swap reclaim) before acting; a redelivered copy answers 200 and
 * does nothing. A claim store that cannot be reached fails open (acts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown> & { id: string; operationKey: string };

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in this test"); }));
  const rows = new Map<string, Row>();
  let seq = 0;
  const same = (a: unknown, b: unknown) =>
    a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.() : a === b;
  const byWhere = (where: Record<string, unknown>) =>
    [...rows.values()].filter((r) => Object.entries(where).every(([k, v]) => same(r[k], v)));
  const actionAttempt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ([...rows.values()].some((r) => r.operationKey === data.operationKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
      const row = { id: `a${++seq}`, ...data } as Row;
      rows.set(row.id, row);
      return { id: row.id, attemptNo: row.attemptNo };
    }),
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => byWhere(where)[0] ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = byWhere(where);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("not found");
      return Object.assign(r, data);
    }),
  };
  const handlers: Record<string, Record<string, unknown>> = { actionAttempt };
  const inert = (method: string) => async () => (method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null);
  const prisma = new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) });
  return {
    rows,
    actionAttempt,
    prisma,
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
    createTask: vi.fn(async (a: { title: string }) => ({ id: "task_12345678", title: a.title })),
    ingestJournal: vi.fn(async () => ({ entryType: "raw", tasksCreated: 0 })),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  sendTelegramForId: vi.fn(async () => 1),
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: vi.fn(async () => true),
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: h.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn(async () => "m-inbox") }));
vi.mock("@/lib/brain/journal-ingest", () => ({ ingestJournal: h.ingestJournal }));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));

import { POST } from "@/app/api/telegram/webhook/route";

const deliver = (updateId: number, text: string) =>
  POST(new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ update_id: updateId, message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  }));

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.clearAllMocks(); h.rows.clear(); });

describe("a redelivered Telegram update acts once", () => {
  it("/task delivered twice creates one task", async () => {
    expect((await deliver(9001, "/task call the supplier")).status).toBe(200);
    expect((await deliver(9001, "/task call the supplier")).status).toBe(200);
    expect(h.createTask).toHaveBeenCalledTimes(1);
  });

  it("/dump delivered twice ingests once", async () => {
    await deliver(9002, "/dump tired but the bay is clear");
    await deliver(9002, "/dump tired but the bay is clear");
    expect(h.ingestJournal).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - two different updates both act", async () => {
    await deliver(9003, "/task one");
    await deliver(9004, "/task two");
    expect(h.createTask).toHaveBeenCalledTimes(2);
  });

  it("CONTROL - a claim store that cannot be reached fails open: the command still acts", async () => {
    h.actionAttempt.create.mockRejectedValueOnce(new Error("connection refused"));
    await deliver(9005, "/task still saved");
    expect(h.createTask).toHaveBeenCalledTimes(1);
  });
});

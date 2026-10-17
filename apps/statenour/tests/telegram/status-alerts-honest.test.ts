/**
 * Telegram job, lane 2 (2026-10-17) - /status wrapped every count in
 * `.catch(() => 0)` and hard-coded leads to 0; /alerts said "No active alerts
 * in the last 30 days" with no date filter and ignored the alert_mute rows the
 * /brain alert panel writes. A failed read now prints "unknown", leads come from
 * nickstire's leads_urgent query, and /alerts keeps its 30-day window and mutes.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DAY = 86_400_000;

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in this test"); }));
  const state = {
    countFails: false,
    alertsFail: false,
    mutes: [] as { key: string }[],
    alerts: [] as { category: string; content: string; createdAt: Date }[],
  };
  const count = vi.fn(async () => { if (state.countFails) throw new Error("db down"); return 2; });
  const brainMemory = {
    findMany: vi.fn(async (a: { where: { category: unknown; createdAt?: { gte: Date } } }) => {
      if (state.alertsFail) throw new Error("db down");
      if (a.where.category === "alert_mute") return state.mutes;
      const cats = (a.where.category as { in: string[] }).in;
      return state.alerts.filter((r) => cats.includes(r.category) && (!a.where.createdAt || r.createdAt >= a.where.createdAt.gte));
    }),
  };
  const handlers: Record<string, Record<string, unknown>> = {
    brainMemory,
    task: { count },
    commitment: { count },
    reflection: { count },
  };
  const inert = (method: string) => async () => (method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null);
  const prisma = new Proxy({}, { get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) });
  return {
    state,
    prisma,
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
    getUnresolvedAlerts: vi.fn(async () => [{ id: "d1" }]),
    queryNick: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ data: { count: 3 }, query: "leads_urgent", timestamp: "t" })),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  sendTelegramForId: vi.fn(async () => 1),
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: vi.fn(async () => true),
}));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: h.getUnresolvedAlerts }));
vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNick: h.queryNick,
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
const reply = () => h.sendTelegram.mock.calls.map((c) => String(c[0])).join("\n");

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.state, { countFails: false, alertsFail: false, mutes: [], alerts: [] });
  h.getUnresolvedAlerts.mockResolvedValue([{ id: "d1" }]);
  h.queryNick.mockResolvedValue({ data: { count: 3 }, query: "leads_urgent", timestamp: "t" });
});

describe("/status prints unknown for a failed read, never 0", () => {
  it("a failed count reads unknown", async () => {
    h.state.countFails = true;
    await say("/status");
    expect(reply()).toContain("Inbox: unknown");
    expect(reply()).not.toContain("Inbox: 0");
  });

  it("a failed drift read reads unknown", async () => {
    h.getUnresolvedAlerts.mockRejectedValueOnce(new Error("db down"));
    await say("/status");
    expect(reply()).toContain("Drift alerts: unknown");
  });

  it("leads come from nickstire's leads_urgent query", async () => {
    await say("/status");
    expect(h.queryNick).toHaveBeenCalledWith("leads_urgent", expect.anything(), expect.anything());
    expect(reply()).toContain("Urgent leads: 3");
  });

  it("a dead nickstire bridge reads leads unknown", async () => {
    h.queryNick.mockResolvedValueOnce({ error: "No sync key configured." });
    await say("/status");
    expect(reply()).toContain("Urgent leads: unknown");
  });

  it("CONTROL - healthy reads print real counts", async () => {
    await say("/status");
    expect(reply()).toContain("Inbox: 2");
    expect(reply()).toContain("Drift alerts: 1");
  });
});

describe("/alerts keeps its 30-day window and the mutes", () => {
  it("an alert older than 30 days is not shown as active", async () => {
    h.state.alerts = [{ category: "brain_bus_alert", content: "old bus stall", createdAt: new Date(Date.now() - 40 * DAY) }];
    await say("/alerts");
    expect(reply()).not.toContain("old bus stall");
    expect(reply()).toContain("No active alerts in the last 30 days");
  });

  it("a muted category is not shown", async () => {
    h.state.mutes = [{ key: "brain_bus_alert" }];
    h.state.alerts = [{ category: "brain_bus_alert", content: "muted bus stall", createdAt: new Date() }];
    await say("/alerts");
    expect(reply()).not.toContain("muted bus stall");
  });

  it("a failed read says unknown, never all-clear", async () => {
    h.state.alertsFail = true;
    await say("/alerts");
    expect(reply()).not.toContain("No active alerts");
    expect(reply()).toContain("unknown");
  });

  it("CONTROL - a recent unmuted alert is shown", async () => {
    h.state.alerts = [{ category: "schema_drift_alert", content: "column drift found", createdAt: new Date() }];
    await say("/alerts");
    expect(reply()).toContain("column drift found");
  });
});

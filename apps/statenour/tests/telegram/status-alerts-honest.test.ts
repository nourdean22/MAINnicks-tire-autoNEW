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
    dismissals: [] as { category: string; key: string }[],
    alerts: [] as { category: string; key?: string; content: string; createdAt: Date }[],
  };
  const count = vi.fn(async () => { if (state.countFails) throw new Error("db down"); return 2; });
  const brainMemory = {
    findMany: vi.fn(async (a: { where: { category: unknown; createdAt?: { gte: Date } }; take?: number }) => {
      if (state.alertsFail) throw new Error("db down");
      if (a.where.category === "alert_mute") return state.mutes;
      const cats = (a.where.category as { in: string[] }).in;
      // W5b: the shared suppression reader asks for mutes and dismissals in one read.
      if (cats.includes("alert_mute") || cats.includes("alert_dismiss")) {
        return [...state.mutes.map((m) => ({ category: "alert_mute", key: m.key })), ...state.dismissals];
      }
      return state.alerts
        .filter((r) => cats.includes(r.category) && (!a.where.createdAt || r.createdAt >= a.where.createdAt.gte))
        .slice(0, a.take ?? Infinity);
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
  sendTelegramForId: vi.fn(async () => ({ ok: true, messageId: 1 })),
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
  Object.assign(h.state, { countFails: false, alertsFail: false, mutes: [], dismissals: [], alerts: [] });
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

  // #3097 review P3-3: nickstire's leads_urgent query is LIMIT 20, so 20 means "at least 20".
  it("a count at the query's limit prints 20+", async () => {
    h.queryNick.mockResolvedValueOnce({ data: { count: 20 }, query: "leads_urgent", timestamp: "t" });
    await say("/status");
    expect(reply()).toContain("Urgent leads: 20+");
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

  // UI v3 W5b, consumer 2: a dismissal made on /system/alerts holds in Telegram too.
  it("a dismissed alert is not shown; an undismissed one in the same category is", async () => {
    const { alertDismissKey } = await import("@/lib/brain/alert-lanes");
    h.state.alerts = [
      { category: "brain_bus_alert", key: "dead-event:one", content: "dismissed bus event", createdAt: new Date() },
      { category: "brain_bus_alert", key: "dead-event:two", content: "live bus event", createdAt: new Date() },
    ];
    h.state.dismissals = [{ category: "alert_dismiss", key: alertDismissKey("brain_bus_alert", "dead-event:one") }];
    await say("/alerts");
    expect(reply()).not.toContain("dismissed bus event");
    expect(reply()).toContain("live bus event");
  });

  it("dismissed rows do not crowd out the five it lists", async () => {
    const { alertDismissKey } = await import("@/lib/brain/alert-lanes");
    const t = Date.now();
    h.state.alerts = Array.from({ length: 7 }, (_, i) => ({
      category: "brain_bus_alert",
      key: `dead-event:${i}`,
      content: `bus event ${i}`,
      createdAt: new Date(t - i * 1000),
    }));
    h.state.dismissals = [0, 1, 2].map((i) => ({ category: "alert_dismiss", key: alertDismissKey("brain_bus_alert", `dead-event:${i}`) }));
    await say("/alerts");
    for (const i of [3, 4, 5, 6]) expect(reply()).toContain(`bus event ${i}`);
    expect(reply()).not.toContain("bus event 0");
  });

  it("CONTROL - a recent unmuted alert is shown", async () => {
    h.state.alerts = [{ category: "schema_drift_alert", content: "column drift found", createdAt: new Date() }];
    await say("/alerts");
    expect(reply()).toContain("column drift found");
  });
});

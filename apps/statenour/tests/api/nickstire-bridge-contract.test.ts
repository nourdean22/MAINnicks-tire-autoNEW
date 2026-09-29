/**
 * The nickstire -> StateNour bridge contract, receiver side. Bound to
 * config/nickstire-bridge-events.json, whose `data` is the exact event.data the nickstire
 * bridge sends (pinned on the sender side by apps/nickstire/server/bridgeEventContract.test.ts).
 *
 * Each fixture event goes through BOTH receivers and the assertions sit at the consumer end:
 * the Telegram text the owner reads, the drift-alert body, the stored audit row, and the brain
 * pipeline type. Before this file the webhook read `name` / `totalCents` / `text` while the
 * bridge sent `customer` / `totalAmount` / `reviewText`, so alerts read "NEW LEAD — Unknown"
 * and "JOB COMPLETE — $0", and anonymous website estimates arrived as JOB COMPLETE.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendTelegram, auditCreate, recordCoachEvent, processShopEvent } = vi.hoisted(() => ({
  sendTelegram: vi.fn(),
  auditCreate: vi.fn(),
  recordCoachEvent: vi.fn(),
  processShopEvent: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: auditCreate },
    socialPublishQueue: { upsert: vi.fn() },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
// Real escapeHtml: the alerts are HTML-mode, and the escaping is part of what is asserted.
vi.mock("@/lib/services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/telegram")>()),
  sendTelegram,
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired: vi.fn() }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent }));

import { POST as webhookPOST } from "@/app/api/webhooks/nickstire/route";
import { POST as syncPOST } from "@/app/api/sync/events/route";

type Entry = {
  type: string;
  data: Record<string, unknown>;
  statenour: { webhookAlert: string[] | null; coachEvent: string[] | null; pipeline: string | null };
};
const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "config", "nickstire-bridge-events.json"), "utf8"),
) as { events: Entry[] };

// The bridge's own envelope (nour-os-bridge.ts pushToCloud): { events: [NourOsEvent] }.
function post(handler: (req: Request) => Promise<Response>, path: string, type: string, data: unknown) {
  return handler(
    new Request(`http://test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ events: [{ type, timestamp: "2026-09-29T12:00:00.000Z", source: "nickstire", data, eventId: "evt_test" }] }),
    }),
  );
}

beforeEach(() => {
  sendTelegram.mockReset().mockResolvedValue(true);
  auditCreate.mockReset().mockResolvedValue({});
  recordCoachEvent.mockReset().mockResolvedValue({ eventId: "coach_1" });
  processShopEvent.mockReset().mockResolvedValue({ processed: true, actions: [] });
});

const cases = fixture.events.map(e => [e.type, e] as const);

describe("webhooks/nickstire renders the fields the bridge actually sends", () => {
  it.each(cases)("%s", async (_t, entry) => {
    const res = await post(webhookPOST, "/api/webhooks/nickstire", entry.type, entry.data);
    expect(res.status).toBe(200);
    const texts = sendTelegram.mock.calls.map(c => String(c[0]));
    if (entry.statenour.webhookAlert === null) {
      expect(texts).toEqual([]);
      return;
    }
    expect(texts).toHaveLength(1);
    for (const s of entry.statenour.webhookAlert) expect(texts[0]).toContain(s);
    expect(texts[0]).not.toContain("Unknown");
  });

  it("an estimate is never announced as a completed job", async () => {
    const estimate = fixture.events.find(e => e.type === "nickstire:estimate")!;
    await post(webhookPOST, "/api/webhooks/nickstire", estimate.type, estimate.data);
    expect(sendTelegram.mock.calls.map(c => String(c[0])).join("\n")).not.toContain("JOB COMPLETE");
  });

  it("a completed booking with no amount says no amount, not $0", async () => {
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:booking:complete", {
      bookingId: 1, customer: "Test Customer", service: "Oil change", invoiceNumber: null, totalAmount: null,
    });
    const text = String(sendTelegram.mock.calls[0]?.[0]);
    expect(text).toContain("JOB COMPLETE");
    expect(text).toContain("Test Customer");
    expect(text).not.toContain("$0");
  });

  // Telegram parses these as HTML: an unescaped `<` or `&` in customer text is a 400
  // "can't parse entities" and the alert is dropped (reported as telegram_alert_failed).
  it("customer-written text is HTML-escaped in every alert", async () => {
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:review", {
      rating: 5, reviewText: "Fast and fair <3", customerName: "Test <Reviewer> & Co",
    });
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:lead", {
      leadId: 1, customer: "Test <b>Customer", phone: "2165550100", interest: "brakes & rotors",
    });
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:emergency", {
      name: "Test Customer", phone: "2165550104", description: "stuck at I-90 <exit 177>",
    });
    const [review, lead, emergency] = sendTelegram.mock.calls.map(c => String(c[0]));
    expect(review).toContain("Fast and fair &lt;3");
    expect(review).toContain("Test &lt;Reviewer&gt; &amp; Co");
    expect(lead).toContain("NEW LEAD — Test &lt;b&gt;Customer</b>");
    expect(lead).toContain("brakes &amp; rotors");
    expect(emergency).toContain("stuck at I-90 &lt;exit 177&gt;");
    // The alert's own markup survives: only data is escaped.
    for (const t of [review, lead, emergency]) expect(t).toMatch(/<b>.*<\/b>/);
  });

  it("legacy field names still render (additive fallbacks, PROTECTED-CORE rule 8)", async () => {
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:lead", { name: "Legacy Name", phone: "2165550000" });
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:invoice", { customerName: "Legacy Name", totalCents: 12300 });
    await post(webhookPOST, "/api/webhooks/nickstire", "nickstire:review", { rating: 5, customerName: "Legacy Name", text: "legacy text" });
    const texts = sendTelegram.mock.calls.map(c => String(c[0]));
    expect(texts[0]).toContain("Legacy Name");
    expect(texts[1]).toContain("$123");
    expect(texts[2]).toContain("legacy text");
  });
});

describe("sync/events stores, alerts and pipes the fields the bridge actually sends", () => {
  it.each(cases)("%s", async (_t, entry) => {
    const res = await post(syncPOST, "/api/sync/events", entry.type, entry.data);
    expect(res.status).toBe(200);

    // Every bridge event lands as an audit row carrying the payload verbatim.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.eventType).toBe(entry.type);
    expect(auditCreate.mock.calls[0][0].data.payload).toEqual(entry.data);

    const bodies = recordCoachEvent.mock.calls.map(c => String(c[0].body));
    if (entry.statenour.coachEvent === null) {
      expect(bodies).toEqual([]);
    } else {
      expect(bodies).toHaveLength(1);
      for (const s of entry.statenour.coachEvent) expect(bodies[0]).toContain(s);
      expect(bodies[0]).not.toContain("Unknown");
    }

    const piped = processShopEvent.mock.calls.map(c => c[0].type);
    expect(piped).toEqual(entry.statenour.pipeline === null ? [] : [entry.statenour.pipeline]);
  });
});

/**
 * Q-12 phase 1b · bridge_outbox shadow enqueue (ADR-0019 §4, §5.2, §9).
 *
 * The contract: with the flag OFF nothing touches the database; with it ON each
 * bus event bound for StateNour becomes at most one status='shadow' row, keyed
 * by the business fact (never by send time, never by a phone), and a repeat of
 * the same fact is one row. A failure never leaks the payload into an error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  getDb: vi.fn<() => Promise<any>>(),
  execute: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("./featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../db", () => ({ getDb: h.getDb }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: h.logInfo, warn: h.logWarn, debug: vi.fn() }),
}));

import { BUSINESS_EVENTS, type BusinessEvent, type EventPayload } from "./eventBus";
import { shadowEnqueue } from "./bridgeOutbox";

const PHONE = "2165550142";

function ev(type: BusinessEvent, data: Record<string, unknown>, timestamp = "2026-09-29T20:00:00.000Z"): EventPayload {
  return { type, data, priority: "high", source: "test", timestamp };
}

/** The SQL text and bound params of the n-th execute() call. */
function call(n = 0): { text: string; params: unknown[] } {
  const q = h.execute.mock.calls[n][0] as { queryChunks: unknown[] };
  const text: string[] = [];
  const params: unknown[] = [];
  for (const c of q.queryChunks) {
    if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) {
      text.push(((c as { value: string[] }).value).join(""));
    } else {
      params.push(c);
      text.push("?");
    }
  }
  return { text: text.join(""), params };
}

/** Enqueue one event with the flag ON; return the key it wrote, or the logged unkeyed reason. */
async function keyFor(type: BusinessEvent, data: Record<string, unknown>, timestamp?: string): Promise<{ key?: string; reason?: string; call?: ReturnType<typeof call> }> {
  h.execute.mockClear();
  h.logInfo.mockClear();
  await shadowEnqueue(ev(type, data, timestamp));
  if (h.execute.mock.calls.length === 1) {
    const c = call();
    return { key: c.params[0] as string, call: c };
  }
  expect(h.execute).not.toHaveBeenCalled();
  const logged = h.logInfo.mock.calls.find((a) => a[0] === "bridge_outbox unkeyed");
  return { reason: (logged?.[1] as { reason?: string } | undefined)?.reason };
}

describe("bridge_outbox key derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isEnabled.mockResolvedValue(true);
    h.getDb.mockResolvedValue({ execute: h.execute });
    h.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  it("maps every bus type to a key or a logged reason (never silently nothing)", async () => {
    for (const type of BUSINESS_EVENTS) {
      const r = await keyFor(type, { id: 5, orderNumber: "TO-20260929-123", invoiceNumber: "INV-9", campaignId: 3, source: "x" });
      expect(r.key ?? r.reason, type).toBeTruthy();
    }
  });

  it("keys a lead by its row id, and the same lead at another time is the same key", async () => {
    const a = await keyFor("lead_captured", { id: 7101, name: "Ann", phone: PHONE, source: "web" });
    const b = await keyFor("lead_captured", { id: 7101, name: "Ann", phone: PHONE, source: "web" }, "2026-09-29T21:00:00.000Z");
    expect(a.key).toBe("v1:lead.created:lead:7101");
    expect(b.key).toBe(a.key); // send time never enters the key
    expect(a.call!.params).toContain("lead.created");
  });

  it("never builds a key from a phone, even when the id is missing", async () => {
    for (const type of BUSINESS_EVENTS) {
      const r = await keyFor(type, { name: "Ann", phone: PHONE, customerPhone: PHONE });
      // A missing id is "no_object_id" for every keyed type: the derivation never
      // reaches for another field (a phone would surface as "key_rejected").
      expect(r.key, type).toBeUndefined();
      if (r.reason !== "excluded") expect(r.reason, type).toBe("no_object_id");
    }
    expect(JSON.stringify(h.logInfo.mock.calls)).not.toContain(PHONE);
  });

  it("refuses a phone-shaped id instead of storing it in the key", async () => {
    expect(await keyFor("lead_captured", { id: PHONE })).toEqual({ reason: "key_rejected" });
  });

  it("hashes invoice numbers, whose shapes vary, and keeps paid distinct from created", async () => {
    const created = await keyFor("invoice_created", { invoiceNumber: "Invoice# 123", customerName: "Ann", totalAmount: 10 });
    const paid = await keyFor("invoice_paid", { invoiceNumber: "Invoice# 123", customerName: "Ann", totalAmount: 10 });
    expect(created.key).toMatch(/^v1:shop\.invoice\.created:invoice:[a-p]{16}$/);
    expect(paid.key).toMatch(/^v1:shop\.invoice\.paid:invoice:[a-p]{16}$/);
  });

  it("keeps stage_changed off the outbox (a re-entered stage would dedupe a real event)", async () => {
    expect(await keyFor("stage_changed", { id: 1, workOrderId: 1, newStatus: "done" })).toEqual({ reason: "excluded" });
  });

  it("keys drafts and heartbeats by object, latest-wins", async () => {
    const draft = await keyFor("social_draft:sync", { id: 42, content: "x" });
    expect(draft.key).toBe("v1:content.draft.synced:draft:42");
    expect(draft.call!.text).toMatch(/ON DUPLICATE KEY UPDATE/);
    const mirror = await keyFor("mirror_synced", { source: "shopdriver_alg", newInvoices: 3 });
    expect(mirror.key).toBe("v1:sync.mirror.completed:source:shopdriver_alg");
  });

  it("stores the statenour-sync body plus the key, with the dispatch time as occurred_at", async () => {
    const r = await keyFor("booking_created", { id: 9, name: "Ann", service: "brakes" });
    const [key, eventType, route, payload, occurredAt] = r.call!.params;
    expect([key, eventType, route]).toEqual(["v1:shop.booking.created:booking:9", "shop.booking.created", "sync/events"]);
    expect(JSON.parse(payload as string)).toEqual({
      type: "nickstire:booking_created",
      timestamp: "2026-09-29T20:00:00.000Z",
      source: "test",
      priority: "high",
      data: { id: 9, name: "Ann", service: "brakes" },
      idempotencyKey: "v1:shop.booking.created:booking:9",
    });
    expect(occurredAt).toEqual(new Date("2026-09-29T20:00:00.000Z"));
  });
});

describe("shadowEnqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isEnabled.mockResolvedValue(true);
    h.getDb.mockResolvedValue({ execute: h.execute });
    h.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  it("does nothing, and never opens the database, while the flag is OFF", async () => {
    h.isEnabled.mockResolvedValue(false);
    await expect(shadowEnqueue(ev("lead_captured", { id: 1 }))).resolves.toBe("disabled");
    expect(h.isEnabled).toHaveBeenCalledWith("bridge_outbox_shadow");
    expect(h.getDb).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("writes one INSERT IGNORE shadow row for a fact", async () => {
    await expect(shadowEnqueue(ev("lead_captured", { id: 7101, name: "Ann", phone: PHONE }))).resolves.toBe("enqueued");
    expect(h.execute).toHaveBeenCalledTimes(1);
    const { text, params } = call();
    expect(text).toMatch(/INSERT IGNORE INTO bridge_outbox/);
    expect(text).toMatch(/'shadow'\s*\)/);
    expect(text).not.toMatch(/ON DUPLICATE KEY/);
    expect(params).toContain("v1:lead.created:lead:7101");
    expect(params).toContain("lead.created");
    expect(params).toContain("sync/events");
  });

  it("reports a repeat of the same fact as a duplicate (INSERT IGNORE affected 0 rows)", async () => {
    h.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    await expect(shadowEnqueue(ev("lead_captured", { id: 7101 }))).resolves.toBe("duplicate");
  });

  it("coalesces latest-wins types, and only onto rows that are still shadow", async () => {
    h.execute.mockResolvedValue([{ affectedRows: 2 }, []]);
    await expect(shadowEnqueue(ev("social_draft:sync", { id: 42 }))).resolves.toBe("coalesced");
    const { text } = call();
    expect(text).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(text).toMatch(/payload = IF\(status = 'shadow', VALUES\(payload\), payload\)/);
    expect(text).not.toMatch(/status\s*=\s*'pending'/);
  });

  it("writes nothing for an unkeyed or excluded type, and logs no payload", async () => {
    await expect(shadowEnqueue(ev("callback_requested", { name: "Ann", phone: PHONE }))).resolves.toBe("unkeyed");
    await expect(shadowEnqueue(ev("stage_changed", { workOrderId: 1 }))).resolves.toBe("excluded");
    expect(h.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(h.logInfo.mock.calls)).not.toContain(PHONE);
  });

  it("treats a missing table (0137 not applied) as table_missing, not a failure", async () => {
    class DrizzleQueryError extends Error { query = "INSERT"; params = []; }
    const wrapped = new DrizzleQueryError("Failed query");
    (wrapped as { cause?: unknown }).cause = Object.assign(new Error("Table 'nick.bridge_outbox' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    h.execute.mockRejectedValue(wrapped);
    await expect(shadowEnqueue(ev("lead_captured", { id: 1 }))).resolves.toBe("table_missing");
    expect(h.logWarn).toHaveBeenCalled();
  });

  it("rethrows other DB errors WITHOUT the bound payload (the bus copies the message to Telegram)", async () => {
    class DrizzleQueryError extends Error { query = "INSERT"; params = []; }
    const wrapped = new DrizzleQueryError(`Failed query: INSERT IGNORE INTO bridge_outbox ...\nparams: v1:lead.created:lead:1,{"data":{"phone":"${PHONE}","name":"Ann"}}`);
    (wrapped as { cause?: unknown }).cause = Object.assign(new Error("Lock wait timeout"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    h.execute.mockRejectedValue(wrapped);
    const err = await shadowEnqueue(ev("lead_captured", { id: 1, phone: PHONE, name: "Ann" })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("bridge_outbox shadow insert failed (ER_LOCK_WAIT_TIMEOUT/1205)");
    expect((err as Error).message).not.toContain(PHONE);
  });
});

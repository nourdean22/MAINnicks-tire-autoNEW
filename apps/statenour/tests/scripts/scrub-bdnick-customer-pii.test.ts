/**
 * scripts/scrub-bdnick-customer-pii.ts (2026-10-19, bdnick prune job).
 *
 * The one-off purge of customer names, phones and emails from rows bdnick stored before wave 3.
 * Three things are pinned here:
 *   1. each bucket's transform leaves no name, phone or email and keeps the counts and ids, and
 *      equals what the wave 3 writer stores today for the same input;
 *   2. the dry run cannot write: the real Prisma adapter is driven with a client whose every write
 *      method throws (prod-db-guard, the 870-row incident);
 *   3. the execute path aborts before any write on an --expect mismatch, an existing backup table or
 *      a backup count mismatch, and a second run finds nothing left to change.
 * Customer data in fixtures is synthetic.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { scrubBridgePayload, stripSyncCustomerPii } from "@/lib/brain/customer-pii";
import { buildCeoContextFromNickSyncPayload } from "@/lib/nickstire/ceo-context";
import {
  BUCKETS,
  TABLES,
  changedColumns,
  checkTarget,
  parseArgs,
  prismaScrubDb,
  run,
  type Bucket,
  type Row,
  type ScrubDb,
  type TableSpec,
} from "../../scripts/scrub-bdnick-customer-pii";

const PII = ["Jane", "Roe", "Bobby", "Tables", "5551234", "555-1234", "555-9876", "555-0000", "jane@example.test"];
function expectNoPii(value: unknown): void {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  for (const p of PII) expect(s, `"${p}" survived in ${s}`).not.toContain(p);
}
const bucket = (name: string): Bucket => {
  const b = BUCKETS.find((x) => x.name === name);
  if (!b) throw new Error(`no bucket ${name}`);
  return b;
};
const apply = (name: string, row: Row) => ({ ...row, ...bucket(name).transform(row) });

const RAW_SYNC = {
  source: "nickstire",
  version: "v2",
  revenue: { today: 512, week: 4100 },
  leads: { urgent: 2, new: 3 },
  customerIntelligence: {
    atRiskCustomers: [
      { name: "Jane Roe", phone: "2165551234", email: "jane@example.test", daysSince: 40, lastVisit: "2026-08-01" },
      { name: "Bobby Tables", phone: "(216) 555-9876", daysSince: 75, lastVisit: "2026-07-01" },
    ],
    topSpenders: [{ name: "Bobby Tables", phone: "216-555-9876", total: 1200, visits: 5 }],
    actionPlan: "• CALL NOW: Jane Roe 216-555-1234\n• PROTECT: Bobby Tables\n• Restock 225/65R17",
  },
  nickAI: { memories: ["Jane Roe prefers mornings"] },
  operatorPatterns: [{ note: "Bobby Tables pays cash" }],
  customerJourneys: [{ customerName: "Jane Roe", phone: "2165551234", visits: 3, customerId: "cus_1" }],
  intelligence: { actionPlan: "• CALL NOW: Jane Roe\n• Order tires", atRiskCustomers: [{ name: "Jane Roe", daysSince: 40 }] },
};

describe("bucket transforms · no name, phone or email survives; counts and ids stay", () => {
  it("business_metrics_sync: equals what POST /api/sync/business stores today, and kept counts are identical", () => {
    const row = { id: "a1", eventType: "business_metrics_sync", actor: "nickstire-sync", detail: "Business metrics sync from Nick's Tire", payload: structuredClone(RAW_SYNC) };
    const out = apply("audit_business_metrics_sync", row);
    expectNoPii(out.payload);
    expect(out.payload).toEqual(stripSyncCustomerPii(structuredClone(RAW_SYNC)));
    const p = out.payload as typeof RAW_SYNC;
    expect(p.revenue).toEqual({ today: 512, week: 4100 });
    expect(p.customerIntelligence.atRiskCustomers).toEqual([{ daysSince: 40, lastVisit: "2026-08-01" }, { daysSince: 75, lastVisit: "2026-07-01" }]);
    expect(p.customerIntelligence.topSpenders).toEqual([{ total: 1200, visits: 5 }]);
    expect(p.customerJourneys).toEqual([{ visits: 3, customerId: "cus_1" }]);
    expect(p.customerIntelligence.actionPlan).toContain("• Restock 225/65R17");
    expect(p.customerIntelligence.actionPlan).toContain("2 at-risk customers");
  });

  it("business_metrics_sync: a row already stored by the wave 3 writer is left unchanged (no second AT-RISK line)", () => {
    const stored = stripSyncCustomerPii(structuredClone(RAW_SYNC));
    const row = { id: "a2", eventType: "business_metrics_sync", actor: "nickstire-sync", detail: "Business metrics sync from Nick's Tire", payload: stored };
    expect(changedColumns(bucket("audit_business_metrics_sync"), row)).toEqual([]);
  });

  it("FINDING (why the script wraps it): stripSyncCustomerPii applied twice appends a second AT-RISK line", () => {
    // If this goes red, wave 3 made the function idempotent: drop the wrapper in the script.
    const once = stripSyncCustomerPii(structuredClone(RAW_SYNC));
    expect(JSON.stringify(stripSyncCustomerPii(structuredClone(once)))).not.toBe(JSON.stringify(once));
  });

  it("ceo_business_context: equals the row the writer now builds from the stripped payload", () => {
    const oldRow = buildCeoContextFromNickSyncPayload(structuredClone(RAW_SYNC));
    const today = buildCeoContextFromNickSyncPayload(stripSyncCustomerPii(structuredClone(RAW_SYNC)) as Record<string, unknown>);
    const out = apply("audit_ceo_business_context", { id: "c1", eventType: "ceo_business_context", actor: "nickstire-sync", detail: "Normalized CEO context (nickstire sync v2)", payload: oldRow });
    expectNoPii(out.payload);
    // updatedAt is the build time when the payload has no timestamp, so compare without it.
    const strip = (v: unknown) => ({ ...(v as Record<string, unknown>), updatedAt: null });
    expect(strip(out.payload)).toEqual(strip(today));
    expect((out.payload as { prioritizedActions: unknown[] }).prioritizedActions).toEqual(oldRow.prioritizedActions);
  });

  it("nickstire:* from /api/sync/events: the GET projection, and detail stays the fixed text", () => {
    const payload = { customerName: "Jane Roe", phone: "216-555-1234", email: "jane@example.test", service: "brakes", leadId: "L1", amount: 300 };
    const row = { id: "n1", eventType: "nickstire:lead", actor: "nickstire", detail: "Bridge event: nickstire:lead", payload };
    const out = apply("audit_nickstire_events", row);
    expectNoPii(out.payload);
    expect(out.payload).toEqual(scrubBridgePayload(payload));
    expect(out.payload).toMatchObject({ service: "brakes", leadId: "L1", amount: 300 });
    expect(out.detail).toBe("Bridge event: nickstire:lead");
  });

  it("nickstire:* from the webhook: the field-names-and-ids shape that writer stores today", () => {
    const raw = { name: "Jane Roe", phone: "2165551234", leadId: "L2", rating: 5 };
    const row = { id: "n2", eventType: "nickstire:lead", actor: "nickstire_webhook", detail: "Webhook: nickstire:lead", payload: raw };
    const out = apply("audit_nickstire_events", row);
    expectNoPii(out.payload);
    expect(out.payload).toEqual({ keys: ["name", "phone", "leadId", "rating"], ids: { leadId: "L2", rating: 5 } });
    expect(changedColumns(bucket("audit_nickstire_events"), { ...row, payload: out.payload })).toEqual([]);
  });

  it("business_event 'Shop <type>: <json>' memories: the processShopEvent projection, a truncated row salvaged", () => {
    const full = { id: "m1", category: "business_event", key: "shop_lead_1", content: `Shop lead: ${JSON.stringify({ customerName: "Jane Roe", phone: "2165551234", service: "brakes", leadId: "L1", reviewText: "Jane Roe says hi" })}`, metadata: null };
    const out = apply("memories_shop_events", full);
    expect(out.content).toBe('Shop lead: {"service":"brakes","leadId":"L1"}');
    const cut = { ...full, id: "m2", content: 'Shop booking: {"service":"tires","leadId":"L9","customerName":"Jane Ro' };
    expect(apply("memories_shop_events", cut).content).toBe('Shop booking: {"service":"tires","leadId":"L9"}');
    const emergency = { id: "m3", category: "anomaly", key: "emergency_1", content: `EMERGENCY: ${JSON.stringify({ name: "Jane Roe", phone: "2165551234", vehicle: "2015 Civic", urgency: "high" })}`, metadata: null };
    expect(apply("memories_emergency", emergency).content).toBe('EMERGENCY: {"vehicle":"2015 Civic","urgency":"high"}');
  });

  it("lead and call insights: rewritten to today's text, service and duration kept", () => {
    const lead = { id: "i1", category: "insight", key: "lead_source_website_2026-09-01", content: "New lead from website: Jane Roe — brake job", metadata: null };
    expect(apply("memories_lead_call", lead).content).toBe("New lead from website — brake job");
    const call = { id: "i2", category: "insight", key: "call_completed_1", content: "Phone call from +12165551234 ended. Duration: 95s. Reason: customer-ended-call. Mentioned: brakes, call me at 216-555-0000.", metadata: null };
    expect(apply("memories_lead_call", call).content).toBe("Phone call ended. Duration: 95s. Reason: customer-ended-call. Mentioned: brakes, call me at [phone].");
    const legacy = { ...lead, id: "i3", category: "business_event" };
    expectNoPii(apply("memories_lead_call", legacy).content);
  });

  it("coach_event: the callback and review bodies become the writer's fixed text; eventId and title stay", () => {
    const meta = { eventId: "e1", kind: "drift-recovery", subjectId: "callback_requested", priority: "P2", body: "Callback: Jane Roe — 2165551234", surfaces: ["home"], dismissable: true, extra: {} };
    const cb = apply("memories_coach_events", { id: "k1", category: "coach_event", key: "coach:drift-recovery:callback_requested", content: "Customer Callback Requested", metadata: meta });
    expect(cb.metadata).toEqual({ ...meta, body: "Callback requested: see Customers in Nick's Admin" });
    expect(cb.content).toBe("Customer Callback Requested");
    const rv = apply("memories_coach_events", { id: "k2", category: "coach_event", key: "coach:drift-recovery:negative_review", content: "Negative Google Review", metadata: { ...meta, body: "2★ review from Jane Roe: rude, call 2165551234" } });
    expect((rv.metadata as { body: string }).body).toBe("2★ review received: see Reviews in Nick's Admin");
    expectNoPii(rv.metadata);
  });

  it("brain_bus_events drift alerts: the message becomes the writer's fixed text, the rest of the payload stays", () => {
    const payload = { alertId: "e1", ruleId: "callback_requested", ruleName: "Customer Callback Requested", severity: "warning", message: "Callback: Jane Roe — 2165551234", date: "2026-09-01" };
    const out = apply("bus_drift_customer_alerts", { id: "b1", payload });
    expect(out.payload).toEqual({ ...payload, message: "Callback requested: see Customers in Nick's Admin" });
    const review = apply("bus_drift_customer_alerts", { id: "b2", payload: { ...payload, ruleId: "negative_review", message: "1★ review from Jane Roe: awful" } });
    expect((review.payload as { message: string }).message).toBe("1★ review received: see Reviews in Nick's Admin");
  });

  it("the fixed texts are still the writers' literals (a writer change must break this test)", () => {
    const events = readFileSync(new URL("../../app/api/sync/events/route.ts", import.meta.url), "utf8");
    expect(events).toContain('"Callback requested: see Customers in Nick\'s Admin"');
    expect(events).toContain("★ review received: see Reviews in Nick's Admin`");
    const pipeline = readFileSync(new URL("../../lib/brain/pipeline-controller.ts", import.meta.url), "utf8");
    expect(pipeline).toContain("`New lead from ${source} — ${scrubText(");
    expect(pipeline).toContain("`Phone call ended. Duration: ${duration}s. Reason: ${scrubText(");
    expect(pipeline).toContain("const memContent = `Shop ${event.type}: ${JSON.stringify(safeData).slice(0, 300)}`;");
  });
});

// ---- an in-memory database behind the ScrubDb interface -----------------------------------------

function fixtures(): Record<string, Row[]> {
  return {
    audit_business_metrics_sync: [
      { id: "a1", eventType: "business_metrics_sync", actor: "nickstire-sync", detail: "Business metrics sync from Nick's Tire", payload: structuredClone(RAW_SYNC) },
      { id: "a2", eventType: "business_metrics_sync", actor: "nickstire-sync", detail: "Business metrics sync from Nick's Tire", payload: stripSyncCustomerPii(structuredClone(RAW_SYNC)) },
    ],
    audit_ceo_business_context: [],
    audit_nickstire_events: [{ id: "n1", eventType: "nickstire:lead", actor: "nickstire", detail: "Bridge event: nickstire:lead", payload: { customerName: "Jane Roe", service: "brakes" } }],
    memories_shop_events: [{ id: "m1", category: "business_event", key: "shop_lead_1", content: 'Shop lead: {"customerName":"Jane Roe","service":"brakes"}', metadata: null }],
    memories_emergency: [],
    memories_lead_call: [{ id: "i1", category: "insight", key: "lead_source_website_2026-09-01", content: "New lead from website: Jane Roe — brakes", metadata: null }],
    memories_coach_events: [],
    bus_drift_customer_alerts: [{ id: "b1", payload: { ruleId: "callback_requested", message: "Callback: Jane Roe — 2165551234" } }],
  };
}

function memoryDb(opts: { existingBackups?: string[]; backupShortBy?: number } = {}) {
  const data = fixtures();
  const backups = new Map<string, Set<string>>((opts.existingBackups ?? []).map((t) => [t, new Set()]));
  const calls = { createBackup: 0, writeRow: 0 };
  const tableOf = (b: Bucket) => b.table.name;
  const db: ScrubDb = {
    async readBatch(b, afterId, limit, onlyBackedUp) {
      const ids = backups.get(tableOf(b));
      return data[b.name]
        .filter((r) => r.id > afterId && (!onlyBackedUp || ids?.has(r.id)))
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .slice(0, limit)
        .map((r) => structuredClone(r));
    },
    async backupExists(t: TableSpec) {
      return backups.has(t.name);
    },
    async createBackup(t: TableSpec) {
      calls.createBackup++;
      const rows = BUCKETS.filter((b) => b.table.name === t.name).flatMap((b) => data[b.name]);
      backups.set(t.name, new Set(rows.map((r) => r.id)));
      return { backedUp: rows.length - (opts.backupShortBy ?? 0), inScope: rows.length };
    },
    async writeRow(b, row, next) {
      calls.writeRow++;
      const target = data[b.name].find((r) => r.id === row.id);
      if (!target) return false;
      Object.assign(target, structuredClone(next));
      return true;
    },
  };
  return { db, calls, data };
}

const quiet = { log: () => {} };

describe("run · dry run, --expect, backup refusal, idempotence", () => {
  it("POSITIVE CONTROL: the dry run sees the PII rows (a zero here would make every test below vacuous)", async () => {
    const { db } = memoryDb();
    const s = await run(db, { execute: false, resume: false, ...quiet });
    expect(s.totalToChange).toBe(5);
    expect(s.buckets.audit_business_metrics_sync).toMatchObject({ inScope: 2, toChange: 1 });
  });

  it("an --expect mismatch aborts before any backup or write", async () => {
    const { db, calls } = memoryDb();
    const s = await run(db, { execute: true, expect: 4, resume: false, ...quiet });
    expect(s.aborted).toMatch(/expect/);
    expect(calls).toEqual({ createBackup: 0, writeRow: 0 });
  });

  it("an existing backup table is refused before any backup or write", async () => {
    const { db, calls } = memoryDb({ existingBackups: [TABLES.memories.name] });
    const s = await run(db, { execute: true, expect: 5, resume: false, ...quiet });
    expect(s.aborted).toMatch(/already exists/);
    expect(calls).toEqual({ createBackup: 0, writeRow: 0 });
  });

  it("a backup count that differs from the scope count aborts before any write", async () => {
    const { db, calls } = memoryDb({ backupShortBy: 1 });
    const s = await run(db, { execute: true, expect: 5, resume: false, ...quiet });
    expect(s.aborted).toMatch(/backup/);
    expect(calls.writeRow).toBe(0);
  });

  it("execute writes exactly the expected rows; a second run finds 0 to change and a --resume writes nothing", async () => {
    const { db, calls, data } = memoryDb();
    const first = await run(db, { execute: true, expect: 5, resume: false, ...quiet });
    expect(first.aborted).toBeUndefined();
    expect(first.written).toBe(5);
    expectNoPii(data);
    const again = await run(db, { execute: false, resume: false, ...quiet });
    expect(again.totalToChange).toBe(0);
    const resumed = await run(db, { execute: true, expect: 0, resume: true, ...quiet });
    expect(resumed.aborted).toBeUndefined();
    expect(resumed.written).toBe(0);
    expect(calls.writeRow).toBe(5);
  });

  it("--resume without a backup table is refused", async () => {
    const { db, calls } = memoryDb();
    const s = await run(db, { execute: true, expect: 5, resume: true, ...quiet });
    expect(s.aborted).toMatch(/no backup/);
    expect(calls.writeRow).toBe(0);
  });
});

describe("dry run through the real Prisma adapter · every write method throws", () => {
  it("counts every bucket and never calls a write method", async () => {
    const data = fixtures();
    const trap = () => {
      throw new Error("WRITE ATTEMPTED IN DRY RUN");
    };
    const queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) => {
      if (!/^\s*SELECT\b/i.test(sql)) trap();
      const b = BUCKETS.find((x) => sql.includes(x.where));
      if (!b) throw new Error(`unexpected read: ${sql}`);
      const after = String(params[0]);
      return data[b.name].filter((r) => r.id > after).slice(0, Number(params[1]));
    });
    const client = {
      $queryRawUnsafe: queryRawUnsafe,
      $executeRawUnsafe: vi.fn(trap),
      $executeRaw: vi.fn(trap),
      $transaction: vi.fn(trap),
      auditEvent: { update: vi.fn(trap), updateMany: vi.fn(trap), create: vi.fn(trap), createMany: vi.fn(trap) },
      brainMemory: { update: vi.fn(trap), updateMany: vi.fn(trap), create: vi.fn(trap), createMany: vi.fn(trap) },
      brainBusEvent: { update: vi.fn(trap), updateMany: vi.fn(trap), create: vi.fn(trap), createMany: vi.fn(trap) },
    };
    const s = await run(prismaScrubDb(client), { execute: false, resume: false, ...quiet });
    // Not merely "no write": the dry run must return on its own branch, not be rescued by the --expect gate.
    expect(s.aborted).toBeUndefined();
    expect(s.totalToChange).toBe(5);
    expect(queryRawUnsafe).toHaveBeenCalled();
    for (const fn of [client.$executeRawUnsafe, client.$executeRaw, client.$transaction]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("arguments and target check", () => {
  it("--execute needs --expect, --target and --prod-host", () => {
    expect(() => parseArgs(["--execute"])).toThrow(/--expect/);
    expect(() => parseArgs(["--execute", "--expect", "5"])).toThrow(/--target/);
    expect(() => parseArgs(["--execute", "--expect", "5", "--target", "branch"])).toThrow(/--prod-host/);
    expect(parseArgs([])).toMatchObject({ execute: false, resume: false });
    expect(parseArgs(["--execute", "--expect", "5", "--target", "prod", "--prod-host", "ep-a.neon.tech"])).toMatchObject({ execute: true, expect: 5, target: "prod" });
  });

  it("branch must not be the production host, prod must be it", () => {
    expect(checkTarget("branch", "ep-branch.neon.tech", "ep-main.neon.tech")).toBeNull();
    expect(checkTarget("branch", "ep-main.neon.tech", "ep-main.neon.tech")).toMatch(/production host/);
    expect(checkTarget("prod", "ep-main.neon.tech", "ep-main.neon.tech")).toBeNull();
    expect(checkTarget("prod", "ep-branch.neon.tech", "ep-main.neon.tech")).toMatch(/not the production host/);
  });
});

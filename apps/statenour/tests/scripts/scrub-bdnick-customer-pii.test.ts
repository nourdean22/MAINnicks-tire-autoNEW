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
import { spawnSync } from "node:child_process";
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

  it("stripSyncCustomerPii is idempotent: the script relies on it to leave an already-stripped row unchanged", () => {
    const once = stripSyncCustomerPii(structuredClone(RAW_SYNC));
    expect(stripSyncCustomerPii(structuredClone(once))).toEqual(once);
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

describe("vector_embeddings of scrubbed memories · the copy the recall index keeps", () => {
  const vb = () => bucket("vectors_of_scrubbed_memories");
  const LEAD_OLD = "[insight] lead_source_website_2026-09-01: New lead from website: Jane Roe — brake job";

  it("content follows the memory: a vector the backfill cannot rebuild gets the scrubbed memory text", () => {
    // reembedEligible null = the memory is gone (orphan); false = soft-deleted or below the backfill's confidence floor.
    for (const reembedEligible of [null, false]) {
      const row = { id: "v1", sourceId: "i1", content: LEAD_OLD, reembedEligible };
      expect(vb().deleteWhen?.(row)).toBe(false);
      expect(vb().transform(row).content).toBe("[insight] lead_source_website_2026-09-01: New lead from website — brake job");
    }
    const colonKey = { id: "v5", sourceId: "i5", content: "[insight] lead_source_google:ads_2026-09-01: New lead from google:ads: Jane Roe — tires", reembedEligible: null };
    expect(vb().transform(colonKey).content).toBe("[insight] lead_source_google:ads_2026-09-01: New lead from google:ads — tires");
    // Codex 4330608654: a lead source holding ": " is copied into the key, so the first ": " is not the delimiter.
    const spaceKey = { id: "v6", sourceId: "i6", content: "[insight] lead_source_Google: Ads_2026-09-01: New lead from Google: Ads: Jane Roe — tires", reembedEligible: null };
    expect(vb().transform(spaceKey).content).toBe("[insight] lead_source_Google: Ads_2026-09-01: New lead from Google: Ads — tires");
    // A source that itself reads like a memory prefix still splits at the key's date, not at the first match.
    const trickKey = { id: "v7", sourceId: "i7", content: "[insight] lead_source_x: New lead from y_2026-09-01: New lead from x: New lead from y: Jane Roe — tires", reembedEligible: null };
    expect(vb().transform(trickKey).content).toBe("[insight] lead_source_x: New lead from y_2026-09-01: New lead from x: New lead from y — tires");
    const shop = { id: "v2", sourceId: "gone", content: '[business_event] shop_lead_1: Shop lead: {"customerName":"Jane Roe","phone":"2165551234","service":"brakes"}', reembedEligible: null };
    expect(vb().transform(shop).content).toBe('[business_event] shop_lead_1: Shop lead: {"service":"brakes"}');
  });

  it("the re-embed trigger is set: a vector of a live memory the backfill re-embeds is deleted, not rewritten", () => {
    // Rewriting content to the new text would satisfy storeGenericEmbedding's identical-content gate and the
    // stale lane's strpos check, so the PII-derived vector would never be rebuilt. A missing row is re-embedded.
    const row = { id: "v3", sourceId: "i1", content: LEAD_OLD, reembedEligible: true };
    expect(changedColumns(vb(), row)).toEqual(["content"]);
    expect(vb().deleteWhen?.(row)).toBe(true);
    const backfill = readFileSync(new URL("../../app/api/cron/embed-backfill/route.ts", import.meta.url), "utf8");
    expect(backfill).toMatch(/WHERE bm\.deleted_at IS NULL\s+AND bm\.confidence >= 0\.2[\s\S]*?AND NOT EXISTS \(\s*SELECT 1 FROM vector_embeddings v\s+WHERE v\."sourceType" = 'brain_memory' AND v\."sourceId" = bm\.id/);
    expect(backfill).toContain("storeGenericEmbedding(\"brain_memory\", m.id, `[${m.category}] ${m.key}: ${m.content}`)");
    const writer = readFileSync(new URL("../../lib/brain/embedding-utils.ts", import.meta.url), "utf8");
    expect(writer).toContain("if (existing && existing.content === content) {");
    // Deleted only when the backfill's own missing-row lane will pick the memory up.
    expect(vb().read.join(" ")).toContain("bm.deleted_at IS NULL AND bm.confidence >= 0.2");
  });

  it("vectors are written last, after their memories are scrubbed, so a rebuild never reads the old text", () => {
    expect(BUCKETS[BUCKETS.length - 1].name).toBe("vectors_of_scrubbed_memories");
  });

  it("an embedding whose memory did not change is left alone", () => {
    for (const content of [
      "[insight] call_completed_9: Phone call ended. Duration: 5s. Reason: x. Mentioned: none.",
      "[insight] lead_source_website_2026-09-01: New lead from website — brake job",
      "[insight] booking_hour_9: Booking received at 9:00 — brakes",
      "not the [category] key: shape at all",
    ]) {
      const row = { id: "v4", sourceId: "i9", content, reembedEligible: true };
      expect(changedColumns(vb(), row), content).toEqual([]);
    }
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
    vectors_of_scrubbed_memories: [
      { id: "v1", sourceId: "i1", content: "[insight] lead_source_website_2026-09-01: New lead from website: Jane Roe — brakes", reembedEligible: true },
      { id: "v2", sourceId: "gone", content: '[business_event] shop_lead_1: Shop lead: {"customerName":"Jane Roe","service":"brakes"}', reembedEligible: null },
      { id: "v3", sourceId: "i2", content: "[insight] call_completed_9: Phone call ended. Duration: 5s. Reason: x. Mentioned: none.", reembedEligible: true },
    ],
  };
}

function memoryDb(opts: { existingBackups?: string[]; backupShortBy?: number } = {}) {
  const data = fixtures();
  const backups = new Map<string, Set<string>>((opts.existingBackups ?? []).map((t) => [t, new Set()]));
  const calls = { createBackups: 0, writeRow: 0 };
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
    async createBackups(specs: Array<{ table: TableSpec; where: string }>) {
      calls.createBackups++;
      const counts: Record<string, { backedUp: number; inScope: number }> = {};
      for (const [i, { table: t }] of specs.entries()) {
        const rows = BUCKETS.filter((b) => b.table.name === t.name).flatMap((b) => data[b.name]);
        counts[t.name] = { backedUp: rows.length - (i === 0 ? opts.backupShortBy ?? 0 : 0), inScope: rows.length };
      }
      if (Object.values(counts).some((c) => c.backedUp !== c.inScope)) throw new Error("backup count differs from scope; rolled back");
      for (const { table: t } of specs) {
        const rows = BUCKETS.filter((b) => b.table.name === t.name).flatMap((b) => data[b.name]);
        backups.set(t.name, new Set(rows.map((r) => r.id)));
      }
      return counts;
    },
    async writeRow(b, row, next, del) {
      calls.writeRow++;
      const list = data[b.name];
      const i = list.findIndex((r) => r.id === row.id);
      if (i < 0) return false;
      if (del) list.splice(i, 1);
      else Object.assign(list[i], structuredClone(next));
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
    expect(s.totalToChange).toBe(7);
    expect(s.buckets.audit_business_metrics_sync).toMatchObject({ inScope: 2, toChange: 1 });
  });

  it("an --expect mismatch aborts before any backup or write", async () => {
    const { db, calls } = memoryDb();
    const s = await run(db, { execute: true, expect: 6, resume: false, ...quiet });
    expect(s.aborted).toMatch(/expect/);
    expect(calls).toEqual({ createBackups: 0, writeRow: 0 });
  });

  it("an existing backup table is refused before any backup or write", async () => {
    const { db, calls } = memoryDb({ existingBackups: [TABLES.memories.name] });
    const s = await run(db, { execute: true, expect: 7, resume: false, ...quiet });
    expect(s.aborted).toMatch(/already exists/);
    expect(calls).toEqual({ createBackups: 0, writeRow: 0 });
  });

  it("a backup count that differs from the scope count aborts before any write", async () => {
    const { db, calls } = memoryDb({ backupShortBy: 1 });
    const s = await run(db, { execute: true, expect: 7, resume: false, ...quiet });
    expect(s.aborted).toMatch(/backup/);
    expect(calls.writeRow).toBe(0);
  });

  it("execute writes exactly the expected rows; a second run finds 0 to change and a --resume writes nothing", async () => {
    const { db, calls, data } = memoryDb();
    const first = await run(db, { execute: true, expect: 7, resume: false, ...quiet });
    expect(first.aborted).toBeUndefined();
    expect(first.written).toBe(7);
    expectNoPii(data);
    // v1 (live memory) deleted for the backfill to re-embed, v2 (orphan) rewritten, v3 (unchanged) untouched.
    expect(first.buckets.vectors_of_scrubbed_memories).toMatchObject({ toChange: 2, toDelete: 1, written: 2 });
    expect(data.vectors_of_scrubbed_memories.map((r) => r.id)).toEqual(["v2", "v3"]);
    expect(data.vectors_of_scrubbed_memories[1].content).toBe("[insight] call_completed_9: Phone call ended. Duration: 5s. Reason: x. Mentioned: none.");
    const again = await run(db, { execute: false, resume: false, ...quiet });
    expect(again.totalToChange).toBe(0);
    const resumed = await run(db, { execute: true, expect: 0, resume: true, ...quiet });
    expect(resumed.aborted).toBeUndefined();
    expect(resumed.written).toBe(0);
    expect(calls.writeRow).toBe(7);
  });

  it("--resume without a backup table is refused", async () => {
    const { db, calls } = memoryDb();
    const s = await run(db, { execute: true, expect: 7, resume: true, ...quiet });
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
      // Anchored on the whole SELECT prefix: the vector bucket's SQL embeds the memory predicates.
      const b = BUCKETS.find((x) => sql.startsWith(`SELECT ${x.read.join(", ")} FROM ${x.table.name} WHERE (${x.where})`));
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
    expect(s.totalToChange).toBe(7);
    expect(queryRawUnsafe).toHaveBeenCalled();
    for (const fn of [client.$executeRawUnsafe, client.$executeRaw, client.$transaction]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("the adapter refuses a read it cannot judge", () => {
  it("a jsonb column that comes back as text throws instead of counting 0 to change", async () => {
    const client = { $queryRawUnsafe: vi.fn(async () => [{ id: "a1", eventType: "business_metrics_sync", payload: '{"customerName":"Jane Roe"}' }]) };
    await expect(prismaScrubDb(client).readBatch(bucket("audit_business_metrics_sync"), "", 500, false)).rejects.toThrow(/came back as text/);
  });
});

describe("the adapter's writes are compare-and-swap on the value read", () => {
  it("a vector rebuild is a guarded DELETE; a payload change is a guarded UPDATE that keeps updatedAt", async () => {
    const exec = vi.fn(async () => 1);
    const db = prismaScrubDb({ $executeRawUnsafe: exec });
    const vrow = { id: "v1", sourceId: "i1", content: "[insight] k: old", reembedEligible: true };
    expect(await db.writeRow(bucket("vectors_of_scrubbed_memories"), vrow, { content: "[insight] k: new" }, true)).toBe(true);
    expect(exec).toHaveBeenLastCalledWith("DELETE FROM vector_embeddings WHERE id = $1 AND content IS NOT DISTINCT FROM $2", "v1", "[insight] k: old");
    const arow = { id: "a1", eventType: "nickstire:lead", actor: "nickstire", detail: "d", payload: { a: 1 } };
    await db.writeRow(bucket("audit_nickstire_events"), arow, { payload: { b: 2 }, detail: "d" }, false);
    expect(exec).toHaveBeenLastCalledWith(
      'UPDATE "AuditEvent" SET payload = $4::jsonb, detail = $5 WHERE id = $1 AND payload IS NOT DISTINCT FROM $2::jsonb AND detail IS NOT DISTINCT FROM $3',
      "a1", '{"a":1}', "d", '{"b":2}', "d",
    );
    exec.mockResolvedValueOnce(0);
    expect(await db.writeRow(bucket("vectors_of_scrubbed_memories"), vrow, {}, true)).toBe(false);
  });
});

describe("arguments and target check · production is named by the repo, never by the invocation", () => {
  // The production endpoint as already published on main (docs/CLOUD-ENVIRONMENT.md, the 2026-08-27 census).
  const PROD_POOLED = "ep-quiet-wave-am320eo1-pooler.c-5.us-east-1.aws.neon.tech";
  const PROD_URL = `postgresql://neondb_owner:pw@${PROD_POOLED}/neondb?sslmode=require`;
  const BRANCH_HOST = "ep-cold-moon-a1b2c3d4-pooler.c-5.us-east-1.aws.neon.tech";
  const BRANCH_URL = `postgresql://neondb_owner:pw@${BRANCH_HOST}/neondb?sslmode=require`;

  it("--execute needs --expect, --target and --db-host", () => {
    expect(() => parseArgs(["--execute"])).toThrow(/--expect/);
    expect(() => parseArgs(["--execute", "--expect", "5"])).toThrow(/--target/);
    expect(() => parseArgs(["--execute", "--expect", "5", "--target", "branch"])).toThrow(/--db-host/);
    // The retired flag no longer satisfies the gate: an old command line fails closed.
    expect(() => parseArgs(["--execute", "--expect", "5", "--target", "branch", "--prod-host", PROD_POOLED])).toThrow(/--db-host/);
    expect(parseArgs([])).toMatchObject({ execute: false, resume: false });
    expect(parseArgs(["--execute", "--expect", "5", "--target", "prod", "--db-host", PROD_POOLED])).toMatchObject({ execute: true, expect: 5, target: "prod", dbHost: PROD_POOLED });
  });

  it("CODEX SCENARIO: production DATABASE_URL, a typo in the operator's host, --target branch is refused", () => {
    expect(checkTarget("branch", PROD_URL, "ep-quiet-wave-am320eo2-pooler.c-5.us-east-1.aws.neon.tech")).toMatch(/production endpoint/);
    // Even when the operator names the branch they meant: the URL decides, and it is production.
    expect(checkTarget("branch", PROD_URL, BRANCH_HOST)).toMatch(/production endpoint/);
  });

  it("a branch run on the production endpoint is refused however the host is spelled", () => {
    expect(checkTarget("branch", PROD_URL, PROD_POOLED)).toMatch(/production endpoint/);
    for (const host of [
      PROD_POOLED.toUpperCase(),
      `${PROD_POOLED}.`,
      `${PROD_POOLED}:5432`,
      "ep-quiet-wave-am320eo1.c-5.us-east-1.aws.neon.tech", // direct (unpooled) host, same compute
    ]) {
      expect(checkTarget("branch", `postgresql://u:p@ss#?@${host}/neondb`, host), host).toMatch(/production endpoint/);
    }
    // An "@" in a query value moves the parsed host to the branch; the URL still names production.
    expect(checkTarget("branch", `${PROD_URL}&application_name=x@${BRANCH_HOST}`, BRANCH_HOST)).toMatch(/production endpoint/);
  });

  it("a prod run must be the production endpoint; a branch URL with --target prod is refused", () => {
    expect(checkTarget("prod", BRANCH_URL, BRANCH_HOST)).toMatch(/not the production endpoint/);
    expect(checkTarget("prod", "postgresql://u:p@localhost:5432/db", "localhost")).toMatch(/not the production endpoint/);
  });

  it("a missing or mismatched --db-host, or an unreadable DATABASE_URL, is refused", () => {
    expect(checkTarget("branch", BRANCH_URL, "")).toMatch(/--db-host/);
    expect(checkTarget("branch", BRANCH_URL, "ep-other-a9.c-5.us-east-1.aws.neon.tech")).toMatch(/--db-host/);
    expect(checkTarget("branch", "not a url", BRANCH_HOST)).toMatch(/cannot be read/);
  });

  it("POSITIVE CONTROL: the legitimate runs still pass (a guard that refuses everything scores the same above)", () => {
    expect(checkTarget("branch", BRANCH_URL, BRANCH_HOST)).toBeNull();
    expect(checkTarget("branch", BRANCH_URL, `${BRANCH_HOST.toUpperCase()}.`)).toBeNull();
    expect(checkTarget("prod", PROD_URL, PROD_POOLED)).toBeNull();
    // Pooled and direct hosts are the same compute, so either spelling names it.
    expect(checkTarget("prod", PROD_URL, "ep-quiet-wave-am320eo1.c-5.us-east-1.aws.neon.tech")).toBeNull();
  });
});

describe("the real script refuses before it loads Prisma (no database: the host is under the .invalid TLD)", () => {
  const runScript = (databaseUrl: string, args: string) => {
    const child = spawnSync(`pnpm exec tsx scripts/scrub-bdnick-customer-pii.ts ${args}`, {
      cwd: process.cwd(),
      shell: true,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    return { status: child.status, output: `${child.stdout ?? ""}${child.stderr ?? ""}` };
  };
  // First DNS label is the production endpoint id; the reserved TLD means even a dead guard reaches nothing.
  const PROD_LIKE = "postgresql://u:p@ep-quiet-wave-am320eo1-pooler.invalid/neondb";

  it(
    "--target branch on the production endpoint exits 1 with the refusal and never starts counting",
    () => {
      const { status, output } = runScript(PROD_LIKE, "--execute --expect 0 --target branch --db-host ep-quiet-wave-am320eo2-pooler.invalid");
      expect(output).toMatch(/--target branch but DATABASE_URL is the production endpoint/);
      expect(status).toBe(1);
      expect(output).not.toMatch(/ENOTFOUND|getaddrinfo|Can't reach database|TOTAL rows/i);
    },
    150_000,
  );
});

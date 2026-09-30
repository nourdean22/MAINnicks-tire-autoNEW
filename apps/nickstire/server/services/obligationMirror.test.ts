/**
 * Q-22 phase 1 · obligation mirror (ADR-0020 §4-§6).
 *
 * Pins: due times are derived from shop hours and refused when underivable;
 * a row closes only on an outcome; flag OFF touches no table; flag ON writes
 * one row per open source item, skips a callback its voice promise covers,
 * treats a duplicate-key rejection as someone else's row, closes by
 * compare-and-swap, and reports parity instead of a healthy zero.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  getDb: vi.fn<() => Promise<any>>(),
  execute: vi.fn(),
}));

vi.mock("./featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../db", () => ({ getDb: h.getDb }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import {
  closeCallback,
  closeEmergency,
  closeOwedReply,
  mapCallback,
  mapOwedReply,
  responseDueAt,
  runObligationMirror,
  voiceCallIdFromContext,
  type CallbackSource,
} from "./obligationMirror";

const TZ = "America/New_York";
// Mon-Fri 08:00-18:00, Saturday 08:00-15:00, Sunday closed.
const HOURS: Record<string, string> = {
  monday: "08:00-18:00", tuesday: "08:00-18:00", wednesday: "08:00-18:00",
  thursday: "08:00-18:00", friday: "08:00-18:00", saturday: "08:00-15:00",
};
const H = { timezone: TZ, hours: HOURS };
const TWO_H = 2 * 3_600_000;

describe("responseDueAt", () => {
  it("created while open: createdAt + window", () => {
    // Tue 2026-09-29 10:00 EDT = 14:00Z
    expect(responseDueAt(new Date("2026-09-29T14:00:00Z"), TWO_H, TZ, HOURS)?.toISOString()).toBe("2026-09-29T16:00:00.000Z");
  });

  it("created while open near close: capped at that day's close", () => {
    // Tue 17:30 EDT = 21:30Z; close 18:00 EDT = 22:00Z
    expect(responseDueAt(new Date("2026-09-29T21:30:00Z"), TWO_H, TZ, HOURS)?.toISOString()).toBe("2026-09-29T22:00:00.000Z");
  });

  it("created after close: next opening + window", () => {
    // Tue 20:00 EDT -> Wed 08:00 EDT (12:00Z) + 2h
    expect(responseDueAt(new Date("2026-09-30T00:00:00Z"), TWO_H, TZ, HOURS)?.toISOString()).toBe("2026-09-30T14:00:00.000Z");
  });

  it("created on a closed day: the next day with hours", () => {
    // Sun 2026-09-27 12:00 EDT -> Mon 08:00 EDT + 30 min
    expect(responseDueAt(new Date("2026-09-27T16:00:00Z"), 30 * 60_000, TZ, HOURS)?.toISOString()).toBe("2026-09-28T12:30:00.000Z");
  });

  it("no configured hours: null, never an invented deadline", () => {
    expect(responseDueAt(new Date("2026-09-29T14:00:00Z"), TWO_H, TZ, {})).toBeNull();
  });
});

describe("voiceCallIdFromContext", () => {
  it("reads both voice writers' formats (routers/voiceAgent.ts)", () => {
    expect(voiceCallIdFromContext("[VOICE-AGENT · HIGH] callId=call_abc — wants a quote")).toBe("call_abc");
    expect(voiceCallIdFromContext("[VOICE-AGENT CALLBACK] callId=9f1e-22 · prefers: after 3")).toBe("9f1e-22");
  });

  it("no call id, or not a voice row: null", () => {
    expect(voiceCallIdFromContext("[VOICE-AGENT CALLBACK] · prefers: morning")).toBeNull();
    expect(voiceCallIdFromContext("brakes grinding callId=x")).toBeNull();
    expect(voiceCallIdFromContext(null)).toBeNull();
  });
});

const cb = (over: Partial<CallbackSource> = {}): CallbackSource => ({
  id: 41, name: "Ann", phone: "2165550142", context: "brakes", status: "new",
  calledAt: null, calledBy: null, notes: null, createdAt: new Date("2026-09-29T14:00:00Z"), ...over,
});

describe("mappers", () => {
  it("a callback becomes one keyed callback row", () => {
    expect(mapCallback(cb(), H)).toMatchObject({
      sourceKind: "callback_request", sourceId: "41", promiseType: "callback",
      promisedAction: "Call Ann back about: brakes", dueAt: new Date("2026-09-29T16:00:00Z"),
    });
    expect(mapCallback(cb(), { timezone: TZ, hours: {} })).toBeNull();
  });

  it("an owed text keeps the job's own SLA clock", () => {
    const due = new Date("2026-09-29T14:30:00Z");
    expect(mapOwedReply({ id: 7, customerPhone: "2165550142", body: "  do you\n have 225/65R17? ", status: "human_pending", dueAt: due, createdAt: new Date("2026-09-29T14:00:00Z") }))
      .toMatchObject({ sourceKind: "owed_reply", sourceId: "7", promiseType: "reply", dueAt: due, promisedAction: 'Reply to the customer\'s text: "do you have 225/65R17?"' });
  });
});

describe("closers: outcome, never attempt", () => {
  it("callback called/completed -> kept with who and when", () => {
    expect(closeCallback(cb({ status: "called", calledBy: "Sam", calledAt: new Date("2026-09-29T15:04:00Z") })))
      .toEqual({ to: "kept", evidence: "callback #41 called by Sam at 2026-09-29 15:04Z" });
    expect(closeCallback(cb({ status: "completed" }))?.to).toBe("kept");
  });

  it("a person's no-answer stays open; hygiene's stale close cancels", () => {
    expect(closeCallback(cb({ status: "no-answer", notes: "left voicemail" }))).toBeNull();
    expect(closeCallback(cb({ status: "no-answer", notes: "[SYSTEM: Closed as stale]" }))).toEqual({ to: "cancelled", evidence: "closed as stale by hygiene" });
    expect(closeCallback(cb())).toBeNull();
  });

  it("owed text: replied -> kept, no reply needed -> cancelled, failed send stays open", () => {
    const base = { id: 7, customerPhone: "x", body: "", dueAt: new Date(), createdAt: new Date() };
    expect(closeOwedReply({ ...base, status: "human_replied" })?.to).toBe("kept");
    expect(closeOwedReply({ ...base, status: "no_reply_required" })?.to).toBe("cancelled");
    for (const status of ["human_pending", "failed", "dead"]) expect(closeOwedReply({ ...base, status })).toBeNull();
  });

  it("a vanished source row cancels; an emergency has no close path yet", () => {
    expect(closeCallback(undefined)?.to).toBe("cancelled");
    expect(closeOwedReply(undefined)?.to).toBe("cancelled");
    expect(closeEmergency(undefined)?.to).toBe("cancelled");
    expect(closeEmergency({ id: 1, name: "B", phone: "1", problem: null, status: "new", createdAt: new Date() })).toBeNull();
  });
});

// ─── the reconciler, against a SQL-routing fake ──────────────────────────────

/** SQL text (params as ?) and bound params of a drizzle sql`` object. */
function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

interface Fake {
  callbacks: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  ledger: Array<{ id: string; source_kind: string; source_id: string; promise_type: string; status: string; kept_evidence?: string }>;
  dupOnInsert?: Set<string>;
}

function fakeDb(f: Fake) {
  const writes: Array<{ text: string; params: unknown[] }> = [];
  h.execute.mockImplementation(async (q: { queryChunks: unknown[] }) => {
    const { text, params } = flat(q);
    const inIds = () => params.map(String);
    if (text.startsWith("SELECT COUNT(*) AS n FROM callback_requests WHERE status = 'new' AND createdAt >=")) return [[{ n: f.callbacks.filter((c) => c.status === "new").length }]];
    if (text.startsWith("SELECT COUNT(*) AS n FROM sms_response_jobs WHERE status = 'human_pending' AND createdAt >=")) return [[{ n: f.jobs.filter((j) => j.status === "human_pending").length }]];
    if (text.startsWith("SELECT COUNT(*) AS n FROM")) return [[{ n: 0 }]];
    if (text.includes("FROM callback_requests WHERE status = 'new'")) return [f.callbacks.filter((c) => c.status === "new")];
    if (text.includes("FROM callback_requests WHERE id IN")) return [f.callbacks.filter((c) => inIds().includes(String(c.id)))];
    if (text.includes("FROM sms_response_jobs WHERE status = 'human_pending'")) return [f.jobs.filter((j) => j.status === "human_pending")];
    if (text.includes("FROM sms_response_jobs WHERE id IN")) return [f.jobs.filter((j) => inIds().includes(String(j.id)))];
    if (text.includes("FROM emergency_requests")) return [[]];
    if (text.includes("WHERE source_kind = 'voice'")) return [f.ledger.filter((l) => l.source_kind === "voice" && params.map(String).includes(l.source_id))];
    if (text.startsWith("SELECT source_id, status FROM customer_promises")) {
      const [kind, type, ...ids] = params.map(String);
      return [f.ledger.filter((l) => l.source_kind === kind && l.promise_type === type && ids.includes(l.source_id))];
    }
    if (text.startsWith("SELECT id, source_id FROM customer_promises")) {
      const kind = String(params[0]);
      return [f.ledger.filter((l) => l.source_kind === kind && l.status === "open")];
    }
    if (text.startsWith("INSERT INTO customer_promises")) {
      writes.push({ text, params });
      const [id, promise_type, , , source_kind, source_id] = params.map(String);
      if (f.dupOnInsert?.has(source_id)) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
      f.ledger.push({ id, promise_type, source_kind, source_id, status: "open" });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE customer_promises")) {
      writes.push({ text, params });
      const to = String(params[0]);
      const evidence = String(params[params.length - 2]);
      const row = f.ledger.find((l) => l.id === String(params[params.length - 1]) && l.status === "open");
      if (!row) return [{ affectedRows: 0 }];
      row.status = to;
      row.kept_evidence = evidence;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unrouted SQL: ${text}`);
  });
  return writes;
}

const NOW = new Date("2026-09-29T16:00:00Z");
const created = "2026-09-29T14:00:00Z";

describe("runObligationMirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getDb.mockResolvedValue({ execute: h.execute });
  });

  it("flag OFF: no table is read or written", async () => {
    h.isEnabled.mockResolvedValue(false);
    const r = await runObligationMirror(NOW);
    expect(h.isEnabled).toHaveBeenCalledWith("obligation_mirror_enabled");
    expect(h.getDb).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(r).toEqual({ recordsProcessed: 0, details: "disabled (obligation_mirror_enabled is OFF)" });
  });

  it("flag ON: mirrors open items once, skips voice-covered, closes on outcome, reports parity", async () => {
    h.isEnabled.mockResolvedValue(true);
    const f: Fake = {
      callbacks: [
        { id: 1, name: "Ann", phone: "2165550101", context: "brakes", status: "new", createdAt: created },
        { id: 2, name: "Bo", phone: "2165550102", context: "[VOICE-AGENT CALLBACK] callId=call_9 · prefers: noon", status: "new", createdAt: created },
        { id: 3, name: "Cy", phone: "2165550103", context: null, status: "called", calledBy: "Sam", calledAt: "2026-09-29T15:00:00Z", createdAt: created },
        { id: 4, name: "Di", phone: "2165550104", context: null, status: "no-answer", notes: "left voicemail", createdAt: created },
      ],
      jobs: [
        { id: 70, customerPhone: "2165550170", body: "open?", status: "human_pending", dueAt: "2026-09-29T14:30:00Z", createdAt: created },
        { id: 71, customerPhone: "2165550171", body: "thanks", status: "human_replied", dueAt: "2026-09-29T14:30:00Z", createdAt: created },
      ],
      ledger: [
        { id: "v", source_kind: "voice", source_id: "call_9", promise_type: "callback", status: "open" },
        { id: "L3", source_kind: "callback_request", source_id: "3", promise_type: "callback", status: "open" },
        { id: "L4", source_kind: "callback_request", source_id: "4", promise_type: "callback", status: "open" },
        { id: "L71", source_kind: "owed_reply", source_id: "71", promise_type: "reply", status: "open" },
      ],
    };
    const writes = fakeDb(f);

    const r = await runObligationMirror(NOW);

    const inserted = writes.filter((w) => w.text.startsWith("INSERT")).map((w) => `${w.params[4]}:${w.params[5]}`);
    expect(inserted).toEqual(["callback_request:1", "owed_reply:70"]);
    expect(f.ledger.find((l) => l.source_id === "3")).toMatchObject({ status: "kept", kept_evidence: "callback #3 called by Sam at 2026-09-29 15:00Z" });
    expect(f.ledger.find((l) => l.source_id === "4")?.status).toBe("open");
    expect(f.ledger.find((l) => l.source_id === "71")?.status).toBe("kept");
    // Every close is a compare-and-swap on the open row.
    for (const w of writes.filter((x) => x.text.startsWith("UPDATE"))) expect(w.text).toContain("AND status = 'open'");
    expect(r.recordsProcessed).toBe(4);
    expect(r.details).toContain("callback_request: 2 open · +1 mirrored · 0 already · 0 undatable · 1 voice-covered");
    expect(r.details).toContain("closed 1 kept/0 cancelled · parity mismatch 0");
    expect(r.details).toContain("owed_reply: 1 open · +1 mirrored");

    // A second run writes nothing new: idempotent.
    writes.length = 0;
    const again = await runObligationMirror(NOW);
    expect(writes).toEqual([]);
    expect(again.recordsProcessed).toBe(0);
    expect(again.details).toContain("callback_request: 2 open · +0 mirrored · 1 already");
  });

  it("a duplicate-key rejection is a concurrent run's row, reported as a mismatch, never thrown", async () => {
    h.isEnabled.mockResolvedValue(true);
    fakeDb({
      callbacks: [{ id: 5, name: "Ed", phone: "2165550105", context: null, status: "new", createdAt: created }],
      jobs: [],
      ledger: [],
      dupOnInsert: new Set(["5"]),
    });
    const r = await runObligationMirror(NOW);
    expect(r.details).toContain("callback_request: 1 open · +0 mirrored · 1 already");
    expect(r.details).toContain("parity mismatch 1");
  });

  it("a reopened source whose ledger row already closed is a parity mismatch, not a healthy zero", async () => {
    h.isEnabled.mockResolvedValue(true);
    fakeDb({
      callbacks: [{ id: 6, name: "Fa", phone: "2165550106", context: null, status: "new", createdAt: created }],
      jobs: [],
      ledger: [{ id: "L6", source_kind: "callback_request", source_id: "6", promise_type: "callback", status: "kept" }],
    });
    const r = await runObligationMirror(NOW);
    expect(r.details).toContain("callback_request: 1 open · +0 mirrored · 1 already");
    expect(r.details).toContain("parity mismatch 1");
  });

  it("an insert failure that is NOT a duplicate key propagates instead of counting as mirrored", async () => {
    h.isEnabled.mockResolvedValue(true);
    fakeDb({
      callbacks: [{ id: 8, name: "Gu", phone: "2165550108", context: null, status: "new", createdAt: created }],
      jobs: [],
      ledger: [],
    });
    const route = h.execute.getMockImplementation()!;
    h.execute.mockImplementation(async (q: { queryChunks: unknown[] }) => {
      if (flat(q).text.startsWith("INSERT")) throw Object.assign(new Error("Data too long for column"), { code: "ER_DATA_TOO_LONG", errno: 1406 });
      return route(q);
    });
    await expect(runObligationMirror(NOW)).rejects.toThrow("Data too long");
  });

  it("a failed source read throws (cron_log records a failure, not a zero)", async () => {
    h.isEnabled.mockResolvedValue(true);
    h.execute.mockRejectedValue(new Error("connection lost"));
    await expect(runObligationMirror(NOW)).rejects.toThrow("connection lost");
  });
});

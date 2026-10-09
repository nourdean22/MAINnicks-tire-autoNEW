/**
 * Missed-call closure semantics (2026-10-02).
 *
 * Pre-fix: one missed_call opportunity per CALL (a customer who redialed 3x
 * was 3 cards), and the only exit was the 7-day age-out to `lost` — a customer
 * who called back, booked, or paid an invoice still read as a lost sale.
 *
 * Pinned here:
 *   - pure deciders: served-by-callback, served-by-invoice → won route,
 *     same-phone collapse keeps the newest, evidence at/before the call does
 *     NOT close, a different phone does NOT close, worked rows are not
 *     relabelled `duplicate`;
 *   - reconcile wiring: the served step runs BEFORE the age-out, wins go
 *     through recordOutcome (UPDATE … state = 'won' + outcome_invoice_id),
 *     served/collapse closes are CAS transitions whose receipt names the
 *     exact evidence row, and no source table is ever mutated;
 *   - collector: the NEWEST call for a phone gets the card; the phone's older
 *     un-worked live card collapses into it (a worked card is left alone).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decideMissedCallServed,
  missedCallServedNote,
  servedCloseState,
  planMissedCallCollapse,
  phone10,
  type MissedCallServedEvidence,
} from "./services/opportunityQueue";

// ─── DB mock (reconcile + collector wiring) ─────────────────────────

let captured: string[] = [];
let oppRows: Record<string, Record<string, unknown>> = {};
let liveMissed: Array<Record<string, unknown>> = [];
let callTimes: Array<Record<string, unknown>> = [];
let callbackRows: Array<Record<string, unknown>> = [];
let invoiceEvidenceRows: Array<Record<string, unknown>> = [];
let invoiceById: Record<number, Record<string, unknown>> = {};
let vapiSelectRows: Array<Record<string, unknown>> = [];
let livePhoneRows: Array<Record<string, unknown>> = [];
let inserts: string[] = [];
/** When true, the upsert reports an existing row (ON DUPLICATE KEY -> affectedRows 2 = "refreshed"). */
let refreshNext = false;

const flat = (q: unknown) => JSON.stringify(q).replace(/\\n/g, " ").replace(/\s+/g, " ");

const fakeDb = {
  execute: async (q: unknown) => {
    const text = flat(q);
    captured.push(text);
    if (text.includes("SELECT * FROM revenue_opportunities WHERE id =")) {
      const hit = Object.keys(oppRows).find((id) => text.includes(`"${id}"`));
      return [hit ? [oppRows[hit]] : []];
    }
    if (text.includes("UPDATE revenue_opportunities")) return [{ affectedRows: 1 }];
    if (text.includes("INSERT INTO revenue_opportunities")) {
      inserts.push(text);
      return [{ affectedRows: refreshNext ? 2 : 1 }];
    }
    if (text.includes("SELECT id, source_id, state, customer_phone FROM revenue_opportunities")) return [livePhoneRows];
    if (text.includes("source_type = 'missed_call'") && text.includes("ORDER BY created_at DESC")) return [liveMissed];
    if (text.includes("SELECT vapiCallId,") && text.includes("FROM vapi_call_logs")) return [callTimes];
    if (text.includes("FROM callback_requests") && !text.includes("JOIN")) return [callbackRows];
    if (text.includes("SELECT id, customerPhone, invoiceDate FROM invoices WHERE id =")) {
      const hit = Object.keys(invoiceById).find((id) => text.includes(`,${id},`) || text.includes(`[${id}`) || text.includes(`${id}]`));
      return [hit ? [invoiceById[Number(hit)]] : []];
    }
    if (text.includes("FROM invoices")) return [invoiceEvidenceRows];
    return [[]];
  },
  select: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.limit = async () => vapiSelectRows;
    return chain;
  },
};

vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  getDbTyped: async () => fakeDb,
}));

/** Capture evidence for tool-reaching calls; per-test, keyed by vapiCallId. */
let captureEvidence: Record<string, Record<string, unknown>> = {};
vi.mock("./services/vapiActionExtraction", () => ({
  loadCallCaptureEvidence: async (callId: string) => captureEvidence[callId] ?? {},
}));

beforeEach(() => {
  captured = [];
  oppRows = {};
  liveMissed = [];
  callTimes = [];
  callbackRows = [];
  invoiceEvidenceRows = [];
  invoiceById = {};
  vapiSelectRows = [];
  livePhoneRows = [];
  inserts = [];
  refreshNext = false;
  captureEvidence = {};
});

/** Shop-time SQL strings, exactly as DATE_FORMAT returns them. */
const CALL_AT = "2026-09-28 11:00:00";
const at = (day: string, time: string) => `${day} ${time}`;
const ev = (over: Partial<MissedCallServedEvidence>): MissedCallServedEvidence => ({
  source: "callback_requests",
  id: 123,
  phone: "(216) 555-0142",
  at: "2026-09-28 13:00:00",
  ...over,
});

// ─── Pure deciders ──────────────────────────────────────────────────

describe("decideMissedCallServed", () => {
  it("served by a LATER callback request for the same phone (any formatting)", () => {
    const d = decideMissedCallServed({ phone: "+12165550142", anchorAt: CALL_AT, evidence: [ev({})] });
    expect(d.invoice).toBeNull();
    expect(d.served?.source).toBe("callback_requests");
    expect(missedCallServedNote(d.served!)).toBe("served: callback_requests #123 at 2026-09-28 13:00:00 ET");
  });

  it("a PAID invoice on a LATER shop day routes to the won path, earliest first", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [
        ev({ source: "invoices", id: 902, at: at("2026-09-30", "12:00:00") }),
        ev({ source: "invoices", id: 901, at: at("2026-09-29", "12:00:00") }),
      ],
    });
    expect(d.invoice?.id).toBe(901);
    expect(d.served).toBeNull();
  });

  it("a same-shop-day invoice is served (closes), never a win — before or after the call is unknowable", () => {
    for (const time of ["08:00:00", "12:00:00", "18:00:00"]) {
      const d = decideMissedCallServed({
        phone: "2165550142",
        anchorAt: CALL_AT,
        evidence: [ev({ source: "invoices", id: 950, at: at("2026-09-28", time) })],
      });
      expect(d.invoice).toBeNull();
      expect(d.served?.id).toBe(950);
      expect(missedCallServedNote(d.served!)).toMatch(/not counted as won/);
    }
  });

  it("evidence BEFORE (or exactly at) the call does NOT close", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [
        ev({ at: "2026-09-28 10:00:00" }),
        ev({ source: "leads", at: CALL_AT }),
        ev({ source: "invoices", id: 900, at: at("2026-09-27", "12:00:00") }),
      ],
    });
    expect(d).toEqual({ invoice: null, served: null });
  });

  it("a malformed time (driver-parsed Date, ISO string, junk) is never evidence", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [
        ev({ at: "2026-09-29T12:00:00.000Z" }),
        ev({ at: new Date("2026-09-29T12:00:00Z") as unknown as string }),
        ev({ source: "invoices", at: "garbage" }),
      ],
    });
    expect(d).toEqual({ invoice: null, served: null });
    expect(decideMissedCallServed({ phone: "2165550142", anchorAt: "not a time", evidence: [ev({})] }))
      .toEqual({ invoice: null, served: null });
  });

  it("a different phone does NOT close; an unparseable phone never matches", () => {
    expect(decideMissedCallServed({ phone: "2165550142", anchorAt: CALL_AT, evidence: [ev({ phone: "2165550199" })] }))
      .toEqual({ invoice: null, served: null });
    expect(decideMissedCallServed({ phone: "555-0142", anchorAt: CALL_AT, evidence: [ev({ phone: "555-0142" })] }))
      .toEqual({ invoice: null, served: null });
  });

  it("captured follow-up call carries its lead/callback in the receipt", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [ev({ source: "vapi_call_logs", id: 77, detail: "lead #12" })],
    });
    expect(missedCallServedNote(d.served!)).toMatch(/^served: vapi_call_logs #77 at .+ ET \(lead #12\)$/);
  });
});

describe("servedCloseState", () => {
  it("duplicate ONLY for an untouched `new` card; assigned/worked cards are left to their owner (never 'lost')", () => {
    expect(servedCloseState("new")).toBe("duplicate");
    // An assigned card has an owner; a worked card is a RECOVERY in progress.
    expect(servedCloseState("assigned")).toBeNull();
    expect(servedCloseState("attempted")).toBeNull();
    expect(servedCloseState("contacted")).toBeNull();
  });
});

describe("planMissedCallCollapse", () => {
  const row = (id: string, phone: string | null, hour: number, state: "new" | "assigned" | "attempted" = "new") =>
    ({ id, phone, anchorAt: `2026-09-28 ${String(hour).padStart(2, "0")}:00:00`, state });

  it("keeps the NEWEST live row per phone; older ones collapse into it", () => {
    const plan = planMissedCallCollapse([
      row("old", "2165550142", 9),
      row("newest", "(216) 555-0142", 14),
      row("mid", "+1 216 555 0142", 11),
      row("other-person", "2165550199", 10),
    ]);
    expect(plan.collapse).toEqual(
      expect.arrayContaining([{ id: "old", keepId: "newest" }, { id: "mid", keepId: "newest" }]),
    );
    expect(plan.collapse).toHaveLength(2);
    expect(plan.skipped).toEqual([]);
  });

  it("never collapses a row anyone has touched (assigned or worked); never groups phoneless rows", () => {
    const plan = planMissedCallCollapse([
      row("worked", "2165550142", 9, "attempted"),
      row("assigned", "2165550142", 10, "assigned"),
      row("newest", "2165550142", 14),
      row("nophone-a", null, 9),
      row("nophone-b", null, 10),
    ]);
    expect(plan.collapse).toEqual([]);
    expect(plan.skipped.sort()).toEqual(["assigned", "worked"]);
  });

  it("is idempotent: a single live row per phone is a no-op", () => {
    expect(planMissedCallCollapse([row("only", "2165550142", 9)])).toEqual({ collapse: [], skipped: [] });
  });

  it("phone10 is the house last-10 rule", () => {
    expect(phone10("+1 (216) 555-0142")).toBe("2165550142");
    expect(phone10("5550142")).toBeNull();
    expect(phone10(null)).toBeNull();
  });
});

// ─── Reconcile wiring ───────────────────────────────────────────────

/** A live row. `createdEt` is shop time; the stored (`raw`) value is UTC = ET + 4h in September. */
function opp(id: string, phone: string, state = "new", createdEt = "2026-09-28 12:00:00") {
  const createdRaw = `${createdEt.slice(0, 11)}${String(Number(createdEt.slice(11, 13)) + 4).padStart(2, "0")}${createdEt.slice(13)}`;
  return {
    id, source_type: "missed_call", source_id: `call-${id}`, customer_phone: phone,
    state, receipts_json: "[]", consent_ok: 1, attempts: 0, data_quality: "verified",
    urgency: "today", recommended_action: "x", reason: "x",
    createdRaw, createdEt,
    created_at: `${createdRaw.replace(" ", "T")}Z`, updated_at: `${createdRaw.replace(" ", "T")}Z`,
  };
}
const callRow = (id: string, et: string) => ({
  vapiCallId: `call-${id}`,
  atEt: et,
  atRaw: `${et.slice(0, 11)}${String(Number(et.slice(11, 13)) + 4).padStart(2, "0")}${et.slice(13)}`,
});

describe("reconcileOpportunities · missed_call step 3a", () => {
  it("won via recordOutcome on a later-day paid invoice; served → duplicate naming the callback; then collapse; all before age-out", async () => {
    const won = opp("op-won", "2165550101");
    const served = opp("op-served", "2165550102");
    const dupOld = opp("op-dup-old", "2165550103");
    const dupNew = opp("op-dup-new", "2165550103", "new", "2026-09-28 17:00:00");
    const untouched = opp("op-quiet", "2165550104");
    const sameDay = opp("op-sameday", "2165550105");
    const assignedServed = opp("op-assigned", "2165550106", "assigned");
    for (const o of [won, served, dupOld, dupNew, untouched, sameDay, assignedServed]) oppRows[o.id] = o;
    liveMissed = [dupNew, won, served, dupOld, untouched, sameDay, assignedServed];
    callTimes = [
      callRow("op-won", CALL_AT),
      callRow("op-served", CALL_AT),
      callRow("op-dup-old", CALL_AT),
      callRow("op-dup-new", "2026-09-28 16:00:00"),
      callRow("op-quiet", CALL_AT),
      callRow("op-sameday", CALL_AT),
      callRow("op-assigned", CALL_AT),
    ];
    // callback came in 10 min after the call — BEFORE the queue row was born
    // (created 12:00 ET). Anchoring on the call time is what closes it.
    callbackRows = [
      { id: 555, phone: "216-555-0102", at: "2026-09-28 11:10:00" },
      { id: 556, phone: "2165550104", at: "2026-09-28 10:00:00" }, // before: no close
      { id: 557, phone: "2165550106", at: "2026-09-28 11:30:00" }, // served, but the card is assigned
    ];
    invoiceEvidenceRows = [
      { id: 4242, phone: "2165550101", at: "2026-09-29 08:00:00" },
      { id: 4343, phone: "2165550105", at: "2026-09-28 08:00:00" }, // same shop day
    ];
    invoiceById = { 4242: { id: 4242, customerPhone: "2165550101", invoiceDate: "2026-09-29T12:00:00.000Z" } };

    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    const stats = await reconcileOpportunities();

    expect(stats.won).toBe(1);
    const wonUpdate = captured.find((t) => t.includes("SET state = 'won'"));
    expect(wonUpdate).toContain("op-won");
    expect(wonUpdate).toContain("outcome_invoice_id");
    expect(captured.some((t) => t.includes("SET state = 'won'") && t.includes("op-sameday"))).toBe(false);

    const updates = captured.filter((t) => t.includes("UPDATE revenue_opportunities") && !t.includes("SET state = 'won'"));
    const servedUpd = updates.find((t) => t.includes("op-served"));
    expect(servedUpd).toContain('"duplicate"');
    expect(servedUpd).toContain("served: callback_requests #555 at 2026-09-28 11:10:00 ET");
    // CAS on the read state
    expect(servedUpd).toMatch(/WHERE id = .*AND state = /);

    const sameDayUpd = updates.find((t) => t.includes("op-sameday"));
    expect(sameDayUpd).toContain("served: invoices #4343");
    expect(sameDayUpd).toContain("not counted as won");

    expect(updates.some((t) => t.includes('"op-assigned"')), "an assigned card is never auto-closed").toBe(false);

    const collapseUpd = updates.find((t) => t.includes("op-dup-old"));
    expect(collapseUpd).toContain("collapsed into op-dup-new");
    expect(updates.some((t) => t.includes('"op-dup-new"') && t.includes("SET state ="))).toBe(false);
    expect(updates.some((t) => t.includes('"op-quiet"'))).toBe(false);

    // ordering: served/collapse step's live read precedes the 7-day age-out read
    const liveIdx = captured.findIndex((t) => t.includes("ORDER BY created_at DESC") && t.includes("missed_call"));
    const ageIdx = captured.findIndex((t) => t.includes("INTERVAL 7 DAY") && t.includes("missed_call"));
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(ageIdx).toBeGreaterThan(liveIdx);
    expect(captured[ageIdx]).toContain("LIMIT 500");

    // bounded reads, phone-filtered evidence, dates formatted in SQL, sources never mutated
    expect(captured[liveIdx]).toContain("LIMIT 500");
    expect(captured[liveIdx]).toContain("CONVERT_TZ(created_at");
    const cbQ = captured.find((t) => t.includes("FROM callback_requests"));
    expect(cbQ).toContain("REGEXP_REPLACE");
    expect(cbQ).toContain("LIMIT 1000");
    expect(cbQ).toContain("DATE_FORMAT(CONVERT_TZ(createdAt");
    // bound is the earliest STORED anchor, passed as a string (never a JS Date)
    expect(cbQ).toContain("2026-09-28 15:00:00");
    const invQ = captured.find((t) => t.includes("FROM invoices") && t.includes("REGEXP_REPLACE"));
    expect(invQ).toContain("paymentStatus = 'paid'");
    // invoiceDate is stored in shop time: read as stored, never converted from UTC (which put
    // Friday's date-only ticket on Thursday evening, the same shop day as a Thursday call).
    expect(invQ).toContain("DATE_FORMAT(invoiceDate, '%Y-%m-%d %H:%i:%s')");
    expect(invQ).not.toContain("CONVERT_TZ(invoiceDate");
    const mutates = captured.some((t) => /UPDATE\s+(invoices|callback_requests|leads|bookings|vapi_call_logs)\b/i.test(t));
    expect(mutates).toBe(false);
  });

  it("a row with no readable anchor is never decided (no false closure)", async () => {
    const o = { ...opp("op-noanchor", "2165550107"), createdRaw: null, createdEt: null };
    oppRows[o.id] = o;
    liveMissed = [o];
    callbackRows = [{ id: 600, phone: "2165550107", at: "2026-09-28 13:00:00" }];
    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    await reconcileOpportunities();
    expect(captured.some((t) => t.includes("UPDATE revenue_opportunities") && t.includes("op-noanchor"))).toBe(false);
  });
});

// ─── Collector collapse ─────────────────────────────────────────────

describe("collectMissedCalls · one live card per phone", () => {
  const call = (vapiCallId: string, phone: string, minsAgo: number) => ({
    id: minsAgo, vapiCallId, phoneNumber: phone, durationSeconds: 40, convertedToLead: 0,
    leadId: null, callbackId: null, metadata: null, createdAt: new Date(Date.now() - minsAgo * 60_000),
  });

  it("the NEWEST call gets the card; the phone's older un-worked card collapses into it", async () => {
    livePhoneRows = [{ id: "op-old", source_id: "call-existing", state: "new", customer_phone: "(216) 555-0142" }];
    oppRows["op-old"] = { id: "op-old", state: "new", source_type: "missed_call" };
    vapiSelectRows = [
      call("call-redial", "+12165550142", 60), // newest for 0142 -> inserted; op-old collapses into it
      call("call-b-new", "2165550177", 90), // newest for 0177 -> inserted
      call("call-b-old", "2165550177", 300), // older 0177 in the same batch -> not carded
      call("call-existing", "2165550142", 400), // op-old's own call, older than the redial -> not carded
    ];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    const stats = await collectMissedCalls();
    expect(inserts.some((t) => t.includes("call-redial"))).toBe(true);
    expect(inserts.some((t) => t.includes("call-b-new"))).toBe(true);
    expect(inserts.some((t) => t.includes("call-b-old"))).toBe(false);
    const collapseUpd = captured.find((t) => t.includes("UPDATE revenue_opportunities") && t.includes("collapsed into newer missed call"));
    expect(collapseUpd, "the older live card must be closed into the newer call").toBeTruthy();
    expect(collapseUpd).toContain("duplicate");
    expect(stats.collapsed).toBe(1); // cards CLOSED (op-old) — older calls merely not carded are not counted
  });

  it("a refreshed call whose card is no longer live (dismissed) never closes the phone's live card", async () => {
    // op-live is the only live card; call-new's card exists but was dismissed, so it is not in livePhoneRows.
    livePhoneRows = [{ id: "op-live", source_id: "call-old", state: "new", customer_phone: "2165550142" }];
    oppRows["op-live"] = { id: "op-live", state: "new", source_type: "missed_call" };
    refreshNext = true;
    vapiSelectRows = [call("call-new", "2165550142", 60)];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    const stats = await collectMissedCalls();
    expect(captured.some((t) => t.includes("UPDATE revenue_opportunities") && t.includes("collapsed into"))).toBe(false);
    expect(stats.collapsed).toBe(0);
  });

  it("dismissing the NEWEST card never resurrects the phone's older calls as fresh cards", async () => {
    // call-new's card exists but was dismissed (not live); call-old has no card at all.
    livePhoneRows = [];
    refreshNext = true;
    vapiSelectRows = [call("call-new", "2165550142", 60), call("call-old", "2165550142", 300)];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    const stats = await collectMissedCalls();
    expect(inserts.filter((t) => t.includes("call-old")), "older call must not be carded").toHaveLength(0);
    expect(stats.refreshed).toBe(1);
  });

  it("an older ASSIGNED card is left to its owner — only untouched `new` cards collapse", async () => {
    livePhoneRows = [{ id: "op-assigned", source_id: "call-existing", state: "assigned", customer_phone: "2165550142" }];
    oppRows["op-assigned"] = { id: "op-assigned", state: "assigned", source_type: "missed_call" };
    vapiSelectRows = [call("call-redial", "2165550142", 60)];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    const stats = await collectMissedCalls();
    expect(captured.some((t) => t.includes("UPDATE revenue_opportunities") && t.includes("collapsed into"))).toBe(false);
    expect(stats.collapsed).toBe(0);
  });

  it("an older card someone is already WORKING is never collapsed by a new call", async () => {
    livePhoneRows = [{ id: "op-worked", source_id: "call-existing", state: "attempted", customer_phone: "2165550142" }];
    oppRows["op-worked"] = { id: "op-worked", state: "attempted", source_type: "missed_call" };
    vapiSelectRows = [call("call-redial", "2165550142", 60)];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    const stats = await collectMissedCalls();
    expect(inserts.some((t) => t.includes("call-redial"))).toBe(true);
    expect(captured.some((t) => t.includes("UPDATE revenue_opportunities") && t.includes("collapsed into"))).toBe(false);
    expect(stats.collapsed).toBe(0);
  });
});

describe("collectMissedCalls · a tool-reaching call is not a capture (2026-10-07)", () => {
  // convertedToLead = 1 means Nick REACHED a tool, not that anything was saved.
  // The collector filtered convertedToLead = 0 in SQL, so a caller who reached
  // tireInquiry and saved nothing never got a call-back card (the SMS cron was
  // fixed in 844c880a; this collector was not).
  const toolCall = (vapiCallId: string, phone: string) => ({
    id: 1, vapiCallId, phoneNumber: phone, durationSeconds: 40, convertedToLead: 1,
    leadId: null, callbackId: null, metadata: null, createdAt: new Date(Date.now() - 90 * 60_000),
  });
  const nothing = { reachedTool: true, leadId: null, callbackId: null, existingCallbackForCall: false, hasExpectedArrival: false };

  it("PROVEN to have captured nothing -> gets a card", async () => {
    vapiSelectRows = [toolCall("call-tool-empty", "2165550188")];
    captureEvidence["call-tool-empty"] = nothing;
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    await collectMissedCalls();
    expect(inserts.some((t) => t.includes("call-tool-empty"))).toBe(true);
  });

  it("captured something (callback request / expected arrival) -> no card", async () => {
    vapiSelectRows = [toolCall("call-tool-cb", "2165550189"), toolCall("call-tool-arr", "2165550190")];
    captureEvidence["call-tool-cb"] = { ...nothing, existingCallbackForCall: true };
    captureEvidence["call-tool-arr"] = { ...nothing, hasExpectedArrival: true };
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    await collectMissedCalls();
    expect(inserts.some((t) => t.includes("call-tool-cb"))).toBe(false);
    expect(inserts.some((t) => t.includes("call-tool-arr"))).toBe(false);
  });

  it("a failed evidence read is unknown -> no card (never a false positive)", async () => {
    vapiSelectRows = [toolCall("call-tool-unknown", "2165550191")];
    const { collectMissedCalls } = await import("./services/opportunityQueue");
    await collectMissedCalls();
    expect(inserts.some((t) => t.includes("call-tool-unknown"))).toBe(false);
  });
});

describe("refreshOpportunityQueue · collapse is reported, not silent", () => {
  it("details carry the missed-call collapsed count", async () => {
    livePhoneRows = [{ id: "op-old", source_id: "call-existing", state: "new", customer_phone: "2165550142" }];
    oppRows["op-old"] = { id: "op-old", state: "new", source_type: "missed_call" };
    vapiSelectRows = [
      { id: 1, vapiCallId: "call-redial", phoneNumber: "2165550142", durationSeconds: 40, convertedToLead: 0,
        leadId: null, callbackId: null, metadata: null, createdAt: new Date(Date.now() - 60 * 60_000) },
    ];
    const { refreshOpportunityQueue } = await import("./services/opportunityQueue");
    const { details, recordsProcessed } = await refreshOpportunityQueue();
    expect(details).toMatch(/missed calls: 1new\/0ref\/1scan\/1collapsed/);
    // a collapse is a real change: it counts toward recordsProcessed (1 insert + 1 collapse)
    expect(recordsProcessed).toBeGreaterThanOrEqual(2);
  });
});

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
      return [{ affectedRows: 1 }];
    }
    if (text.includes("SELECT id, source_id, state, customer_phone FROM revenue_opportunities")) return [livePhoneRows];
    if (text.includes("source_type = 'missed_call'") && text.includes("ORDER BY created_at DESC")) return [liveMissed];
    if (text.includes("SELECT vapiCallId, createdAt FROM vapi_call_logs")) return [callTimes];
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
});

const HOUR = 3_600_000;
const CALL_AT = new Date("2026-09-28T15:00:00Z");
const ev = (over: Partial<MissedCallServedEvidence>): MissedCallServedEvidence => ({
  source: "callback_requests",
  id: 123,
  phone: "(216) 555-0142",
  at: new Date(CALL_AT.getTime() + 2 * HOUR),
  ...over,
});

// ─── Pure deciders ──────────────────────────────────────────────────

describe("decideMissedCallServed", () => {
  it("served by a LATER callback request for the same phone (any formatting)", () => {
    const d = decideMissedCallServed({ phone: "+12165550142", anchorAt: CALL_AT, evidence: [ev({})] });
    expect(d.invoice).toBeNull();
    expect(d.served?.source).toBe("callback_requests");
    expect(missedCallServedNote(d.served!)).toBe(
      `served: callback_requests #123 at ${new Date(CALL_AT.getTime() + 2 * HOUR).toISOString()}`,
    );
  });

  it("a later invoice routes to the won path (invoice candidate), earliest first", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [
        ev({ source: "invoices", id: 902, at: new Date(CALL_AT.getTime() + 48 * HOUR) }),
        ev({ source: "invoices", id: 901, at: new Date(CALL_AT.getTime() + 24 * HOUR) }),
      ],
    });
    expect(d.invoice?.id).toBe(901);
  });

  it("evidence BEFORE (or exactly at) the call does NOT close", () => {
    const d = decideMissedCallServed({
      phone: "2165550142",
      anchorAt: CALL_AT,
      evidence: [
        ev({ at: new Date(CALL_AT.getTime() - HOUR) }),
        ev({ source: "leads", at: CALL_AT }),
        ev({ source: "invoices", id: 900, at: new Date(CALL_AT.getTime() - 24 * HOUR) }),
      ],
    });
    expect(d).toEqual({ invoice: null, served: null });
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
    expect(missedCallServedNote(d.served!)).toMatch(/^served: vapi_call_logs #77 at .+ \(lead #12\)$/);
  });
});

describe("servedCloseState", () => {
  it("duplicate where the transition table allows it; a worked row is left to its owner (never 'lost')", () => {
    expect(servedCloseState("new")).toBe("duplicate");
    expect(servedCloseState("assigned")).toBe("duplicate");
    // A served customer on a worked card is a RECOVERY, not a lost sale.
    expect(servedCloseState("attempted")).toBeNull();
    expect(servedCloseState("contacted")).toBeNull();
  });
});

describe("planMissedCallCollapse", () => {
  const row = (id: string, phone: string | null, hoursAfter: number, state: "new" | "attempted" = "new") =>
    ({ id, phone, anchorAt: new Date(CALL_AT.getTime() + hoursAfter * HOUR), state });

  it("keeps the NEWEST live row per phone; older ones collapse into it", () => {
    const plan = planMissedCallCollapse([
      row("old", "2165550142", 0),
      row("newest", "(216) 555-0142", 5),
      row("mid", "+1 216 555 0142", 2),
      row("other-person", "2165550199", 1),
    ]);
    expect(plan.collapse).toEqual(
      expect.arrayContaining([{ id: "old", keepId: "newest" }, { id: "mid", keepId: "newest" }]),
    );
    expect(plan.collapse).toHaveLength(2);
    expect(plan.skipped).toEqual([]);
  });

  it("never collapses a row an operator already worked; never groups phoneless rows", () => {
    const plan = planMissedCallCollapse([
      row("worked", "2165550142", 0, "attempted"),
      row("newest", "2165550142", 5),
      row("nophone-a", null, 0),
      row("nophone-b", null, 1),
    ]);
    expect(plan.collapse).toEqual([]);
    expect(plan.skipped).toEqual(["worked"]);
  });

  it("is idempotent: a single live row per phone is a no-op", () => {
    expect(planMissedCallCollapse([row("only", "2165550142", 0)])).toEqual({ collapse: [], skipped: [] });
  });

  it("phone10 is the house last-10 rule", () => {
    expect(phone10("+1 (216) 555-0142")).toBe("2165550142");
    expect(phone10("5550142")).toBeNull();
    expect(phone10(null)).toBeNull();
  });
});

// ─── Reconcile wiring ───────────────────────────────────────────────

function opp(id: string, phone: string, state = "new", createdAt = new Date(CALL_AT.getTime() + HOUR)) {
  return {
    id, source_type: "missed_call", source_id: `call-${id}`, customer_phone: phone,
    state, receipts_json: "[]", consent_ok: 1, attempts: 0, data_quality: "verified",
    urgency: "today", recommended_action: "x", reason: "x",
    created_at: createdAt.toISOString(), updated_at: createdAt.toISOString(),
  };
}

describe("reconcileOpportunities · missed_call step 3a", () => {
  it("won via recordOutcome on a later invoice; served → duplicate naming the callback; then collapse; all before age-out", async () => {
    const won = opp("op-won", "2165550101");
    const served = opp("op-served", "2165550102");
    const dupOld = opp("op-dup-old", "2165550103");
    const dupNew = opp("op-dup-new", "2165550103", "new", new Date(CALL_AT.getTime() + 6 * HOUR));
    const untouched = opp("op-quiet", "2165550104");
    for (const o of [won, served, dupOld, dupNew, untouched]) oppRows[o.id] = o;
    liveMissed = [dupNew, won, served, dupOld, untouched];
    callTimes = [
      { vapiCallId: "call-op-won", createdAt: CALL_AT.toISOString() },
      { vapiCallId: "call-op-served", createdAt: CALL_AT.toISOString() },
      { vapiCallId: "call-op-dup-old", createdAt: CALL_AT.toISOString() },
      { vapiCallId: "call-op-dup-new", createdAt: new Date(CALL_AT.getTime() + 5 * HOUR).toISOString() },
      { vapiCallId: "call-op-quiet", createdAt: CALL_AT.toISOString() },
    ];
    // callback came in 10 min after the call — BEFORE the queue row was born
    // (created_at = call + 1h). Anchoring on the call time is what closes it.
    callbackRows = [
      { id: 555, phone: "216-555-0102", at: new Date(CALL_AT.getTime() + 10 * 60_000).toISOString() },
      { id: 556, phone: "2165550104", at: new Date(CALL_AT.getTime() - HOUR).toISOString() }, // before: no close
    ];
    invoiceEvidenceRows = [{ id: 4242, phone: "2165550101", at: new Date(CALL_AT.getTime() + 21 * HOUR).toISOString() }];
    invoiceById = { 4242: { id: 4242, customerPhone: "2165550101", invoiceDate: new Date(CALL_AT.getTime() + 21 * HOUR).toISOString() } };

    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    const stats = await reconcileOpportunities();

    expect(stats.won).toBe(1);
    const wonUpdate = captured.find((t) => t.includes("SET state = 'won'"));
    expect(wonUpdate).toContain("op-won");
    expect(wonUpdate).toContain("outcome_invoice_id");

    const updates = captured.filter((t) => t.includes("UPDATE revenue_opportunities") && !t.includes("SET state = 'won'"));
    const servedUpd = updates.find((t) => t.includes("op-served"));
    expect(servedUpd).toContain('"duplicate"');
    expect(servedUpd).toContain("served: callback_requests #555 at");
    // CAS on the read state
    expect(servedUpd).toMatch(/WHERE id = .*AND state = /);

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

    // bounded reads, phone-filtered evidence, sources never mutated
    expect(captured[liveIdx]).toContain("LIMIT 500");
    const cbQ = captured.find((t) => t.includes("FROM callback_requests"));
    expect(cbQ).toContain("REGEXP_REPLACE");
    expect(cbQ).toContain("LIMIT 1000");
    const mutates = captured.some((t) => /UPDATE\s+(invoices|callback_requests|leads|bookings|vapi_call_logs)\b/i.test(t));
    expect(mutates).toBe(false);
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
    expect(stats.collapsed).toBe(3); // op-old closed + 2 older calls not carded
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

describe("refreshOpportunityQueue · collapse is reported, not silent", () => {
  it("details carry the missed-call collapsed count", async () => {
    livePhoneRows = [{ id: "op-old", source_id: "call-existing", state: "new", customer_phone: "2165550142" }];
    oppRows["op-old"] = { id: "op-old", state: "new", source_type: "missed_call" };
    vapiSelectRows = [
      { id: 1, vapiCallId: "call-redial", phoneNumber: "2165550142", durationSeconds: 40, convertedToLead: 0,
        leadId: null, callbackId: null, metadata: null, createdAt: new Date(Date.now() - 60 * 60_000) },
    ];
    const { refreshOpportunityQueue } = await import("./services/opportunityQueue");
    const { details } = await refreshOpportunityQueue();
    expect(details).toMatch(/missed calls: 1new\/0ref\/1scan\/1collapsed/);
  });
});

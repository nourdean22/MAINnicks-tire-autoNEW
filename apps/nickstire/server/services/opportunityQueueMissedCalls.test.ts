/**
 * Missed-call collector qualification (job 2026-10-25-admin-tabs-pipeline).
 *
 * Before: every answered VAPI call of 15 s or more with no lead or callback
 * became a "Missed call" card ("Real conversation (23s >= 15s)"), so a
 * "what time do you close" call ranked beside a brake conversation: 169 cards
 * in 7 days on 2026-10-25. Now a call is carded only when the eval cron's
 * outcome says something is still open, and the card names the need and the
 * age in words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── fake DB ────────────────────────────────────────────────────────

let vapiSelectRows: Array<Record<string, unknown>> = [];
let inserts: unknown[] = [];

/** Every string leaf of a drizzle sql object: the SQL text chunks AND the bound params. */
function strings(q: unknown, out: string[] = []): string[] {
  if (typeof q === "string") out.push(q);
  else if (Array.isArray(q)) for (const v of q) strings(v, out);
  else if (q && typeof q === "object") for (const v of Object.values(q)) strings(v, out);
  return out;
}

const fakeDb = {
  execute: async (q: unknown) => {
    const text = strings(q).join(" ");
    if (text.includes("INSERT INTO revenue_opportunities")) {
      inserts.push(q);
      return [{ affectedRows: 1 }];
    }
    return [[]]; // live-phone read, DNC check: nothing
  },
  select: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.limit = async () => vapiSelectRows;
    return chain;
  },
};

vi.mock("../db", () => ({
  getDb: async () => fakeDb,
  getDbTyped: async () => fakeDb,
}));

vi.mock("./vapiActionExtraction", () => ({
  loadCallCaptureEvidence: async () => ({}),
}));

const NOW = new Date("2026-10-25T18:00:00Z").getTime();
const SUMMARY =
  "Caller asked whether the shop has used tires in 225/55R17 and how much a set of four would cost mounted " +
  "and balanced today, and said they would decide after hearing the price.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vapiSelectRows = [];
  inserts = [];
});
afterEach(() => {
  vi.useRealTimers();
});

let seq = 0;
function call(over: {
  vapiCallId?: string;
  phone?: string;
  durationSeconds?: number;
  minsAgo: number;
  evalOutcome: string | null;
  serviceMention?: string | null;
  aiSummary?: string | null;
  evalScore?: number | null;
}) {
  seq++;
  return {
    id: seq,
    vapiCallId: over.vapiCallId ?? `call-${seq}`,
    phoneNumber: over.phone ?? `+1216555${String(1000 + seq)}`,
    durationSeconds: over.durationSeconds ?? 23,
    convertedToLead: 0,
    leadId: null,
    callbackId: null,
    metadata: null,
    createdAt: new Date(NOW - over.minsAgo * 60_000),
    evalOutcome: over.evalOutcome,
    evalScore: over.evalScore ?? null,
    serviceMention: over.serviceMention ?? null,
    aiSummary: over.aiSummary ?? null,
    customerName: "Maria Lopez",
  };
}

/** The carded row for one call: its recommendedAction, reason and parsed evidence. */
function card(vapiCallId: string) {
  const q = inserts.find((i) => strings(i).includes(vapiCallId));
  if (!q) return null;
  const s = strings(q);
  const evidenceJson = s.find((v) => v.startsWith('{"vapiCallId"'));
  return {
    action: s.find((v) => v.startsWith("Call back ")) ?? null,
    reason: s.find((v) => v.startsWith("The receptionist's evaluation")) ?? null,
    evidence: evidenceJson ? JSON.parse(evidenceJson) as Record<string, unknown> : null,
    all: s,
  };
}

async function run() {
  const { collectMissedCalls } = await import("./opportunityQueue");
  return collectMissedCalls();
}

describe("collectMissedCalls · only an unresolved evaluated call is an opportunity", () => {
  it("(a) an answered hours/price question is NOT carded, short or long", async () => {
    vapiSelectRows = [
      call({ vapiCallId: "call-hours-23s", durationSeconds: 23, minsAgo: 120, evalOutcome: "resolved_info" }),
      call({ vapiCallId: "call-hours-105s", durationSeconds: 105, minsAgo: 180, evalOutcome: "resolved_info" }),
    ];
    const stats = await run();
    expect(inserts).toHaveLength(0);
    expect(stats.skippedResolved).toBe(2);
  });

  it("(b) a 23 s tire-stock call IS carded with the need, the age in hours and the evidence", async () => {
    vapiSelectRows = [
      call({
        vapiCallId: "call-tire",
        phone: "+12165550142",
        durationSeconds: 23,
        minsAgo: 21 * 60,
        evalOutcome: "tire_availability_intent",
        evalScore: 62,
        serviceMention: "used tires 225/55R17",
        aiSummary: SUMMARY,
      }),
    ];
    const stats = await run();
    expect(stats.inserted).toBe(1);
    const c = card("call-tire")!;
    expect(c.action).toBe("Call back +12165550142: used tires 225/55R17, 21 h ago");
    expect(c.reason).toBe(
      "The receptionist's evaluation says this is unresolved (asked if a tire size is in stock); a human call-back beats any text.",
    );
    expect(c.evidence).toMatchObject({
      vapiCallId: "call-tire",
      evalOutcome: "tire_availability_intent",
      evalScore: 62,
      serviceMention: "used tires 225/55R17",
      durationSeconds: 23,
      callAgeMinutes: 21 * 60,
    });
    const excerpt = String(c.evidence!.summaryExcerpt);
    expect(SUMMARY.length).toBeGreaterThan(140);
    expect(excerpt.length).toBeLessThanOrEqual(140);
    // cut on a word, never mid-word: the kept text is a prefix that ends where the source has a space
    expect(excerpt.endsWith("...")).toBe(true);
    const kept = excerpt.slice(0, -3);
    expect(SUMMARY.startsWith(kept)).toBe(true);
    expect(SUMMARY[kept.length]).toBe(" ");
    // the caller's name never rides on the card
    expect(c.all.some((v) => v.includes("Maria"))).toBe(false);
  });

  it("(b2) with no service mention the need is the outcome in words; a summary with a phone or name is redacted", async () => {
    vapiSelectRows = [
      call({
        vapiCallId: "call-cb", phone: "+12165550150", minsAgo: 120, evalOutcome: "callback_needed",
        aiSummary: "Hi this is Maria, call me back at 216-555-0199 about my brakes.",
      }),
      call({ vapiCallId: "call-quote", minsAgo: 120, evalOutcome: "quote_or_inspection_intent", serviceMention: "unknown" }),
      call({ vapiCallId: "call-lost", minsAgo: 120, evalOutcome: "lost_opportunity" }),
    ];
    await run();
    expect(card("call-cb")!.action).toBe("Call back +12165550150: asked for a call back, 2 h ago");
    expect(card("call-quote")!.action).toMatch(/: asked for a quote or an inspection, 2 h ago$/);
    expect(card("call-lost")!.action).toMatch(/: left without an answer, 2 h ago$/);
    const excerpt = String(card("call-cb")!.evidence!.summaryExcerpt);
    expect(excerpt).not.toContain("216-555-0199");
    expect(excerpt).not.toContain("Maria");
    expect(card("call-lost")!.evidence!.summaryExcerpt).toBeNull();
  });

  it("(c) a call not yet evaluated waits: skipped and counted as unevaluated", async () => {
    vapiSelectRows = [call({ vapiCallId: "call-null", durationSeconds: 90, minsAgo: 120, evalOutcome: null })];
    const stats = await run();
    expect(inserts).toHaveLength(0);
    expect(stats.skippedUnevaluated).toBe(1);
  });

  it("(d) spam, abandoned, tech failure, walk-in, conversion and handoff are never carded", async () => {
    vapiSelectRows = [
      "spam_or_wrong_number", "abandoned_before_connect", "tech_failure",
      "walk_in_directed", "hard_conversion", "human_handoff",
    ].map((o) => call({ vapiCallId: `call-${o}`, durationSeconds: 60, minsAgo: 120, evalOutcome: o }));
    const stats = await run();
    expect(inserts).toHaveLength(0);
    expect(stats.skippedNoise).toBe(3);
    expect(stats.skippedResolved).toBe(3);
  });

  it("(e) the age words: minutes under 90, whole hours to 48, days past 48", async () => {
    vapiSelectRows = [
      call({ vapiCallId: "call-50m", minsAgo: 50, evalOutcome: "callback_needed" }),
      call({ vapiCallId: "call-95m", minsAgo: 95, evalOutcome: "callback_needed" }),
      call({ vapiCallId: "call-21h", minsAgo: 21 * 60, evalOutcome: "callback_needed" }),
      call({ vapiCallId: "call-49h", minsAgo: 49 * 60, evalOutcome: "callback_needed" }),
      call({ vapiCallId: "call-3d", minsAgo: 72 * 60, evalOutcome: "callback_needed" }),
    ];
    await run();
    expect(card("call-50m")!.action).toMatch(/, 50 min ago$/);
    expect(card("call-95m")!.action).toMatch(/, 1 h ago$/);
    expect(card("call-21h")!.action).toMatch(/, 21 h ago$/);
    expect(card("call-49h")!.action).toMatch(/, 2 days ago$/);
    expect(card("call-3d")!.action).toMatch(/, 3 days ago$/);
  });

  it("(f) the stats carry all three skipped counts beside the carded one", async () => {
    vapiSelectRows = [
      call({ minsAgo: 100, evalOutcome: "callback_needed" }),
      call({ minsAgo: 110, evalOutcome: "resolved_info" }),
      call({ minsAgo: 120, evalOutcome: "walk_in_directed" }),
      call({ minsAgo: 130, evalOutcome: null }),
      call({ minsAgo: 140, evalOutcome: "spam_or_wrong_number" }),
      call({ minsAgo: 150, evalOutcome: "unknown" }),
    ];
    const stats = await run();
    expect(stats).toMatchObject({
      scanned: 6, inserted: 1, skippedResolved: 2, skippedUnevaluated: 1, skippedNoise: 2,
    });
  });

  it("an unresolved call still needs a real conversation (the empty-call floor stays)", async () => {
    vapiSelectRows = [call({ vapiCallId: "call-8s", durationSeconds: 8, minsAgo: 120, evalOutcome: "callback_needed" })];
    await run();
    expect(inserts).toHaveLength(0);
  });

  it("the refresh receipt carries the skipped counts (cron_log details is their reader)", async () => {
    vapiSelectRows = [
      call({ minsAgo: 100, evalOutcome: "callback_needed" }),
      call({ minsAgo: 110, evalOutcome: "resolved_info" }),
      call({ minsAgo: 130, evalOutcome: null }),
    ];
    const { refreshOpportunityQueue } = await import("./opportunityQueue");
    const { details } = await refreshOpportunityQueue();
    expect(details).toMatch(/missed calls: 1new\/0ref\/3scan\/0collapsed\/1resolved\/1unevaluated\/0noise/);
  });
});

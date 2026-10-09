/**
 * Behavioural proof that an SMS replay changes nothing.
 *
 * 2026-10-09 (autoresearch audit, SMS replay isolation). REPLAY_DRY_RUN used to
 * fake only sendSms; a replay still wrote sms_orchestrations rows (read by the
 * live cooldown), opt-outs, consent-ledger rows, booking status, reminders,
 * expected arrivals, drafts and an owner email. golden test 40 checked only
 * that the mocked sender was not called, which is why nobody noticed.
 *
 * Here EVERY write path throws: the DB mock's insert / update / delete and any
 * non-SELECT execute, plus every mutating module function (sms, complianceLog,
 * expectedArrivals, sms-scheduler, smsLearningEngine, email-notify). Each event
 * is run three ways:
 *
 *   1. inside runInSmsReplayScope: no mutating call may happen at all (calls
 *      are counted, so a write swallowed by a try/catch still fails the test),
 *      the recorder lists exactly the skipped effects, and the decision
 *      (status / body / shouldAutoSend) is still produced;
 *   2. outside the scope (positive control): the same event DOES hit the
 *      throwing mocks, so the instrument is live;
 *   3. outside the scope with the mocks resolving: production performs no
 *      effect the replay failed to intercept, and every effect the replay
 *      skipped is one production really performs.
 *
 * Harness approach follows smsOrchestrator.golden.test.ts (table-keyed select
 * results, module mocks), rebuilt so writes throw instead of resolving.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    mode: "throw" as "throw" | "resolve",
    hits: [] as string[],
    reads: [] as string[],
    tables: {} as Record<string, unknown[]>,
    suppressed: new Set<string>(),
    renderSql: (_q: unknown): string => "",
  };
  function hit<T>(name: string, value: T): T {
    state.hits.push(name);
    if (state.mode === "throw") throw new Error(`mutation attempted: ${name}`);
    return value;
  }
  const tableName = (t: any): string => (t && (t[Symbol.for("drizzle:Name")] as string)) || "unknown_table";
  function chain(result: unknown) {
    const c: any = {
      set: () => c,
      where: () => c,
      values: () => c,
      $returningId: () => Promise.resolve([{ id: 42 }]),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return c;
  }
  function selectBuilder() {
    let table: any;
    const qb: any = {
      from: (t: any) => { table = t; return qb; },
      where: () => qb,
      orderBy: () => qb,
      limit: () => qb,
      offset: () => qb,
      then: (res: any, rej: any) => {
        const name = tableName(table);
        state.reads.push(name);
        return Promise.resolve([...(state.tables[name] ?? [])]).then(res, rej);
      },
    };
    return qb;
  }
  const db = {
    select: () => selectBuilder(),
    insert: (t: any) => hit(`${tableName(t)}.insert`, chain([{ affectedRows: 1 }])),
    update: (t: any) => hit(`${tableName(t)}.update`, chain([{ affectedRows: 1 }])),
    delete: (t: any) => hit(`${tableName(t)}.delete`, chain([{ affectedRows: 1 }])),
    execute: (q: unknown) => {
      const text = state.renderSql(q);
      if (/^\s*(SELECT|WITH)\b/i.test(text)) {
        state.reads.push("execute:select");
        return Promise.resolve([[], []]);
      }
      return hit(`execute:${text.trim().split(/\s+/)[0]?.toLowerCase() ?? "unknown"}`, Promise.resolve([{ affectedRows: 1 }, []]));
    },
  };
  return { state, hit, db };
});

vi.mock("../db", () => ({
  getDbTyped: async () => h.db,
  getDb: async () => h.db,
}));

vi.mock("../sms", () => ({
  sendSms: (..._a: unknown[]) => h.hit("sms.sendSms", Promise.resolve({ success: true, sid: "SM_live_test" })),
  markPhoneFullyOptedOut: (..._a: unknown[]) => h.hit("sms.markPhoneFullyOptedOut", Promise.resolve(true)),
  markPhoneOptedOut: (..._a: unknown[]) => h.hit("sms.markPhoneOptedOut", undefined),
  markPhoneOptedIn: (..._a: unknown[]) => h.hit("sms.markPhoneOptedIn", Promise.resolve(true)),
  loadSuppressionIndex: async () => ({
    ok: true,
    phones: h.state.suppressed,
    carrierBlocked: new Set<string>(),
    voiceOnly: new Set<string>(),
    stale: false,
  }),
}));

vi.mock("../services/complianceLog", () => ({
  logSmsOptOut: (..._a: unknown[]) => h.hit("complianceLog.logSmsOptOut", Promise.resolve(undefined)),
  logSmsOptIn: (..._a: unknown[]) => h.hit("complianceLog.logSmsOptIn", Promise.resolve(undefined)),
}));

vi.mock("../services/expectedArrivals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/expectedArrivals")>();
  return {
    ...actual,
    recordExpectedArrival: (..._a: unknown[]) =>
      h.hit("expectedArrivals.recordExpectedArrival", Promise.resolve({ id: 1, created: true })),
  };
});

vi.mock("../services/sms-scheduler", () => ({
  cancelBookingReminders: (..._a: unknown[]) => h.hit("smsScheduler.cancelBookingReminders", Promise.resolve(undefined)),
}));

vi.mock("../services/smsLearningEngine", () => ({
  trackOrchestrationOutcome: (..._a: unknown[]) =>
    h.hit("smsLearningEngine.trackOrchestrationOutcome", Promise.resolve(undefined)),
}));

vi.mock("../email-notify", () => ({
  sendNotification: (..._a: unknown[]) =>
    h.hit("emailNotify.sendNotification", Promise.resolve({ emailSent: true, pushSent: true, recipients: [], throttled: false })),
}));

vi.mock("../services/nickgpt-client", () => ({
  draftSmsReply: async () => ({
    ok: true,
    draft: "Thanks for the text. Bring it by and we will take a look; we are first come, first served.",
    source: "test-drafter",
    latencyMs: 1,
    completion: "complete",
  }),
}));

vi.mock("../services/classifiers", () => ({
  classifyIntent: async () => ({ ok: true, topLabel: "asking about appointment scheduling", topScore: 0.95 }),
}));

vi.mock("../services/featureFlags", () => ({
  isEnabled: async () => true,
}));

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SQL } from "drizzle-orm";
import { orchestrateSms, type SmsOrchestratorEvent, type SmsOrchestratorResult } from "../services/smsOrchestrator";
import { createSmsEffectRecorder, replayOutcomeBucket, runInSmsReplayScope } from "../services/smsReplayScope";

const dialect = new MySqlDialect();
h.state.renderSql = (q: unknown) => (q instanceof SQL ? dialect.sqlToQuery(q).sql : String(q));

const ORIGINAL_REPLAY_DRY_RUN = process.env.REPLAY_DRY_RUN;
const fetchSpy = vi.fn((..._a: unknown[]) => Promise.reject(new Error("network blocked in this test")));

function resetState() {
  h.state.mode = "throw";
  h.state.hits = [];
  h.state.reads = [];
  h.state.suppressed = new Set<string>();
  h.state.tables = {
    customers: [{ id: 1, firstName: "Sam", lastName: null, smsOptOut: 0, vehicleYear: null, vehicleMake: null, vehicleModel: null }],
    bookings: [],
    callback_requests: [],
    leads: [],
    alg_estimates: [],
    sms_conversations: [],
    sms_messages: [],
    sms_orchestrations: [],
    vapi_call_logs: [],
    app_secret_kv: [],
  };
}

let randomSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  delete process.env.REPLAY_DRY_RUN;
  resetState();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  // Variant assignment is random; pin it (as the golden test does) so a run
  // cannot pick a held-out or preflight-blocked variant on one leg only.
  randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  randomSpy?.mockRestore();
  vi.unstubAllGlobals();
  if (ORIGINAL_REPLAY_DRY_RUN === undefined) delete process.env.REPLAY_DRY_RUN;
  else process.env.REPLAY_DRY_RUN = ORIGINAL_REPLAY_DRY_RUN;
});

interface ReplayCase {
  label: string;
  event: SmsOrchestratorEvent;
  setup?: () => void;
  /** The effects the replay must skip, in order. */
  replayEffects: string[];
  /** Live-run hits (throwing mocks) that prove this event reaches its signature effect. */
  liveSignature: string[];
  decision: (r: SmsOrchestratorResult) => void;
}

const BOOKING = { id: 77, phone: "2165550177", vehicle: "2014 Civic", service: "Tires", stage: "intake", status: "new", preferredDate: null, preferredTime: null };

const CASES: ReplayCase[] = [
  {
    label: "inbound STOP",
    event: { type: "inbound_sms", phone: "2165550101", body: "STOP", conversationId: 501 },
    replayEffects: [
      "sms_orchestrations.insert",
      "sms.markPhoneFullyOptedOut",
      "customers.update_sms_opt_out",
      "complianceLog.logSmsOptOut",
      "customers.update_sms_opt_out",
      "sms.markPhoneOptedOut",
      "complianceLog.logSmsOptOut",
      "sms_orchestrations.insert",
    ],
    liveSignature: ["sms_orchestrations.insert", "sms.markPhoneFullyOptedOut"],
    decision: (r) => {
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("unsubscribe_keyword_matched");
      expect(r.shouldAutoSend).toBe(false);
      // Control for the opt-in column below: a STOP block is a real no-send.
      expect(replayOutcomeBucket(r, { type: "inbound_sms", body: "STOP" })).toBe("no_send");
    },
  },
  {
    label: "inbound START",
    event: { type: "inbound_sms", phone: "2165550102", body: "START", conversationId: 502 },
    // START is not a parser intent, so after the opt-in it falls through to
    // the drafter (mocked here as a low-risk, auto-sendable reply).
    replayEffects: [
      "sms_orchestrations.insert",
      "sms.markPhoneOptedIn",
      "customers.update_sms_opt_out",
      "complianceLog.logSmsOptIn",
      "nickgpt_drafts.insert",
      "sms.sendSms",
      "sms_orchestrations.insert",
    ],
    liveSignature: ["sms.markPhoneOptedIn"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.shouldAutoSend).toBe(true);
    },
  },
  {
    label: "inbound YES with an active booking",
    event: { type: "inbound_sms", phone: "2165550177", body: "YES", conversationId: 503 },
    setup: () => { h.state.tables.bookings = [BOOKING]; },
    replayEffects: ["sms_orchestrations.insert", "bookings.update_status", "sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["bookings.update"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.reason).toBe("booking_confirmed_automatically");
      expect(r.shouldAutoSend).toBe(true);
      expect(r.body).toContain("confirmed");
    },
  },
  {
    label: "inbound YES from an SMS-suppressed number",
    event: { type: "inbound_sms", phone: "2165550104", body: "YES", conversationId: 504 },
    setup: () => {
      h.state.suppressed = new Set(["2165550104"]);
      h.state.tables.customers = [{ id: 4, firstName: "Kim", lastName: null, smsOptOut: 1, vehicleYear: null, vehicleMake: null, vehicleModel: null }];
    },
    // A replay sees the PRE-event state: the opt-in it skipped never flipped
    // smsOptOut, so the number still reads as opted out and the reply is blocked.
    replayEffects: [
      "sms_orchestrations.insert",
      "sms.markPhoneOptedIn",
      "customers.update_sms_opt_out",
      "complianceLog.logSmsOptIn",
      "sms_orchestrations.insert",
    ],
    liveSignature: ["sms.markPhoneOptedIn"],
    decision: (r) => {
      expect(r.status).toBe("blocked");
      expect(r.statusReason).toBe("customer_opted_out");
      expect(r.shouldAutoSend).toBe(false);
      // The replay script's report puts this real orchestrator output in its
      // own column, not No-Sends (scripts/replay-sms-orchestrator.ts header).
      expect(replayOutcomeBucket(r, { type: "inbound_sms", body: "YES" })).toBe("opt_in_pre_event");
    },
  },
  {
    label: "inbound CANCEL with an active booking",
    event: { type: "inbound_sms", phone: "2165550177", body: "cancel", conversationId: 505 },
    setup: () => { h.state.tables.bookings = [BOOKING]; },
    replayEffects: [
      "sms_orchestrations.insert",
      "bookings.update_status",
      "smsScheduler.cancelBookingReminders",
      "sms.sendSms",
      "sms_orchestrations.insert",
    ],
    liveSignature: ["bookings.update"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.reason).toBe("booking_cancelled_automatically");
      expect(r.body).toContain("cancelled");
    },
  },
  {
    label: "inbound estimate approval",
    event: { type: "inbound_sms", phone: "2165550106", body: "approve", conversationId: 506 },
    setup: () => {
      h.state.tables.alg_estimates = [{ id: 5, externalId: "E-5", serviceDescription: "Front brakes", estimatedAmount: 30000 }];
    },
    replayEffects: ["sms_orchestrations.insert", "emailNotify.sendNotification", "sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["emailNotify.sendNotification"],
    decision: (r) => {
      expect(r.reason).toBe("estimate_approved_automatically");
      expect(r.body).toContain("E-5");
    },
  },
  {
    label: "inbound arrival text",
    event: { type: "inbound_sms", phone: "2165550107", body: "I will be there tomorrow at 9", conversationId: 507 },
    // The arrival capture is reply-neutral: the drafter still answers.
    replayEffects: [
      "sms_orchestrations.insert",
      "expectedArrivals.recordExpectedArrival",
      "nickgpt_drafts.insert",
      "sms.sendSms",
      "sms_orchestrations.insert",
    ],
    liveSignature: ["expectedArrivals.recordExpectedArrival"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.body.length).toBeGreaterThan(0);
    },
  },
  {
    label: "inbound ordinary question (drafter path)",
    event: { type: "inbound_sms", phone: "2165550108", body: "My car makes a clicking noise when I turn left, any idea what that is?", conversationId: 508 },
    replayEffects: ["sms_orchestrations.insert", "nickgpt_drafts.insert", "sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["nickgpt_drafts.insert"],
    decision: (r) => {
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.status).toBe("sent");
    },
  },
  {
    label: "vapi_forwarded_call_followup",
    event: { type: "vapi_forwarded_call_followup", phone: "2165550109", vapiCallId: "call_replay_1" },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.cooldownKey).toMatch(/^vapi_forward:/);
    },
  },
  {
    label: "vapi_confirmation",
    event: { type: "vapi_confirmation", phone: "2165550110", summary: "Booked: 4 used tires, Tuesday morning.", vapiCallId: "call_replay_2" },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.body).toContain("Booked: 4 used tires");
    },
  },
  {
    label: "stale_lead_followup",
    event: { type: "stale_lead_followup", phone: "2165550111", leadId: 9001 },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => { expect(r.status).toBe("sent"); },
  },
  {
    label: "abandoned_form_recovery",
    event: { type: "abandoned_form_recovery", phone: "2165550112", name: "Alex", formType: "tire_quote" },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => { expect(r.status).toBe("sent"); },
  },
  {
    label: "after_hours_capture",
    event: { type: "after_hours_capture", phone: "2165550113", name: "Jordan", captureType: "callback" },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => { expect(r.status).toBe("sent"); },
  },
  {
    label: "booking_reminder",
    event: { type: "booking_reminder", phone: "2165550114", name: "Pat", reminderType: "confirmation-request", service: "Tires", bookingId: 77, refCode: "R77" },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.cooldownKey).toBe("booking_reminder:R77:confirmation-request");
    },
  },
  {
    label: "legacy_passthrough rollout (kill switch)",
    event: { type: "vapi_forwarded_call_followup", phone: "2165550115", vapiCallId: "call_replay_3" },
    setup: () => { h.state.tables.app_secret_kv = [{ v: "legacy_passthrough" }]; },
    replayEffects: ["sms.sendSms", "sms_orchestrations.insert"],
    liveSignature: ["sms.sendSms"],
    decision: (r) => {
      expect(r.status).toBe("sent");
      expect(r.variantKey).toBe("legacy");
    },
  },
];

/** Replay effect names and live mock hits on one vocabulary. */
function normalize(name: string): string {
  if (name.startsWith("sms_orchestrations.")) return "sms_orchestrations.write";
  return name.replace(/^(customers|bookings)\.update_.*$/, "$1.update");
}

describe.each(CASES)("SMS replay isolation: $label", (c) => {
  it("inside runInSmsReplayScope: zero mutating calls, exact skipped effects, decision still produced", async () => {
    c.setup?.();
    const recorder = createSmsEffectRecorder();
    const result = await runInSmsReplayScope(() => orchestrateSms(c.event), recorder);

    expect(h.state.hits).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recorder.names()).toEqual(c.replayEffects);
    // Reads still happen: the decision is computed from real context.
    expect(h.state.reads.length).toBeGreaterThan(0);
    expect(result.id).toBeUndefined();
    expect(typeof result.status).toBe("string");
    expect(typeof result.body).toBe("string");
    expect(typeof result.shouldAutoSend).toBe("boolean");
    c.decision(result);
    // No phone number beyond a 4-digit suffix in any recorded detail.
    expect(JSON.stringify(recorder.effects)).not.toMatch(/\d{7,}/);
  });

  it("positive control: OUTSIDE the scope the same event hits the throwing mocks", async () => {
    c.setup?.();
    // Some live sites are not inside a try/catch (the legacy passthrough
    // send), so a throwing mock can propagate. Only the hit matters here.
    await orchestrateSms(c.event).catch(() => undefined);
    expect(h.state.hits.length).toBeGreaterThan(0);
    for (const sig of c.liveSignature) expect(h.state.hits).toContain(sig);
  });

  it("coverage: live (resolving mocks) performs no effect the replay did not intercept, and vice versa", async () => {
    c.setup?.();
    const recorder = createSmsEffectRecorder();
    await runInSmsReplayScope(() => orchestrateSms(c.event), recorder);
    const replayed = new Set(recorder.names().map(normalize));

    resetState();
    c.setup?.();
    h.state.mode = "resolve";
    await orchestrateSms(c.event);
    const live = new Set(h.state.hits.map(normalize));

    // Production's inbound row gets id 42 here, which unlocks the
    // `if (orchestrationId)` outcome tracking; a replay has no id by design.
    const liveOnlyAllowed = new Set(["smsLearningEngine.trackOrchestrationOutcome"]);
    expect([...live].filter((n) => !replayed.has(n) && !liveOnlyAllowed.has(n))).toEqual([]);
    expect([...replayed].filter((n) => !live.has(n))).toEqual([]);
  });
});

describe("a replay logs body lengths, never message bodies (they carry real first names)", () => {
  // 2026-10-09 review: the shadow and draft_only log lines printed the full
  // orchestrator and legacy bodies, and a replay re-runs up to 300 real rows.
  const MARKER = "Zqxv-marker front brake job";

  async function captureOutput(fn: () => Promise<unknown>): Promise<string> {
    const chunks: string[] = [];
    const capture = (chunk: unknown) => { chunks.push(String(chunk)); return true; };
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(capture as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(capture as typeof process.stderr.write);
    try {
      await fn();
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    return chunks.join("");
  }

  const MODES: Array<{ mode: string; kv: unknown[]; tag: string }> = [
    { mode: "shadow (the non-inbound default)", kv: [], tag: "[Shadow Mode]" },
    { mode: "draft_only", kv: [{ v: "draft_only" }], tag: "[Draft Only Mode]" },
  ];

  it.each(MODES)("$mode: inside the scope the log has the line but not the body", async ({ kv, tag }) => {
    h.state.tables.app_secret_kv = kv;
    const event: SmsOrchestratorEvent = { type: "vapi_confirmation", phone: "2165550121", summary: MARKER, vapiCallId: "call_log_1" };
    let result: SmsOrchestratorResult | undefined;
    const out = await captureOutput(async () => {
      result = await runInSmsReplayScope(() => orchestrateSms(event), createSmsEffectRecorder());
    });
    // The decision still carries the body; only the log is bounded.
    expect(result?.body).toContain(MARKER);
    expect(out).toContain(tag);
    expect(out).toMatch(/\(\d+ chars\)/);
    expect(out).not.toContain(MARKER);
  });

  it.each(MODES)("$mode: control, live logging is unchanged and still prints the body", async ({ kv, tag }) => {
    h.state.tables.app_secret_kv = kv;
    h.state.mode = "resolve";
    const event: SmsOrchestratorEvent = { type: "vapi_confirmation", phone: "2165550122", summary: MARKER, vapiCallId: "call_log_2" };
    const out = await captureOutput(() => orchestrateSms(event));
    expect(out).toContain(tag);
    expect(out).toContain(MARKER);
  });
});

describe("the legacy REPLAY_DRY_RUN flag", () => {
  it("now suppresses every write, not just the send (no scope, no recorder)", async () => {
    process.env.REPLAY_DRY_RUN = "true";
    h.state.tables.bookings = [BOOKING];
    const result = await orchestrateSms({ type: "inbound_sms", phone: "2165550177", body: "cancel", conversationId: 509 });
    expect(h.state.hits).toEqual([]);
    expect(result.reason).toBe("booking_cancelled_automatically");
  });

  it("control: unset, the same event writes", async () => {
    h.state.tables.bookings = [BOOKING];
    await orchestrateSms({ type: "inbound_sms", phone: "2165550177", body: "cancel", conversationId: 510 });
    expect(h.state.hits).toContain("bookings.update");
  });
});

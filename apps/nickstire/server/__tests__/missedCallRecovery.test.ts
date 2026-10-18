/**
 * Missed-call recovery eligibility (Wave F). The DB/send path is
 * integration-level; these lock the pure rule that decides WHO gets a
 * follow-up text — the part that must never be wrong on a live outbound
 * SMS channel.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { isMissedCallEligible, processMissedCallRecovery, type MissedCallRow } from "../cron/jobs/missedCallRecovery";

const h = vi.hoisted(() => ({
  callRows: [] as Array<Record<string, unknown>>,
  optOutPhones: [] as string[],
  evidence: {} as Record<string, Record<string, unknown>>,
  evidenceCalls: [] as string[],
  sent: [] as string[],
  dbThrows: false,
  hold: null as string | null,
  holdLanes: [] as string[],
  flipAfterFirstSend: false,
  claims: 0, // recoverySmsAt claims only
  sources: [] as string[],
  // callback lane (C3.3)
  callbackClaims: [] as Array<{ sql: string; params: unknown[] }>,
  callbackClaimAffected: [] as number[], // queued affectedRows for $.recoveryCallbackAt claims; default 1
  callbackRows: [] as Array<Record<string, unknown>>,
  callbackInsertThrowsFor: new Set<string>(), // phone numbers whose insert rejects
  warns: [] as Array<{ msg: string; ctx: unknown }>,
  telegrams: [] as string[],
}));

const dialect = new MySqlDialect();

vi.mock("../lib/logger", () => {
  const logger = {
    debug: () => undefined, info: () => undefined, error: () => undefined, fatal: () => undefined,
    warn: (msg: string, ctx?: unknown) => { h.warns.push({ msg, ctx }); },
    child: () => logger,
  };
  return { createLogger: () => logger };
});

// The real reader is pinned in sendPause.test.ts; this file's db mock has no getDb.
vi.mock("../services/sendPause", () => ({
  sendPauseHoldReason: async (lane: string) => {
    h.holdLanes.push(lane);
    return h.hold;
  },
}));

vi.mock("../db", () => ({
  getDbTyped: async () => ({
    select: () => ({
      from: () => ({
        // calls query: .where().orderBy().limit(); opt-out query: await .where()
        where: () => Object.assign(Promise.resolve(h.optOutPhones.map((phone) => ({ phone }))), {
          orderBy: () => ({
            limit: async () => {
              if (h.dbThrows) throw new Error("ER_CON_COUNT_ERROR");
              return h.callRows;
            },
          }),
        }),
      }),
    }),
    // the at-most-once claims: $.recoverySmsAt (text lane) or $.recoveryCallbackAt (callback lane)
    execute: async (q: unknown) => {
      const rendered = dialect.sqlToQuery(q as never);
      if (rendered.sql.includes("$.recoveryCallbackAt")) {
        h.callbackClaims.push(rendered);
        return [{ affectedRows: h.callbackClaimAffected.shift() ?? 1 }];
      }
      h.claims++;
      return [{ affectedRows: 1 }];
    },
  }),
  createCallbackRequest: async (data: Record<string, unknown>) => {
    if (h.callbackInsertThrowsFor.has(String(data.phone))) throw new Error("ER_LOCK_WAIT_TIMEOUT");
    h.callbackRows.push(data);
    return { success: true, id: h.callbackRows.length };
  },
}));
vi.mock("../services/featureFlags", () => ({ isEnabled: async () => true }));
vi.mock("../services/vapiActionExtraction", () => ({
  loadCallCaptureEvidence: async (callId: string) => {
    h.evidenceCalls.push(callId);
    return h.evidence[callId] ?? {};
  },
}));
vi.mock("../services/smsOrchestrator", () => ({
  orchestrateSms: async (input: { vapiCallId: string; source?: string }) => {
    h.sent.push(input.vapiCallId);
    h.sources.push(input.source ?? "(none)");
    if (h.flipAfterFirstSend) h.hold = "send_pause:missed_call_recovery";
    return { status: "sent" };
  },
}));
vi.mock("../services/telegram", () => ({ sendTelegram: async (text: string) => { h.telegrams.push(text); } }));

const T0 = 1_790_000_000_000;
const MIN = 60 * 1000;

const base = (over: Partial<MissedCallRow> = {}): MissedCallRow => ({
  id: 1,
  vapiCallId: "call-1",
  phoneNumber: "2165551234",
  durationSeconds: 40,
  convertedToLead: 0,
  leadId: null,
  callbackId: null,
  recoveryAlreadyStamped: false,
  createdAtMs: T0 - 90 * MIN, // 90 min ago → inside [45min, 24h]
  ...over,
});

describe("isMissedCallEligible", () => {
  it("eligible: unconverted real call, in the window, not yet recovered", () => {
    expect(isMissedCallEligible(base(), T0)).toBe(true);
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 45 * MIN }), T0)).toBe(true); // lower edge
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 24 * 60 * MIN }), T0)).toBe(true); // upper edge
  });

  it("NOT eligible without a phone number", () => {
    expect(isMissedCallEligible(base({ phoneNumber: null }), T0)).toBe(false);
  });

  it("NOT eligible if the call was captured (lead or callback)", () => {
    expect(isMissedCallEligible(base({ leadId: 7 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ callbackId: 9 }), T0)).toBe(false);
  });

  it("a call that reached a tool is eligible ONLY with proof it captured nothing (2026-10-02)", () => {
    expect(isMissedCallEligible(base({ convertedToLead: 1 }), T0)).toBe(false); // not read
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: false }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true }), T0)).toBe(true);
    // proof never overrides the other rules
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true, leadId: 3 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true, recoveryAlreadyStamped: true }), T0)).toBe(false);
  });

  it("NOT eligible once a recovery text was already stamped (one-shot)", () => {
    expect(isMissedCallEligible(base({ recoveryAlreadyStamped: true }), T0)).toBe(false);
  });

  it("NOT eligible for hangups / robocalls (< 15s)", () => {
    expect(isMissedCallEligible(base({ durationSeconds: 14 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ durationSeconds: 3 }), T0)).toBe(false);
  });

  it("NOT eligible too soon (< 45 min — shop's own callback goes first) or too old (> 24h)", () => {
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 30 * MIN }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 25 * 60 * MIN }), T0)).toBe(false);
  });
});

describe("processMissedCallRecovery · tool-reaching callers", () => {
  const ORIGINAL_SEND = process.env.MISSED_CALL_RECOVERY_SEND;
  const NOW = new Date("2026-10-02T18:00:00Z"); // 14:00 Cleveland — inside 9-17
  const call = (vapiCallId: string, convertedToLead: number) => ({
    id: vapiCallId.length, vapiCallId, phoneNumber: `21655501${vapiCallId.length}0`, durationSeconds: 40,
    convertedToLead, leadId: null, callbackId: null, metadata: null,
    createdAt: new Date(NOW.getTime() - 90 * MIN),
  });

  beforeEach(() => {
    // Only Date is faked: this path has no timers to race.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.MISSED_CALL_RECOVERY_SEND = "1";
    h.callRows = [];
    h.evidence = {};
    h.evidenceCalls = [];
    h.sent = [];
    h.dbThrows = false;
    h.hold = null;
    h.holdLanes = [];
    h.flipAfterFirstSend = false;
    h.claims = 0;
    h.sources = [];
    h.optOutPhones = [];
    h.callbackClaims = [];
    h.callbackClaimAffected = [];
    h.callbackRows = [];
    h.callbackInsertThrowsFor = new Set();
    h.warns = [];
    h.telegrams = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SEND === undefined) delete process.env.MISSED_CALL_RECOVERY_SEND;
    else process.env.MISSED_CALL_RECOVERY_SEND = ORIGINAL_SEND;
  });

  it("texts a tool-reaching caller only when the evidence read proves nothing was captured", async () => {
    h.callRows = [
      call("plain", 0), // never reached a tool → eligible, no evidence read needed
      call("tool-nothing", 1), // tire-price lookup, nothing saved → eligible
      call("tool-readfail", 1), // evidence read failed ({}) → unknown → skipped
      call("tool-arrival", 1), // bookSlot recorded a walk-in commitment → skipped
      call("tool-callbackrow", 1), // escalate wrote a callback_requests row naming the call → skipped
    ];
    const nothing = { reachedTool: true, leadId: null, callbackId: null, existingCallbackForCall: false, hasExpectedArrival: false };
    h.evidence = {
      "tool-nothing": nothing,
      "tool-arrival": { ...nothing, hasExpectedArrival: true },
      "tool-callbackrow": { ...nothing, existingCallbackForCall: true },
    };

    const out = await processMissedCallRecovery();

    expect(h.sent.sort()).toEqual(["plain", "tool-nothing"]);
    expect(out).toMatchObject({ shadow: false, candidates: 2, recordsProcessed: 2 });
    // the evidence read runs for tool-reaching calls only
    expect(h.evidenceCalls.sort()).toEqual(["tool-arrival", "tool-callbackrow", "tool-nothing", "tool-readfail"]);
  });

  it.each(["send_pause:missed_call_recovery", "send_pause_unreadable:missed_call_recovery"])(
    "C5.5: armed but held (%s) -> shadow outcome with the reason, nothing read, claimed or sent",
    async (reason) => {
      h.hold = reason;
      h.dbThrows = true; // the call-log read must not even be reached
      h.callRows = [call("plain", 0)];
      const out = await processMissedCallRecovery();
      expect(h.holdLanes).toEqual(["missed_call_recovery"]);
      expect(out).toEqual({ recordsProcessed: 0, shadow: true, candidates: 0, details: `Skipped · ${reason}` });
      expect(h.sent).toEqual([]);
    },
  );

  it("C5.5 control: not held -> the same armed run sends", async () => {
    h.callRows = [call("plain", 0)];
    const out = await processMissedCallRecovery();
    // start gate + one per-item check (round 2), always this lane
    expect(new Set(h.holdLanes)).toEqual(new Set(["missed_call_recovery"]));
    expect(h.sent).toEqual(["plain"]);
    expect(out).toMatchObject({ shadow: false, recordsProcessed: 1 });
  });

  it("C5.5 round 2: pause set mid-run -> the next caller is neither claimed nor texted; Skipped with the count", async () => {
    h.callRows = [call("a", 0), call("bb", 0), call("ccc", 0)];
    h.flipAfterFirstSend = true;
    const out = await processMissedCallRecovery();
    expect(h.sent).toHaveLength(1);
    expect(h.claims, "a held caller is not stamped recoverySmsAt").toBe(1);
    expect(out.recordsProcessed).toBe(1);
    expect(out.details).toMatch(/^Skipped · send_pause:missed_call_recovery/);
    expect(out.details).toContain("not_attempted=2");
  });

  it("C5.5 round 2 control: never paused -> all three callers texted", async () => {
    h.callRows = [call("a", 0), call("bb", 0), call("ccc", 0)];
    const out = await processMissedCallRecovery();
    expect(h.sent).toHaveLength(3);
    // the durable key the delayed-queue drain maps back to this lane
    expect(h.sources).toEqual(["missed_call_recovery", "missed_call_recovery", "missed_call_recovery"]);
    expect(out.details ?? "").not.toMatch(/send_pause/);
  });

  it("a failed run THROWS (cron_log records failed), never a completed 'shadow' zero", async () => {
    h.dbThrows = true;
    await expect(processMissedCallRecovery()).rejects.toThrow(/ER_CON_COUNT_ERROR/);
    expect(h.sent).toEqual([]);
  });

  // ─── C3.3: a caller the cron will NOT text gets a callback_requests row ───
  // The same LIKE rule loadCallCaptureEvidence (vapiActionExtraction.ts) uses to
  // decide "a callback request cites this call", so a later run treats it as captured.
  const citesCall = (context: unknown, callId: string) =>
    typeof context === "string" && context.includes(`callId=${callId}`);
  const numbered = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: 100 + i, vapiCallId: `call-${i}`, phoneNumber: `2165550${100 + i}`, durationSeconds: 40,
    convertedToLead: 0, leadId: null, callbackId: null, metadata: null,
    createdAt: new Date(NOW.getTime() - 90 * MIN),
  }));

  it("(a) LIVE opt-out caller: exactly one callback row citing the call, no text; the plain caller is texted", async () => {
    const opt = call("opt", 0);
    h.callRows = [opt, call("plain", 0)];
    h.optOutPhones = [opt.phoneNumber];
    const out = await processMissedCallRecovery();

    expect(h.sent).toEqual(["plain"]);
    expect(h.callbackRows).toHaveLength(1);
    const row = h.callbackRows[0]!;
    expect(row).toMatchObject({ phone: opt.phoneNumber, sourcePage: "missed-call-recovery", status: "new" });
    expect(citesCall(row.context, "opt")).toBe(true);
    expect(String(row.context)).toMatch(/40s/);
    expect(String(row.context)).toMatch(/opted out of SMS/);
    expect(String(row.name).length).toBeLessThanOrEqual(255);
    expect(out).toMatchObject({ shadow: false, recordsProcessed: 1, callbackRows: 1 });
    expect(h.telegrams.join("\n")).toMatch(/1 opt-out callers? routed to callbacks/);
    // CAS: the claim is conditional on the callback key still being NULL, pinned to this row
    expect(h.callbackClaims).toHaveLength(1);
    expect(h.callbackClaims[0]!.sql).toMatch(/WHERE id = \?/);
    expect(h.callbackClaims[0]!.sql).toMatch(/JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\) IS NULL/);
    expect(h.callbackClaims[0]!.params).toContain(opt.id);
  });

  it("(b)+(c) SHADOW: one row per candidate up to RUN_CAP (15), cap-skips get none, nothing is texted", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    h.callRows = numbered(17);
    const out = await processMissedCallRecovery();

    expect(h.sent).toEqual([]);
    expect(h.claims, "shadow never stamps recoverySmsAt").toBe(0);
    expect(h.callbackRows).toHaveLength(15);
    const cited = h.callbackRows.map((r) => String(r.context).match(/callId=(call-\d+)/)?.[1]);
    expect(cited).toEqual(Array.from({ length: 15 }, (_, i) => `call-${i}`));
    // (c) the two callers past the cap: no claim, no row (the next run retries them)
    expect(cited).not.toContain("call-15");
    expect(cited).not.toContain("call-16");
    expect(h.callbackClaims).toHaveLength(15);
    for (const r of h.callbackRows) expect(String(r.context)).toMatch(/shadow mode/);
    expect(out).toMatchObject({ shadow: true, recordsProcessed: 0, candidates: 17, callbackRows: 15 });
    expect(h.telegrams.join("\n")).toMatch(/15 callback rows written for the shop/);
  });

  it("(c) LIVE: candidates past RUN_CAP get no callback row (they are not opted out; the next run texts them)", async () => {
    h.callRows = numbered(17);
    const out = await processMissedCallRecovery();
    expect(h.sent).toHaveLength(15);
    expect(h.callbackRows).toEqual([]);
    expect(h.callbackClaims).toEqual([]);
    expect(out).toMatchObject({ callbackRows: 0 });
  });

  it("SHADOW opt-out caller also gets a row (both modes), worded as an opt-out", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    const opt = call("opt", 0);
    h.callRows = [opt];
    h.optOutPhones = [opt.phoneNumber];
    const out = await processMissedCallRecovery();
    expect(h.callbackRows).toHaveLength(1);
    expect(String(h.callbackRows[0]!.context)).toMatch(/opted out of SMS/);
    expect(out).toMatchObject({ shadow: true, candidates: 0, callbackRows: 1 });
  });

  it("(d) a second run for the same call writes no second row (CAS claim returned 0)", async () => {
    const opt = call("opt", 0);
    h.callRows = [opt];
    h.optOutPhones = [opt.phoneNumber];
    h.callbackClaimAffected = [1, 0]; // run 1 wins the claim; run 2 finds it stamped
    const first = await processMissedCallRecovery();
    const second = await processMissedCallRecovery();
    expect(h.callbackClaims).toHaveLength(2);
    expect(h.callbackRows).toHaveLength(1);
    expect(first).toMatchObject({ callbackRows: 1 });
    expect(second).toMatchObject({ callbackRows: 0 });
  });

  it("(e) a failing callback insert is logged with the call id and the run continues", async () => {
    const opt = call("opt", 0);
    const opt2 = call("opt2", 0);
    h.callRows = [opt, opt2, call("plain", 0)];
    h.optOutPhones = [opt.phoneNumber, opt2.phoneNumber];
    h.callbackInsertThrowsFor = new Set([opt.phoneNumber]);
    const out = await processMissedCallRecovery();

    expect(h.sent, "the text lane still runs").toEqual(["plain"]);
    expect(h.callbackRows).toHaveLength(1);
    expect(citesCall(h.callbackRows[0]!.context, "opt2")).toBe(true);
    const warn = h.warns.find((w) => /callback/i.test(w.msg));
    expect(warn, "insert failure is logged").toBeDefined();
    expect(JSON.stringify(warn!.ctx)).toContain('"opt"');
    expect(JSON.stringify(warn!.ctx)).not.toContain(opt.phoneNumber); // no raw phone in logs
    // the won claim is released (pinned to its own stamp) so the next run can retry the row
    const release = h.callbackClaims.find((q) => /JSON_REMOVE/.test(q.sql));
    expect(release, "claim released after a failed insert").toBeDefined();
    expect(release!.sql).toMatch(/WHERE id = \?\s+AND JSON_UNQUOTE\(JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\)\) = \?/);
    expect(release!.params).toContain(opt.id);
    expect(out).toMatchObject({ shadow: false, recordsProcessed: 1, callbackRows: 1 });
  });
});

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
  callbackClaims: [] as Array<{ sql: string; params: unknown[] }>, // claim / reclaim swaps only
  callbackWrites: [] as Array<{ kind: "rowId" | "release"; sql: string; params: unknown[] }>,
  callbackClaimAffected: [] as number[], // queued affectedRows for $.recoveryCallbackAt claims; default 1
  releaseThrows: false,
  callbackRows: [] as Array<Record<string, unknown>>,
  callbackInsertThrowsFor: new Map<string, Error>(), // phone -> the error its insert rejects with
  index: null as null | Record<string, unknown>, // sms.ts loadSuppressionIndex() answer
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
      if (/JSON_REMOVE\(metadata, '\$\.recoveryCallbackAt'\)/.test(rendered.sql)) {
        h.callbackWrites.push({ kind: "release", ...rendered });
        if (h.releaseThrows) throw new Error("ER_LOCK_WAIT_TIMEOUT");
        return [{ affectedRows: 1 }];
      }
      if (rendered.sql.includes("'$.recoveryCallbackRowId', ?")) {
        h.callbackWrites.push({ kind: "rowId", ...rendered });
        return [{ affectedRows: 1 }];
      }
      if (rendered.sql.includes("$.recoveryCallbackAt")) {
        h.callbackClaims.push(rendered);
        return [{ affectedRows: h.callbackClaimAffected.shift() ?? 1 }];
      }
      h.claims++;
      return [{ affectedRows: 1 }];
    },
  }),
  createCallbackRequest: async (data: Record<string, unknown>) => {
    const err = h.callbackInsertThrowsFor.get(String(data.phone));
    if (err) throw err;
    h.callbackRows.push(data);
    return { success: true, id: 500 + h.callbackRows.length };
  },
}));
// Partial on purpose: override one export, keep the real module (AGENTS.md: shared serial process).
vi.mock("../sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sms")>()),
  loadSuppressionIndex: async () => h.index,
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
    h.callbackWrites = [];
    h.callbackClaimAffected = [];
    h.releaseThrows = false;
    h.callbackRows = [];
    h.callbackInsertThrowsFor = new Map();
    h.index = { ok: true, phones: new Set(), carrierBlocked: new Set(), voiceOnly: new Set(), stale: false };
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
  const numbered = (n: number, meta: (i: number) => Record<string, unknown> | null = () => null) =>
    Array.from({ length: n }, (_, i) => ({
      id: 100 + i, vapiCallId: `call-${i}`, phoneNumber: `2165550${100 + i}`, durationSeconds: 40,
      convertedToLead: 0, leadId: null, callbackId: null, metadata: meta(i),
      createdAt: new Date(NOW.getTime() - 90 * MIN),
    }));
  const cited = () => h.callbackRows.map((r) => String(r.context).match(/callId=([\w-]+)/)?.[1]);
  const idx = () => h.index as { phones: Set<string>; carrierBlocked: Set<string>; voiceOnly: Set<string> };
  const p10 = (p: string) => p.replace(/\D/g, "").slice(-10);
  const ago = (min: number) => new Date(NOW.getTime() - min * MIN).toISOString();

  it("(a) LIVE carrier-blocked caller (SMS-only suppression): one callback row citing the call, no text", async () => {
    const blocked = call("blk", 0);
    h.callRows = [blocked, call("plain", 0)];
    idx().carrierBlocked.add(p10(blocked.phoneNumber));
    const out = await processMissedCallRecovery();

    expect(h.sent).toEqual(["plain"]);
    expect(h.callbackRows).toHaveLength(1);
    const row = h.callbackRows[0]!;
    expect(row).toMatchObject({ phone: blocked.phoneNumber, sourcePage: "missed-call-recovery", status: "new" });
    expect(citesCall(row.context, "blk")).toBe(true);
    expect(String(row.context)).toMatch(/40s/);
    expect(String(row.context)).toMatch(/carrier blocks texts/);
    expect(out).toMatchObject({ shadow: false, recordsProcessed: 1, callbackRows: 1 });
    expect(h.telegrams.join("\n")).toMatch(/1 carrier-blocked callers? routed to callbacks/);
    // CAS: conditional on the callback key still being NULL, pinned to this row
    expect(h.callbackClaims).toHaveLength(1);
    expect(h.callbackClaims[0]!.sql).toMatch(/WHERE id = \?/);
    expect(h.callbackClaims[0]!.sql).toMatch(/JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\) IS NULL/);
    expect(h.callbackClaims[0]!.params).toContain(blocked.id);
    // the won claim is completed with the inserted id, pinned to our own stamp
    const rowId = h.callbackWrites.find((w) => w.kind === "rowId");
    expect(rowId, "recoveryCallbackRowId written after the insert").toBeDefined();
    expect(rowId!.params).toContain(501);
    expect(rowId!.sql).toMatch(/JSON_UNQUOTE\(JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\)\) = \?/);
  });

  it("(a') opt-out callers are FULL contact suppression (sms.ts index): no row, no text, in either mode", async () => {
    for (const mode of ["live", "shadow"] as const) {
      if (mode === "shadow") delete process.env.MISSED_CALL_RECOVERY_SEND;
      h.callbackRows = []; h.callbackClaims = []; h.sent = [];
      const opt = call("opt", 0);
      h.callRows = [opt];
      h.optOutPhones = [opt.phoneNumber]; // customers.smsOptOut = 1
      idx().phones.add(p10(opt.phoneNumber)); // ... which the index reads as stop-everything
      const out = await processMissedCallRecovery();
      expect(h.sent, mode).toEqual([]);
      expect(h.callbackRows, mode).toEqual([]);
      expect(h.callbackClaims, mode).toEqual([]);
      expect(out, mode).toMatchObject({ callbackRows: 0 });
    }
  });

  it("(a'') SHADOW: a candidate the index suppresses (text STOP, or spoken voice opt-out) gets no row; an open one does", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    const [stop, voice, open] = numbered(3);
    h.callRows = [stop!, voice!, open!];
    idx().phones.add(p10(stop!.phoneNumber)); // sms_preferences STOP, no customers row
    idx().phones.add(p10(voice!.phoneNumber)); // spoken "stop calling me"
    idx().voiceOnly.add(p10(voice!.phoneNumber));
    const out = await processMissedCallRecovery();
    expect(cited()).toEqual(["call-2"]);
    expect(out).toMatchObject({ shadow: true, callbackRows: 1 });
  });

  it("(a''') an unreadable suppression index writes no rows (unknown scope is never 'callable')", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    h.index = { ok: false, reason: "database unavailable" };
    h.callRows = numbered(2);
    const out = await processMissedCallRecovery();
    expect(h.callbackRows).toEqual([]);
    expect(h.callbackClaims).toEqual([]);
    expect(out).toMatchObject({ shadow: true, candidates: 2, callbackRows: 0 });
  });

  it("the ../sms mock overrides loadSuppressionIndex only: every other export stays real for a file sharing this process", async () => {
    const sms = await import("../sms");
    expect(typeof sms.carrierBlockedPhones).toBe("function");
    expect(typeof sms.sendSms).toBe("function");
    expect(typeof sms.markPhoneFullyOptedOut).toBe("function");
    expect(await sms.loadSuppressionIndex()).toBe(h.index); // and the override is the one in use
  });

  it("(a'''') a STALE index (refresh failed after an earlier load) writes no rows: it can miss a newer opt-out", async () => {
    for (const mode of ["live", "shadow"] as const) {
      if (mode === "shadow") delete process.env.MISSED_CALL_RECOVERY_SEND;
      h.callbackRows = []; h.callbackClaims = []; h.sent = [];
      h.index = { ok: true, phones: new Set(), carrierBlocked: new Set(), voiceOnly: new Set(), stale: true };
      const blocked = call("blk", 0);
      h.callRows = [blocked, ...numbered(2)];
      idx().carrierBlocked.add(p10(blocked.phoneNumber));
      const out = await processMissedCallRecovery();
      expect(h.callbackRows, mode).toEqual([]);
      expect(h.callbackClaims, mode).toEqual([]);
      expect(out, mode).toMatchObject({ callbackRows: 0 });
    }
  });

  it("(b)+(c) SHADOW: one row per candidate up to RUN_CAP (15), cap-skips get none, nothing is texted", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    h.callRows = numbered(17);
    const out = await processMissedCallRecovery();

    expect(h.sent).toEqual([]);
    expect(h.claims, "shadow never stamps recoverySmsAt").toBe(0);
    expect(h.callbackRows).toHaveLength(15);
    expect(cited()).toEqual(Array.from({ length: 15 }, (_, i) => `call-${i}`));
    // (c) the two callers past the cap: no claim, no row (the next run retries them)
    expect(cited()).not.toContain("call-15");
    expect(cited()).not.toContain("call-16");
    expect(h.callbackClaims).toHaveLength(15);
    for (const r of h.callbackRows) expect(String(r.context)).toMatch(/shadow mode/);
    expect(out).toMatchObject({ shadow: true, recordsProcessed: 0, candidates: 17, callbackRows: 15 });
    expect(h.telegrams.join("\n")).toContain("15 callback rows written for the shop (Admin > Calls > Missed / Pending)");
  });

  it("(c) LIVE: candidates past RUN_CAP get no callback row (they are not suppressed; the next run texts them)", async () => {
    h.callRows = numbered(17);
    const out = await processMissedCallRecovery();
    expect(h.sent).toHaveLength(15);
    expect(h.callbackRows).toEqual([]);
    expect(h.callbackClaims).toEqual([]);
    expect(out).toMatchObject({ callbackRows: 0 });
  });

  it("(f) SHADOW no starvation: 20 eligible, the newest 15 already have a row -> the 5 older callers get rows", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    h.callRows = numbered(20, (i) => (i < 15 ? { recoveryCallbackAt: ago(10), recoveryCallbackRowId: 900 + i } : null));
    const out = await processMissedCallRecovery();
    expect(cited()).toEqual(["call-15", "call-16", "call-17", "call-18", "call-19"]);
    expect(h.callbackClaims, "handled rows are not even re-claimed").toHaveLength(5);
    expect(out).toMatchObject({ candidates: 20, callbackRows: 5 });
  });

  it("(d) a second run for the same call writes no second row (CAS claim returned 0)", async () => {
    const blocked = call("blk", 0);
    h.callRows = [blocked];
    idx().carrierBlocked.add(p10(blocked.phoneNumber));
    h.callbackClaimAffected = [1, 0]; // run 1 wins the claim; run 2 finds it stamped
    const first = await processMissedCallRecovery();
    const second = await processMissedCallRecovery();
    expect(h.callbackClaims).toHaveLength(2);
    expect(h.callbackRows).toHaveLength(1);
    expect(first).toMatchObject({ callbackRows: 1 });
    expect(second).toMatchObject({ callbackRows: 0 });
  });

  it("(g) orphaned claim: a stale stamp with no row id is reclaimed on the OLD stamp; fresh or completed stamps are not", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    const stale = ago(90);
    h.callRows = numbered(3, (i) => [
      { recoveryCallbackAt: stale }, // insert + release both failed on an earlier run
      { recoveryCallbackAt: ago(10) }, // another run is mid-insert
      { recoveryCallbackAt: stale, recoveryCallbackRowId: 77 }, // done
    ][i]!);
    const out = await processMissedCallRecovery();
    expect(cited()).toEqual(["call-0"]);
    expect(h.callbackClaims).toHaveLength(1);
    const reclaim = h.callbackClaims[0]!;
    expect(reclaim.sql).toMatch(/JSON_UNQUOTE\(JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\)\) = \?/);
    expect(reclaim.sql).toMatch(/JSON_EXTRACT\(metadata, '\$\.recoveryCallbackRowId'\) IS NULL/);
    expect(reclaim.sql).not.toMatch(/'\$\.recoveryCallbackAt'\) IS NULL/);
    expect(reclaim.params).toContain(stale);
    expect(reclaim.params).toContain(100);
    expect(out).toMatchObject({ callbackRows: 1 });
  });

  it("(h) an unusable caller id ('anonymous', short placeholder) gets no claim, no row and does not consume the cap", async () => {
    delete process.env.MISSED_CALL_RECOVERY_SEND;
    const anon = { ...call("anon", 0), id: 1, vapiCallId: "anon", phoneNumber: "anonymous" };
    const short = { ...call("short", 0), id: 2, vapiCallId: "short", phoneNumber: "1234" };
    h.callRows = [anon, short, ...numbered(15)];
    const out = await processMissedCallRecovery();
    expect(cited()).toEqual(Array.from({ length: 15 }, (_, i) => `call-${i}`));
    expect(h.callbackClaims.some((q) => q.params.includes(1) || q.params.includes(2))).toBe(false);
    expect(out).toMatchObject({ candidates: 17, callbackRows: 15 }); // still candidates for the text lane
  });

  it("(e) a failing callback insert logs the call id (never the driver message) and the run continues", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const a = call("blk", 0);
    const b = call("blk2", 0);
    h.callRows = [a, b, call("plain", 0)];
    idx().carrierBlocked.add(p10(a.phoneNumber));
    idx().carrierBlocked.add(p10(b.phoneNumber));
    // drizzle's real wrapper: its message is the SQL plus the bound params (a phone here)
    const cause = Object.assign(new Error("Lock wait timeout"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    h.callbackInsertThrowsFor = new Map([[a.phoneNumber, new DrizzleQueryError("insert into `callback_requests` values (?, ?)", ["Missed call", "2165550199"], cause)]]);
    h.releaseThrows = true; // and the release fails too: the stamp is orphaned (see g)
    const out = await processMissedCallRecovery();

    expect(h.sent, "the text lane still runs").toEqual(["plain"]);
    expect(cited()).toEqual(["blk2"]);
    const warns = h.warns.filter((w) => /callback/i.test(w.msg));
    expect(warns.length, "insert failure and release failure are both logged").toBe(2);
    expect(JSON.stringify(warns[0]!.ctx)).toContain('"blk"');
    expect(JSON.stringify(warns[0]!.ctx)).toContain("ER_LOCK_WAIT_TIMEOUT");
    const logged = JSON.stringify(h.warns);
    expect(logged).not.toContain("2165550199"); // the param inside the driver message
    expect(logged).not.toContain(a.phoneNumber); // no raw phone in logs
    // the won claim is released (pinned to its own stamp) so the next run can retry the row
    const release = h.callbackWrites.find((w) => w.kind === "release");
    expect(release, "claim released after a failed insert").toBeDefined();
    expect(release!.sql).toMatch(/WHERE id = \?\s+AND JSON_UNQUOTE\(JSON_EXTRACT\(metadata, '\$\.recoveryCallbackAt'\)\) = \?/);
    expect(release!.params).toContain(a.id);
    expect(out).toMatchObject({ shadow: false, recordsProcessed: 1, callbackRows: 1 });
  });
});

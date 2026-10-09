/**
 * smsReplayScope: the gate between an SMS replay and production state.
 *
 * 2026-10-09 (autoresearch audit, SMS replay isolation). Each guard here is
 * tested twice: the unbroken path passes, and a deliberately broken input or
 * dependency makes it FAIL (AGENTS.md "ship the canary, not just the control").
 * Behaviour only: nothing here asserts that a function merely exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  REPLAY_ENV_ONLY_ALARM_ID,
  REPLAY_FAKE_SEND_SID,
  REPLAY_PRODUCTION_READ_ACK_FLAG,
  __resetReplayEnvAlarmForTests,
  createSmsEffectRecorder,
  evaluateReplayIsolation,
  flushThenExit,
  hasProductionReadAck,
  installDenyAllFetch,
  isPreEventOptInReplay,
  isSmsReplayActive,
  readLeakCount,
  replayLeakCheckQuery,
  replayOutcomeBucket,
  replayPhoneCountQuery,
  replayPhoneKeys,
  replayScopeSelfTest,
  runInSmsReplayScope,
  smsEffect,
  truncateForPrint,
  type ReplayPhoneDelta,
  type ReplayPhoneTable,
} from "./smsReplayScope";

const ORIGINAL_REPLAY_DRY_RUN = process.env.REPLAY_DRY_RUN;

beforeEach(() => {
  delete process.env.REPLAY_DRY_RUN;
});

afterEach(() => {
  if (ORIGINAL_REPLAY_DRY_RUN === undefined) delete process.env.REPLAY_DRY_RUN;
  else process.env.REPLAY_DRY_RUN = ORIGINAL_REPLAY_DRY_RUN;
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("smsEffect outside a replay is a transparent pass-through", () => {
  it("returns run()'s own value, calling it exactly once", () => {
    let calls = 0;
    const out = smsEffect("x", () => { calls++; return 7; }, 0);
    expect(out).toBe(7);
    expect(calls).toBe(1);
  });

  it("returns the SAME promise object (no await added, timing unchanged)", () => {
    const p = Promise.resolve("live");
    expect(smsEffect("x", () => p, "replay")).toBe(p);
  });

  it("a synchronous throw surfaces synchronously, so the caller's try/catch still sees it", () => {
    let caught: unknown = null;
    try {
      smsEffect("x", () => { throw new Error("boom"); }, undefined);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error)?.message).toBe("boom");
  });

  it("isSmsReplayActive is false with no scope and no flag", () => {
    expect(isSmsReplayActive()).toBe(false);
  });
});

describe("smsEffect inside runInSmsReplayScope never runs the effect", () => {
  it("skips run, records the name, returns the value fallback", () => {
    const recorder = createSmsEffectRecorder();
    let ran = false;
    const out = runInSmsReplayScope(
      () => smsEffect("bookings.update_status", () => { ran = true; return "wrote"; }, "skipped", { bookingId: 7 }),
      recorder,
    );
    expect(ran).toBe(false);
    expect(out).toBe("skipped");
    expect(recorder.effects).toEqual([{ name: "bookings.update_status", detail: { bookingId: 7 } }]);
  });

  it("a thunk fallback is called once and its value returned (array shape for [row] destructuring)", () => {
    let thunkCalls = 0;
    const [row] = runInSmsReplayScope(() =>
      smsEffect("sms_orchestrations.insert", () => [{ id: 1 }], () => { thunkCalls++; return [] as { id: number }[]; }),
    );
    expect(thunkCalls).toBe(1);
    expect(row).toBeUndefined();
  });

  it("a run() that would throw is not called (so it cannot throw)", () => {
    const out = runInSmsReplayScope(() => smsEffect("x", () => { throw new Error("must not run"); }, "ok"));
    expect(out).toBe("ok");
  });

  it("follows the async context through awaits, .then chains and timers", async () => {
    const recorder = createSmsEffectRecorder();
    let ran = 0;
    await runInSmsReplayScope(async () => {
      await tick();
      smsEffect("after_await", () => { ran++; }, undefined);
      await Promise.resolve().then(() => smsEffect("in_then", () => { ran++; }, undefined));
      await new Promise<void>((resolve) => setTimeout(() => { smsEffect("in_timer", () => { ran++; }, undefined); resolve(); }, 0));
    }, recorder);
    expect(ran).toBe(0);
    expect(recorder.names()).toEqual(["after_await", "in_then", "in_timer"]);
  });

  it("does not leak into concurrent live work in the same process (async isolation)", async () => {
    // The break this catches: implementing the scope as a module-level flag.
    // The live call interleaves with the replay and would then be skipped.
    let liveRan = false;
    let replayRan = false;
    const replay = runInSmsReplayScope(async () => {
      await tick();
      smsEffect("replay_effect", () => { replayRan = true; }, undefined);
      await tick();
    });
    const live = (async () => {
      await tick();
      smsEffect("live_effect", () => { liveRan = true; }, undefined);
    })();
    await Promise.all([replay, live]);
    expect(replayRan).toBe(false);
    expect(liveRan).toBe(true);
    expect(isSmsReplayActive()).toBe(false);
  });

  it("records phone numbers as a suffix at most", () => {
    const recorder = createSmsEffectRecorder();
    runInSmsReplayScope(
      () => smsEffect("x", () => 0, 0, { phone: "+12165550123", raw: 2165550123, bookingId: 42, note: "call 216-555-0123", empty: undefined }),
      recorder,
    );
    const detail = recorder.effects[0].detail!;
    expect(detail.phone).toBe("+***0123");
    expect(detail.raw).toBe("***0123");
    expect(detail.note).toBe("call ***0123");
    expect(detail.bookingId).toBe(42);
    expect("empty" in detail).toBe(false);
    expect(JSON.stringify(detail)).not.toMatch(/216\D?555/);
  });

  it("recorder counts and clear", () => {
    const recorder = createSmsEffectRecorder();
    runInSmsReplayScope(() => {
      smsEffect("a", () => 0, 0);
      smsEffect("b", () => 0, 0);
      smsEffect("a", () => 0, 0);
    }, recorder);
    expect(recorder.counts()).toEqual({ a: 2, b: 1 });
    recorder.clear();
    expect(recorder.names()).toEqual([]);
  });
});

describe("the legacy REPLAY_DRY_RUN flag now means no effects at all", () => {
  it("'true' skips the effect even with no scope (nothing recorded: no recorder)", () => {
    process.env.REPLAY_DRY_RUN = "true";
    let ran = false;
    const out = smsEffect("customers.update_sms_opt_out", () => { ran = true; }, "skipped");
    expect(isSmsReplayActive()).toBe(true);
    expect(ran).toBe(false);
    expect(out).toBe("skipped");
  });

  it("only the exact string 'true' activates it", () => {
    process.env.REPLAY_DRY_RUN = "1";
    let ran = false;
    smsEffect("x", () => { ran = true; }, undefined);
    expect(isSmsReplayActive()).toBe(false);
    expect(ran).toBe(true);
  });
});

describe("REPLAY_DRY_RUN with no scope is loud (it also skips STOP persistence)", () => {
  // 2026-10-09 review (round 2): this mode used to log only at debug, which
  // the production logger drops. The logger writes warn to stdout and error to
  // stderr; both are captured here and restored after each test.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  let stdoutLines: string[];
  let stderrLines: string[];

  beforeEach(() => {
    __resetReplayEnvAlarmForTests();
    stdoutLines = [];
    stderrLines = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { stdoutLines.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { stderrLines.push(String(chunk)); return true; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    __resetReplayEnvAlarmForTests();
  });

  const alarms = (lines: string[]) => lines.filter((l) => l.includes(REPLAY_ENV_ONLY_ALARM_ID));

  it("flag set, no scope: ONE warn line for the first skip, naming the effect, never a phone", () => {
    process.env.REPLAY_DRY_RUN = "true";
    smsEffect("sms.markPhoneFullyOptedOut", () => 0, 0, { phoneSuffix: "0123" });
    smsEffect("customers.update_sms_opt_out", () => 0, 0);
    smsEffect("complianceLog.logSmsOptOut", () => 0, 0);
    expect(alarms(stdoutLines)).toHaveLength(1);
    expect(alarms(stderrLines)).toHaveLength(0);
    expect(alarms(stdoutLines)[0]).toMatch(/WARN/);
    expect(alarms(stdoutLines)[0]).toMatch(/sms\.markPhoneFullyOptedOut/);
    expect(alarms(stdoutLines)[0]).not.toMatch(/0123/);
  });

  it("in production the same line is an error (stderr), still once", () => {
    process.env.REPLAY_DRY_RUN = "true";
    process.env.NODE_ENV = "production";
    smsEffect("a", () => 0, 0);
    smsEffect("b", () => 0, 0);
    expect(alarms(stderrLines)).toHaveLength(1);
    expect(alarms(stderrLines)[0]).toMatch(/ERROR/);
    expect(alarms(stdoutLines)).toHaveLength(0);
  });

  it("control: flag unset, the effect runs and nothing is logged", () => {
    let ran = false;
    smsEffect("a", () => { ran = true; }, undefined);
    expect(ran).toBe(true);
    expect(alarms(stdoutLines)).toHaveLength(0);
    expect(alarms(stderrLines)).toHaveLength(0);
  });

  it("control: inside a real scope (the script's path) there is no alarm, with or without the flag", () => {
    process.env.REPLAY_DRY_RUN = "true";
    runInSmsReplayScope(() => smsEffect("a", () => 0, 0), createSmsEffectRecorder());
    delete process.env.REPLAY_DRY_RUN;
    runInSmsReplayScope(() => smsEffect("b", () => 0, 0));
    expect(alarms(stdoutLines)).toHaveLength(0);
    expect(alarms(stderrLines)).toHaveLength(0);
  });
});

describe("production-read acknowledgement flag", () => {
  it("passes only with the exact flag", () => {
    expect(hasProductionReadAck(["node", "script", REPLAY_PRODUCTION_READ_ACK_FLAG])).toBe(true);
    expect(hasProductionReadAck(["node", "script"])).toBe(false);
    expect(hasProductionReadAck(["node", "script", "--i-understand"])).toBe(false);
    expect(hasProductionReadAck(["node", "script", `${REPLAY_PRODUCTION_READ_ACK_FLAG}=no`])).toBe(false);
  });
});

describe("installDenyAllFetch", () => {
  it("rejects every request, records the host only, and restore() puts the original back", async () => {
    const calls: unknown[] = [];
    const original = (input: unknown) => { calls.push(input); return Promise.resolve("live"); };
    const target: { fetch?: unknown } = { fetch: original };

    // Control: before install, the original is reached.
    await (target.fetch as (i: unknown) => Promise<unknown>)("https://api.telegram.org/botX/sendMessage?chat_id=1");
    expect(calls).toHaveLength(1);

    const handle = installDenyAllFetch(target);
    await expect((target.fetch as (i: unknown) => Promise<unknown>)("https://api.telegram.org/botX/sendMessage?chat_id=1")).rejects.toThrow(/blocked/);
    await expect((target.fetch as (i: unknown) => Promise<unknown>)(new URL("https://ollama.com/api/chat"))).rejects.toThrow(/blocked/);
    expect(calls).toHaveLength(1);
    expect(handle.blockedHosts).toEqual(["api.telegram.org", "ollama.com"]);
    expect(handle.blockedHosts.join(" ")).not.toMatch(/sendMessage|chat_id/);

    handle.restore();
    expect(target.fetch).toBe(original);
  });

  it("defaults to globalThis and restores it", async () => {
    const before = globalThis.fetch;
    const handle = installDenyAllFetch();
    try {
      expect(globalThis.fetch).not.toBe(before);
      await expect(globalThis.fetch("https://example.test/x")).rejects.toThrow(/blocked/);
    } finally {
      handle.restore();
    }
    expect(globalThis.fetch).toBe(before);
  });
});

describe("replayScopeSelfTest", () => {
  it("passes with the real scope", () => {
    expect(replayScopeSelfTest()).toEqual({ ok: true });
  });

  it("FAILS when smsEffect runs the effect (broken gate)", () => {
    const brokenEffect = ((_n: string, run: () => unknown) => run()) as typeof smsEffect;
    const r = replayScopeSelfTest({ smsEffect: brokenEffect, runInSmsReplayScope, createSmsEffectRecorder });
    expect(r.ok).toBe(false);
  });

  it("FAILS when the scope is not established, even with REPLAY_DRY_RUN=true set", () => {
    // The env flag alone skips effects but records nothing: the self-test
    // must prove the async scope itself, which is what the script relies on.
    process.env.REPLAY_DRY_RUN = "true";
    const brokenScope = (<T,>(fn: () => T) => fn()) as typeof runInSmsReplayScope;
    const r = replayScopeSelfTest({ smsEffect, runInSmsReplayScope: brokenScope, createSmsEffectRecorder });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/recorder saw \[\]/);
  });

  it("FAILS when the fallback is not returned", () => {
    const wrongFallback = ((name: string) => { void name; return "something else"; }) as unknown as typeof smsEffect;
    const r = replayScopeSelfTest({ smsEffect: wrongFallback, runInSmsReplayScope, createSmsEffectRecorder });
    expect(r.ok).toBe(false);
  });
});

describe("replayLeakCheckQuery (read-only post-run check)", () => {
  const dialect = new MySqlDialect();

  it("is a SELECT COUNT over the replay sid with an SQL-side time window", () => {
    const q = dialect.sqlToQuery(replayLeakCheckQuery(600));
    expect(q.sql).toMatch(/^SELECT COUNT\(\*\) AS n FROM sms_orchestrations WHERE send_result_json LIKE \? AND createdAt >= NOW\(\) - INTERVAL 600 SECOND$/);
    expect(q.params).toEqual([`%${REPLAY_FAKE_SEND_SID}%`]);
    expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE|ALTER)\b/i);
  });

  it("rounds a fractional window up", () => {
    expect(dialect.sqlToQuery(replayLeakCheckQuery(1.2)).sql).toMatch(/INTERVAL 2 SECOND$/);
  });

  it("refuses a window that is not a positive number (no SQL built from garbage)", () => {
    expect(() => replayLeakCheckQuery(0)).toThrow();
    expect(() => replayLeakCheckQuery(-5)).toThrow();
    expect(() => replayLeakCheckQuery(Number.NaN)).toThrow();
  });
});

describe("readLeakCount: unknown is never zero", () => {
  it("reads numeric and string counts from a mysql2 [rows, fields] result", () => {
    expect(readLeakCount([[{ n: 0 }], []])).toBe(0);
    expect(readLeakCount([[{ n: "3" }], []])).toBe(3);
    expect(readLeakCount([[{ n: 2n }], []])).toBe(2);
  });

  it("returns null (not 0) for every unreadable shape", () => {
    expect(readLeakCount([[{ n: null }], []])).toBeNull();
    expect(readLeakCount([[{ n: "" }], []])).toBeNull();
    expect(readLeakCount([[{}], []])).toBeNull();
    expect(readLeakCount([[], []])).toBeNull();
    expect(readLeakCount(undefined)).toBeNull();
    expect(readLeakCount([[{ n: -1 }], []])).toBeNull();
    expect(readLeakCount([[{ n: "abc" }], []])).toBeNull();
  });
});

describe("truncateForPrint", () => {
  it("keeps short bodies and cuts long ones to exactly 120 characters", () => {
    expect(truncateForPrint("short")).toBe("short");
    expect(truncateForPrint("a".repeat(120))).toBe("a".repeat(120));
    const cut = truncateForPrint("a".repeat(200));
    expect(cut).toHaveLength(120);
    expect(cut.endsWith("...")).toBe(true);
    expect(truncateForPrint(null)).toBe("");
  });
});

describe("replayPhoneKeys: every form a leaked write would store", () => {
  it("keeps the raw value and adds the orchestrator's normalized form, deduplicated", () => {
    expect(replayPhoneKeys(["2165551000", "+12165551000", " 2165551001 ", null, "", undefined])).toEqual([
      "+12165551000",
      "+12165551001",
      "2165551000",
      "2165551001",
    ]);
  });

  it("falls back to the last 10 digits when normalizePhone rejects the input (as orchestrateSms does)", () => {
    expect(replayPhoneKeys(["55512"])).toEqual(["55512"]);
    expect(replayPhoneKeys(["0012165551000"])).toEqual(["0012165551000", "2165551000"]);
  });
});

describe("replayPhoneCountQuery (read-only before/after count)", () => {
  const dialect = new MySqlDialect();

  it("is a parameterized SELECT COUNT over customer_phone IN (...)", () => {
    const q = dialect.sqlToQuery(replayPhoneCountQuery("nickgpt_drafts", ["+12165551000", "2165551000"]));
    expect(q.sql).toBe("SELECT COUNT(*) AS n FROM nickgpt_drafts WHERE customer_phone IN (?, ?)");
    expect(q.params).toEqual(["+12165551000", "2165551000"]);
    expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE|ALTER)\b/i);
  });

  it("refuses an empty phone list (IN () is invalid SQL) and a table outside the allowlist", () => {
    expect(() => replayPhoneCountQuery("sms_orchestrations", [])).toThrow(/no phones/);
    expect(() => replayPhoneCountQuery("customers; DROP TABLE x" as ReplayPhoneTable, ["1"])).toThrow(/table must be one of/);
  });
});

describe("evaluateReplayIsolation: the receipt says what was measured, and unknown is never clean", () => {
  const delta = (over: Partial<ReplayPhoneDelta>): ReplayPhoneDelta => ({
    table: "sms_orchestrations",
    kind: "fictional",
    phoneCount: 3,
    before: 5,
    after: 5,
    ...over,
  });
  const clean = () => [
    delta({}),
    delta({ kind: "real", before: 40, after: 40 }),
    delta({ table: "nickgpt_drafts" }),
    delta({ table: "nickgpt_drafts", kind: "real", before: 2, after: 2 }),
  ];

  it("all zero: clean, and the lines name the sid scope and what is NOT measured", () => {
    const r = evaluateReplayIsolation({ sidRows: 0, windowSeconds: 90.2, phoneDeltas: clean() });
    expect(r.verdict).toBe("clean");
    expect(r.lines[0]).toBe(`sms_orchestrations rows carrying the replay sid ${REPLAY_FAKE_SEND_SID} (created in the last 91s): 0`);
    expect(r.lines).toContain("sms_orchestrations rows added for the 3 fictional backfill numbers: 0");
    expect(r.lines).toContain("nickgpt_drafts rows added for the 3 replayed real numbers: 0 (includes any live traffic during the run)");
    expect(r.lines[r.lines.length - 1]).toMatch(/^Not measured by this check: customers, bookings, consent ledger/);
    // The old receipt claimed "0 replay rows written"; nothing may overclaim like that.
    expect(r.lines.join("\n")).not.toMatch(/rows written/);
  });

  it("a replay-sid row is a leak", () => {
    expect(evaluateReplayIsolation({ sidRows: 1, windowSeconds: 60, phoneDeltas: clean() }).verdict).toBe("leaked");
  });

  it("a new row for a fictional backfill number is a leak (the sid check is blind to it, e.g. legacy_passthrough)", () => {
    const deltas = clean();
    deltas[2] = delta({ table: "nickgpt_drafts", before: 0, after: 1 });
    const r = evaluateReplayIsolation({ sidRows: 0, windowSeconds: 60, phoneDeltas: deltas });
    expect(r.verdict).toBe("leaked");
    expect(r.lines).toContain("nickgpt_drafts rows added for the 3 fictional backfill numbers: 1");
  });

  it("a new row for a real replayed number is UNKNOWN (may be live traffic), not clean and not a proven leak", () => {
    const deltas = clean();
    deltas[1] = delta({ kind: "real", before: 40, after: 41 });
    expect(evaluateReplayIsolation({ sidRows: 0, windowSeconds: 60, phoneDeltas: deltas }).verdict).toBe("unknown");
  });

  it("an unreadable count or a falling count is UNKNOWN", () => {
    expect(evaluateReplayIsolation({ sidRows: null, windowSeconds: 60, phoneDeltas: clean() }).verdict).toBe("unknown");
    const unreadable = clean();
    unreadable[0] = delta({ after: null });
    expect(evaluateReplayIsolation({ sidRows: 0, windowSeconds: 60, phoneDeltas: unreadable }).verdict).toBe("unknown");
    const fell = clean();
    fell[0] = delta({ before: 5, after: 4 });
    const r = evaluateReplayIsolation({ sidRows: 0, windowSeconds: 60, phoneDeltas: fell });
    expect(r.verdict).toBe("unknown");
    expect(r.lines.join("\n")).toMatch(/count fell by 1/);
  });

  it("a set with no phones is n/a and does not change the verdict", () => {
    const deltas = clean();
    deltas[1] = delta({ kind: "real", phoneCount: 0, before: 0, after: 0 });
    const r = evaluateReplayIsolation({ sidRows: 0, windowSeconds: 60, phoneDeltas: deltas });
    expect(r.verdict).toBe("clean");
    expect(r.lines).toContain("sms_orchestrations rows added for the 0 replayed real numbers: n/a (none replayed)");
  });

  it("leaked outranks unknown", () => {
    const deltas = clean();
    deltas[1] = delta({ kind: "real", before: 1, after: 9 });
    expect(evaluateReplayIsolation({ sidRows: 2, windowSeconds: 60, phoneDeltas: deltas }).verdict).toBe("leaked");
  });
});

describe("replayOutcomeBucket: a failed draft is not a no-send", () => {
  it("puts status failed in its own bucket, even when shouldAutoSend is still true", () => {
    expect(replayOutcomeBucket({ status: "failed", shouldAutoSend: false })).toBe("failed");
    expect(replayOutcomeBucket({ status: "failed", shouldAutoSend: true })).toBe("failed");
  });

  it("keeps the original buckets for everything else", () => {
    expect(replayOutcomeBucket({ status: "sent", shouldAutoSend: true })).toBe("auto_send");
    expect(replayOutcomeBucket({ status: "drafted", shouldAutoSend: false })).toBe("draft_only");
    expect(replayOutcomeBucket({ status: "blocked", shouldAutoSend: false })).toBe("no_send");
    expect(replayOutcomeBucket({ status: "skipped", shouldAutoSend: false })).toBe("no_send");
  });
});

describe("an opt-in replayed against the pre-event opt-out is not a no-send", () => {
  const blockedOptedOut = { status: "blocked", shouldAutoSend: false, statusReason: "customer_opted_out" };

  it("START / UNSTOP / YES (normalized like the orchestrator) read as blocked go to their own bucket", () => {
    for (const body of ["START", " start ", "Unstop", "yes"]) {
      const event = { type: "inbound_sms", body };
      expect(isPreEventOptInReplay(event, blockedOptedOut)).toBe(true);
      expect(replayOutcomeBucket(blockedOptedOut, event)).toBe("opt_in_pre_event");
    }
  });

  it("controls: the same block for a non-keyword, another event type, another reason, or no event stays no_send", () => {
    expect(replayOutcomeBucket(blockedOptedOut, { type: "inbound_sms", body: "what are your hours?" })).toBe("no_send");
    expect(replayOutcomeBucket(blockedOptedOut, { type: "stale_lead_followup" })).toBe("no_send");
    expect(replayOutcomeBucket({ ...blockedOptedOut, statusReason: "cooldown_active" }, { type: "inbound_sms", body: "START" })).toBe("no_send");
    expect(replayOutcomeBucket(blockedOptedOut)).toBe("no_send");
    // An opt-in that was NOT blocked is an ordinary decision.
    expect(replayOutcomeBucket({ status: "sent", shouldAutoSend: true, statusReason: "x" }, { type: "inbound_sms", body: "START" })).toBe("auto_send");
    // failed still wins.
    expect(replayOutcomeBucket({ status: "failed", shouldAutoSend: false }, { type: "inbound_sms", body: "START" })).toBe("failed");
  });
});

describe("flushThenExit: the script ends even though sms.ts holds an interval open", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A stream whose write callback fires on the next tick, or never. */
  const stream = (opts: { neverCallsBack?: boolean } = {}) => ({
    writes: 0,
    write(_chunk: string, cb: (err?: Error | null) => void) {
      this.writes++;
      if (!opts.neverCallsBack) setTimeout(() => cb(), 0);
      return true;
    },
  });

  it("exits once with the code, and only after every stream has drained", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const out = stream();
    const err = stream();
    flushThenExit(1, [out, err], exit, 2000);
    expect(exit).not.toHaveBeenCalled(); // control: not before the flush
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    await vi.advanceTimersByTimeAsync(5000); // the fallback timer was cleared
    expect(exit).toHaveBeenCalledTimes(1);
    expect(out.writes + err.writes).toBe(2);
  });

  it("falls back to exiting after fallbackMs when a stream never calls back", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    flushThenExit(1, [stream(), stream({ neverCallsBack: true })], exit, 2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits immediately with no streams", () => {
    const exit = vi.fn();
    flushThenExit(0, [], exit);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

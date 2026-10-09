/**
 * SMS replay scope: run the orchestrator's DECISION without its EFFECTS.
 *
 * 2026-10-09 (autoresearch audit, ledger section C). `REPLAY_DRY_RUN=true` used
 * to fake only the two `sendSms` calls in smsOrchestrator.ts. Everything else on
 * the replay path still wrote to the production database that every nickstire
 * worktree binds:
 *
 *   - a new sms_orchestrations row per replayed event, status `sent`, carrying the
 *     real customer's phone and cooldownKey. checkCooldown and the
 *     lastOutboundVariant read both read those rows, so a replay could SUPPRESS a
 *     real follow-up inside its cooldown window;
 *   - customers.smsOptOut plus the consent ledger (a replayed historical START
 *     could re-opt-in a number whose latest state is opted out);
 *   - bookings confirm / cancel and the cancelled reminder queue;
 *   - expected_arrivals, nickgpt_drafts, sms_orchestration_outcomes;
 *   - an owner email + push on a replayed estimate approval.
 *
 * The fix is one rule, enforced at every effect site: the orchestrator routes
 * each write or send through `smsEffect(name, run, onReplay)`. Outside a replay
 * `smsEffect` returns `run()` unchanged (same call, same arguments, same sync or
 * async shape, same thrown errors). Inside a replay it never calls `run`: it
 * records `{ name, detail }` and returns the `onReplay` fallback so the code
 * after the skipped write still runs and still produces a decision.
 *
 * Why AsyncLocalStorage and not a flag argument: the effects sit up to three
 * awaits deep (dynamic imports, fire-and-forget `.then` chains), and threading a
 * parameter through 2,000 lines of PROTECTED-CORE code would change every
 * signature on the live path. The store follows the async context of ONE
 * `orchestrateSms` call, so a replay running in the same process as live
 * traffic cannot leak into it.
 *
 * The legacy env flag still works and now means MORE: `REPLAY_DRY_RUN=true`
 * makes every `smsEffect` skip (no writes at all, not just no send). There is
 * no recorder in that mode; use `runInSmsReplayScope` to see what was skipped.
 * Because that mode also skips STOP persistence (suppression cache, customers
 * row, consent ledger), the first skip with no scope logs ONE loud line per
 * process (errorId SMS_REPLAY_DRY_RUN_ENV_ACTIVE: error in production, warn
 * elsewhere). REPLAY_DRY_RUN must never be set on a Railway service.
 *
 * Pinned by:
 *   - smsReplayScope.test.ts                          (this module, with breaks)
 *   - __tests__/smsReplayIsolation.structure.test.ts  (every write site wrapped)
 *   - __tests__/smsReplayIsolation.behaviour.test.ts  (throwing DB + modules)
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type SQL } from "drizzle-orm";
import { SMS_OPT_IN_KEYWORDS } from "@shared/smsOptOutKeywords";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";

const log = createLogger("sms-replay-scope");

/** The sid the faked sendSms returns in a replay. The post-run leak check greps for it. */
export const REPLAY_FAKE_SEND_SID = "SM_replay_dry_run";

/** The script refuses to start without this flag: it reads real customer rows. */
export const REPLAY_PRODUCTION_READ_ACK_FLAG = "--i-understand-this-reads-production";

export type SmsEffectDetailValue = string | number | boolean | null | undefined;
export type SmsEffectDetail = Record<string, SmsEffectDetailValue>;

export interface SmsEffectRecord {
  name: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface SmsEffectRecorder {
  readonly effects: readonly SmsEffectRecord[];
  record(effect: SmsEffectRecord): void;
  /** Effect names in the order they were skipped. */
  names(): string[];
  /** name -> how many times it was skipped. */
  counts(): Record<string, number>;
  clear(): void;
}

interface ReplayStore {
  recorder?: SmsEffectRecorder;
}

const replayStorage = new AsyncLocalStorage<ReplayStore>();

export function createSmsEffectRecorder(): SmsEffectRecorder {
  const effects: SmsEffectRecord[] = [];
  return {
    effects,
    record(effect) {
      effects.push(effect);
    },
    names() {
      return effects.map((e) => e.name);
    },
    counts() {
      const out: Record<string, number> = {};
      for (const e of effects) out[e.name] = (out[e.name] ?? 0) + 1;
      return out;
    },
    clear() {
      effects.length = 0;
    },
  };
}

/**
 * Run `fn` (usually one `orchestrateSms` call) with every `smsEffect` inside it
 * skipped and, when `recorder` is given, recorded. Returns `fn`'s own result.
 */
export function runInSmsReplayScope<T>(fn: () => T, recorder?: SmsEffectRecorder): T {
  return replayStorage.run({ recorder }, fn);
}

/** True inside a replay scope, or anywhere while `REPLAY_DRY_RUN` is exactly "true". */
export function isSmsReplayActive(): boolean {
  return replayStorage.getStore() !== undefined || process.env.REPLAY_DRY_RUN === "true";
}

/**
 * Masks any digit run with 7+ digits (separators like "-", ".", " ", "()"
 * allowed between them) to its last 4 digits, so a phone number that reaches a
 * detail field is recorded as a suffix at most (PROTECTED-CORE rule 5).
 */
function maskDigitRuns(text: string): string {
  return text.replace(/\d[\d\s().-]*\d/g, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= 7 ? `***${digits.slice(-4)}` : run;
  });
}

function redactDetail(detail: SmsEffectDetail | undefined): SmsEffectRecord["detail"] {
  if (!detail) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    if (typeof value === "string") out[key] = maskDigitRuns(value);
    else if (typeof value === "number" && Math.abs(value) >= 1_000_000) out[key] = maskDigitRuns(String(value));
    else out[key] = value;
  }
  return out;
}

/**
 * The one gate every orchestrator side effect passes through.
 *
 * - Not replaying: returns `run()` exactly. No await is added, so a sync call
 *   stays sync and a thrown error is thrown at the same point as before.
 * - Replaying: `run` is NEVER called. The effect is recorded (name plus a
 *   redacted detail) and `onReplay` is returned: a value, or a thunk called
 *   once. Use an array-shaped fallback where the caller destructures `[row]`.
 */
export function smsEffect<T, R>(
  name: string,
  run: () => T,
  onReplay: R | (() => R),
  detail?: SmsEffectDetail,
): T | R {
  if (!isSmsReplayActive()) return run();
  const store = replayStorage.getStore();
  if (!store) raiseEnvOnlyReplayAlarmOnce(name);
  const recorder = store?.recorder;
  recorder?.record({ name, detail: redactDetail(detail) });
  if (!recorder) log.debug("replay: effect skipped", { effect: name });
  return typeof onReplay === "function" ? (onReplay as () => R)() : onReplay;
}

/** errorId of the one line logged when REPLAY_DRY_RUN alone (no scope) skips an effect. */
export const REPLAY_ENV_ONLY_ALARM_ID = "SMS_REPLAY_DRY_RUN_ENV_ACTIVE";

let envOnlyReplayAlarmRaised = false;

/**
 * 2026-10-09 review (round 2): REPLAY_DRY_RUN=true with no scope skips EVERY
 * effect, inbound STOP persistence included. Inside the replay script that is
 * the point (the flag is a second guard behind the scope); on a live service it
 * would silently stop recording opt-outs while senders outside the orchestrator
 * kept texting those numbers. That mode has no recorder and the production
 * logger drops debug lines, so the first skip logs one line per process: error
 * in production, warn elsewhere. The effect name only (no phone, no detail).
 */
function raiseEnvOnlyReplayAlarmOnce(effect: string): void {
  if (envOnlyReplayAlarmRaised) return;
  envOnlyReplayAlarmRaised = true;
  const message =
    "REPLAY_DRY_RUN=true: every SMS effect is being skipped (no sends, no writes, no opt-out or consent persistence). It must never be set on a live service.";
  const fields = { errorId: REPLAY_ENV_ONLY_ALARM_ID, firstSkippedEffect: effect };
  if (process.env.NODE_ENV === "production") log.error(message, fields);
  else log.warn(message, fields);
}

export function __resetReplayEnvAlarmForTests(): void {
  envOnlyReplayAlarmRaised = false;
}

// --- Helpers for scripts/replay-sms-orchestrator.ts ---------------------------
// scripts/ sits outside the typecheck project, so the script stays thin and its
// testable logic lives here.

export function hasProductionReadAck(argv: readonly string[]): boolean {
  return argv.includes(REPLAY_PRODUCTION_READ_ACK_FLAG);
}

export interface DenyAllFetchHandle {
  /** Hostnames (never paths or query strings) of every blocked attempt. */
  readonly blockedHosts: string[];
  restore(): void;
}

function hostOf(input: unknown): string {
  try {
    if (typeof input === "string") return new URL(input).host;
    if (input instanceof URL) return input.host;
    if (input && typeof input === "object" && "url" in input) return new URL(String((input as { url: unknown }).url)).host;
  } catch {
    /* fall through */
  }
  return "unparseable";
}

/**
 * Replace `target.fetch` with one that rejects every request, until `restore()`.
 * A replay must not reach Telegram, email, Vapi, a webhook or a model provider.
 * Model-backed drafts therefore fail closed during a replay (the orchestrator
 * records `nickgpt_generation_failed`); deterministic templates are unaffected.
 */
export function installDenyAllFetch(target: { fetch?: unknown } = globalThis as { fetch?: unknown }): DenyAllFetchHandle {
  const original = target.fetch;
  const blockedHosts: string[] = [];
  target.fetch = (input: unknown) => {
    const host = hostOf(input);
    blockedHosts.push(host);
    return Promise.reject(new Error(`sms replay: outbound fetch blocked (${host})`));
  };
  return {
    blockedHosts,
    restore() {
      target.fetch = original;
    },
  };
}

export interface ReplaySelfTestDeps {
  smsEffect: typeof smsEffect;
  runInSmsReplayScope: typeof runInSmsReplayScope;
  createSmsEffectRecorder: typeof createSmsEffectRecorder;
}

/**
 * Startup proof that the scope works in THIS process: inside a scope, an effect
 * whose run() would throw must be recorded and not run. The recorder only
 * exists inside a real scope, so the legacy env flag alone cannot pass this.
 */
export function replayScopeSelfTest(
  deps: ReplaySelfTestDeps = { smsEffect, runInSmsReplayScope, createSmsEffectRecorder },
): { ok: true } | { ok: false; reason: string } {
  const recorder = deps.createSmsEffectRecorder();
  let ran = false;
  try {
    const out = deps.runInSmsReplayScope(
      () =>
        deps.smsEffect(
          "replay.self_test",
          () => {
            ran = true;
            throw new Error("replay self-test: the effect body executed");
          },
          "skipped",
        ),
      recorder,
    );
    if (ran) return { ok: false, reason: "effect body executed inside the replay scope" };
    if (out !== "skipped") return { ok: false, reason: "replay fallback was not returned" };
    const names = recorder.names();
    if (names.length !== 1 || names[0] !== "replay.self_test") {
      return { ok: false, reason: `recorder saw [${names.join(", ")}], expected [replay.self_test]` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * READ-ONLY post-run check: sms_orchestrations rows carrying the replay's fake
 * sid, created within the last `windowSeconds`. Must be 0 after a replay. The
 * window is computed in SQL (NOW() - INTERVAL), not from a JS Date, because
 * driver-parsed TiDB DATETIME values come back shifted on ET.
 *
 * Scope, stated so a zero is not over-read: only the FINAL orchestration write
 * of an event whose send was faked carries this sid (smsOrchestrator.ts, the
 * `sendResultJson` of the final payload). The inbound `received` row, drafted /
 * blocked / skipped rows and the legacy_passthrough payload (no sendResultJson
 * key) never do. replayPhoneCountQuery + evaluateReplayIsolation cover those.
 */
export function replayLeakCheckQuery(windowSeconds: number): SQL {
  const secs = Math.ceil(windowSeconds);
  if (!Number.isSafeInteger(secs) || secs < 1) {
    throw new Error(`replayLeakCheckQuery: windowSeconds must be a positive number, got ${windowSeconds}`);
  }
  return sql`SELECT COUNT(*) AS n FROM sms_orchestrations WHERE send_result_json LIKE ${`%${REPLAY_FAKE_SEND_SID}%`} AND createdAt >= NOW() - INTERVAL ${sql.raw(String(secs))} SECOND`;
}

/**
 * The count from a mysql2 `db.execute` result (`[rows, fields]`), or null when
 * the shape is not a readable count. Null is UNKNOWN, never zero: the caller
 * must treat it as a failed check.
 */
export function readLeakCount(result: unknown): number | null {
  const rows = Array.isArray(result) ? result[0] : undefined;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first || typeof first !== "object" || !("n" in first)) return null;
  const raw = (first as { n: unknown }).n;
  // Number(null) and Number("") are 0: a missing value must not read as "no leak".
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Printed message bodies are cut to `max` characters (default 120). */
export function truncateForPrint(text: string | null | undefined, max = 120): string {
  const s = text ?? "";
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

/**
 * Tables a leaked replay INSERT would land in, keyed by phone. Both store it in
 * the column `customer_phone`. (Updates to customers / bookings and the consent
 * ledger cannot be counted this way; the scope and its tests guard those.)
 */
export const REPLAY_PHONE_TABLES = ["sms_orchestrations", "nickgpt_drafts"] as const;
export type ReplayPhoneTable = (typeof REPLAY_PHONE_TABLES)[number];

/**
 * Every stored form of each phone: as given, and as orchestrateSms normalizes
 * it before writing (`normalizePhone(p) || last 10 digits`), so a count over
 * `customer_phone IN (...)` matches whatever a leaked write would have stored.
 */
export function replayPhoneKeys(phones: Iterable<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const raw of phones) {
    const p = (raw ?? "").trim();
    if (!p) continue;
    keys.add(p);
    const stored = normalizePhone(p) || p.replace(/\D/g, "").slice(-10);
    if (stored) keys.add(stored);
  }
  return [...keys].sort();
}

/**
 * READ-ONLY: rows in `table` for any of `phoneKeys`. The script takes it before
 * AND after the replay and compares, so the check needs neither a time window
 * (app-written createdAt values are shifted on ET) nor monotonic ids (TiDB
 * auto-increment is not monotonic across nodes).
 */
export function replayPhoneCountQuery(table: ReplayPhoneTable, phoneKeys: readonly string[]): SQL {
  if (!(REPLAY_PHONE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`replayPhoneCountQuery: table must be one of ${REPLAY_PHONE_TABLES.join(", ")}, got ${String(table)}`);
  }
  if (phoneKeys.length === 0) throw new Error("replayPhoneCountQuery: no phones to count (an empty IN list is invalid SQL)");
  return sql`SELECT COUNT(*) AS n FROM ${sql.raw(table)} WHERE customer_phone IN (${sql.join(phoneKeys.map((k) => sql`${k}`), sql`, `)})`;
}

export interface ReplayPhoneDelta {
  table: ReplayPhoneTable;
  /**
   * fictional: the script's own 216-555 backfill numbers. No live customer has
   * them, so any new row is a leak. real: the replayed historical numbers. A new
   * row may be live traffic during the run, so it is UNKNOWN, never clean.
   */
  kind: "fictional" | "real";
  phoneCount: number;
  before: number | null;
  after: number | null;
}

export type ReplayIsolationVerdict = "clean" | "leaked" | "unknown";

/**
 * The post-run verdict plus receipt lines that say exactly what was measured.
 * Precedence: leaked > unknown > clean. An unreadable count is unknown, never 0.
 */
export function evaluateReplayIsolation(input: {
  sidRows: number | null;
  windowSeconds: number;
  phoneDeltas: readonly ReplayPhoneDelta[];
}): { verdict: ReplayIsolationVerdict; lines: string[] } {
  let leaked = false;
  let unknown = false;
  const lines: string[] = [];
  const sidLabel = `sms_orchestrations rows carrying the replay sid ${REPLAY_FAKE_SEND_SID} (created in the last ${Math.ceil(input.windowSeconds)}s)`;
  if (input.sidRows === null) {
    unknown = true;
    lines.push(`${sidLabel}: UNKNOWN (count unreadable)`);
  } else {
    if (input.sidRows > 0) leaked = true;
    lines.push(`${sidLabel}: ${input.sidRows}`);
  }
  for (const d of input.phoneDeltas) {
    const label = `${d.table} rows added for the ${d.phoneCount} ${d.kind === "fictional" ? "fictional backfill" : "replayed real"} numbers`;
    if (d.phoneCount === 0) {
      lines.push(`${label}: n/a (none replayed)`);
      continue;
    }
    if (d.before === null || d.after === null) {
      unknown = true;
      lines.push(`${label}: UNKNOWN (count unreadable)`);
      continue;
    }
    const delta = d.after - d.before;
    if (delta < 0) {
      unknown = true;
      lines.push(`${label}: UNKNOWN (count fell by ${-delta}; a concurrent delete can hide a leak)`);
      continue;
    }
    if (delta > 0) {
      if (d.kind === "fictional") leaked = true;
      else unknown = true;
    }
    lines.push(`${label}: ${delta}${d.kind === "real" ? " (includes any live traffic during the run)" : ""}`);
  }
  lines.push(
    "Not measured by this check: customers, bookings, consent ledger, expected_arrivals and outcome rows. " +
      "Those are guarded by the replay scope and its structure and behaviour tests.",
  );
  return { verdict: leaked ? "leaked" : unknown ? "unknown" : "clean", lines };
}

export type ReplayOutcomeBucket = "failed" | "opt_in_pre_event" | "auto_send" | "draft_only" | "no_send";

/**
 * True for a replayed inbound opt-in keyword (START, UNSTOP or YES, normalized
 * the way orchestrateSms normalizes it) whose replay came back blocked as
 * customer_opted_out.
 *
 * 2026-10-09 review (round 2). Production runs the opt-in (the Q-43 consent
 * block in smsOrchestrator.ts) BEFORE it loads the customer context, so it
 * reads smsOptOut = 0 and replies. A replay skips that opt-in write, so the
 * same event reads the PRE-event opt-out and is blocked. That difference is
 * the replay's own doing, not a decision, so it gets its own report column.
 * Caveat, stated so the column is not over-read: a YES from an opted-out number
 * that is NOT SMS-suppressed is blocked in production too, and lands here as
 * well; the result alone cannot tell the two apart.
 */
export function isPreEventOptInReplay(
  event: { type: string; body?: unknown },
  result: { status: string; statusReason?: string | null },
): boolean {
  if (event.type !== "inbound_sms" || typeof event.body !== "string") return false;
  if (result.status !== "blocked" || result.statusReason !== "customer_opted_out") return false;
  const keyword = event.body.trim().toUpperCase().replace(/\s+/g, " ");
  return (SMS_OPT_IN_KEYWORDS as readonly string[]).includes(keyword);
}

/**
 * Report column for one replayed decision. `failed` comes first and stays out
 * of no-send: under the replay's deny-all fetch every model-backed draft fails
 * closed (nickgpt_generation_failed), and that is the replay's own doing, not a
 * block or skip decision. `opt_in_pre_event` (only when the event is given)
 * likewise keeps an opt-in that read the pre-event opt-out out of no-send.
 */
export function replayOutcomeBucket(
  result: { status: string; shouldAutoSend: boolean; statusReason?: string | null },
  event?: { type: string; body?: unknown },
): ReplayOutcomeBucket {
  if (result.status === "failed") return "failed";
  if (event && isPreEventOptInReplay(event, result)) return "opt_in_pre_event";
  if (result.shouldAutoSend) return "auto_send";
  if (result.status === "drafted") return "draft_only";
  return "no_send";
}

interface FlushableStream {
  write(chunk: string, cb: (err?: Error | null) => void): boolean;
}

/**
 * Exit with `code` once stdout and stderr have drained. The replay script must
 * exit explicitly: server/sms.ts starts an hourly setInterval at import (not
 * unref'd) and the mysql2 pool stays open, so the process never ends on its
 * own, and a crash that only set process.exitCode would hang instead of
 * failing. A 2 s fallback exits even if a stream never calls back.
 */
export function flushThenExit(
  code: number,
  streams: readonly FlushableStream[] = [process.stdout, process.stderr],
  exit: (code: number) => void = (c) => process.exit(c),
  fallbackMs = 2000,
): void {
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (exited) return;
    exited = true;
    if (timer) clearTimeout(timer);
    exit(code);
  };
  let pending = streams.length;
  if (pending === 0) return finish();
  // Not unref'd: if nothing else held the loop open, an unref'd fallback would
  // let the process end on its own with exit code 0.
  timer = setTimeout(finish, fallbackMs);
  for (const s of streams) {
    s.write("", () => {
      pending -= 1;
      if (pending === 0) finish();
    });
  }
}

/**
 * Prompt evolution - the manual door (2026-10-09).
 *
 * THE GAP IT CLOSES. The receptionist experiment lives in ONE place, the
 * `prompt-evolution-weekly` tier job (cron/scheduler.ts), and that job gates
 * itself to shop-TZ Mondays. Every manual path fell short of the full
 * experiment: scripts/prompt-evolve.ts cannot run the sealed confirmation
 * stage or post the /proof receipt, /api/admin/run-staged-cron fires only
 * MANUAL_TRIGGER_STAGED jobs (this one is live on the tier, not staged), and
 * /api/bridge/run-job is a locked door by design. So an operator who wanted a
 * result on a Thursday had to wait for Monday.
 *
 * WHAT THIS IS. One narrow runner for one job: it takes the SAME cross-dyno
 * lock the scheduler takes (`acquireCronLock("prompt-evolution-weekly")`, TTL
 * twice the job's budget), honours the job's env requirement and the drain
 * flag, runs the SAME cycle (processPromptEvolutionWeekly with
 * `trigger: "manual"`, which is the only thing that bypasses the Monday gate),
 * races it against the SAME 50-minute budget, and writes the SAME cron_log row
 * the tier runner writes. The served prompt is never touched: the cycle is
 * propose-only, and applying a proposal stays an operator edit + Push Config.
 *
 * WHY IT RETURNS BEFORE THE RUN ENDS. A full cycle takes up to 25 minutes.
 * No HTTP request survives that (Railway's edge, the browser, the tRPC client
 * all give up first), and a request that dies mid-run while the handler keeps
 * going is exactly the ambiguity the 2026-09-28 timeout incident left behind.
 * So the door STARTS the run, records it in memory, and answers at once; the
 * run's outcome lands in cron_log, in the prompt_evolution_latest row, in
 * Telegram and on /proof, and `promptEvolutionManualRunStatus()` reads the
 * in-memory state back for the admin panel. One process at a time: a second
 * start while one is running answers "running", never a second run.
 *
 * BUDGET PARITY. PROMPT_EVOLUTION_BUDGET_MS must equal the tier job's
 * `timeoutMs` in cron/scheduler.ts. promptEvolutionManualRun.test.ts parses
 * the scheduler source and fails when they drift: a manual run that outlives
 * its own lock is the hole runJobByName's header warns about.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cronLog, shopSettings } from "../../drizzle/schema";
import { createLogger } from "../lib/logger";

const log = createLogger("prompt-evolution:manual");

export const PROMPT_EVOLUTION_JOB_NAME = "prompt-evolution-weekly";
/** The env the tier job declares with `requiresEnv`; the scheduler skips the job without it. */
const PROMPT_EVOLUTION_REQUIRED_ENV = "OLLAMA_API_KEY";
/** Must match the tier job's `timeoutMs` (cron/scheduler.ts). Canaried by the test. */
export const PROMPT_EVOLUTION_BUDGET_MS = 50 * 60 * 1000;
const LATEST_KEY = "prompt_evolution_latest";

export type ManualRunStart =
  | { status: "started"; startedAt: string; budgetMs: number }
  | { status: "running"; startedAt: string; elapsedMs: number }
  | { status: "skipped"; reason: string }
  | { status: "refused"; reason: string };

export interface ManualRunRecord {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "completed" | "failed" | "timeout";
  recordsProcessed: number;
  details: string;
}

export interface ManualRunStatus {
  /** The run in progress on THIS process, or null. */
  active: { startedAt: string; elapsedMs: number; budgetMs: number } | null;
  /** The last manual run this process finished, or null (a redeploy forgets it; cron_log remembers). */
  last: ManualRunRecord | null;
}

/**
 * The prompt_evolution_latest row, summarised for the panel: hashes, counts,
 * outcome and gate reasons. Never the candidate prompt, never caller text.
 */
export interface LatestRunSummary {
  ranAt: string | null;
  trigger: "scheduled" | "manual" | "unknown";
  outcome: string | null;
  promotionStage: string | null;
  accepted: boolean;
  confirmed: boolean;
  candidateHash: string | null;
  baselinePromptHash: string | null;
  baselineParity: string | null;
  laneParity: boolean | null;
  experimentId: string | null;
  receiptDelivered: boolean | null;
  seeds: { usable: number | null; train: number | null; holdout: number | null; confirm: number | null; success: number | null };
  gates: { holdout: string | null; success: string | null; confirmation: string | null };
  durationMs: number | null;
  /** One line per proposed candidate: what happened to it before or on the train cohort. Never its rationale or text. */
  candidates: Array<{ promptHash: string | null; train: string | null; rejectedInvariants: string[]; trainMargin: number | null; trainUsable: boolean | null }>;
}

export interface ManualRunDeps {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  acquireLock?: typeof import("../cron/index").acquireCronLock;
  releaseLock?: typeof import("../cron/index").releaseCronLock;
  isDraining?: () => boolean;
  track?: <T>(jobName: string, run: Promise<T>) => Promise<T>;
  run?: (now: Date) => Promise<{ recordsProcessed: number; details: string }>;
  logRun?: (row: CronLogRow) => Promise<void>;
  /** Test seam for the budget timer. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CronLogRow {
  jobName: string;
  status: string;
  durationMs: number;
  recordsProcessed: number;
  details: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date;
}

/**
 * The in-process slot. CLAIMED SYNCHRONOUSLY, before the first await (2026-10-09
 * review): the guard used to be read before `await import` and the lock
 * round-trip and written only after them, so two starts landing inside that
 * window both passed it, and under lock fallback (db-null, table-missing,
 * query-error: cron/index.ts proceeds on all three) both ran. `promise` is
 * null while the claim is being turned into a run.
 */
let active: { startedAt: Date; promise: Promise<void> | null } | null = null;
let last: ManualRunRecord | null = null;

/** Tests only. */
export function _resetPromptEvolutionManualRunForTests(): void {
  active = null;
  last = null;
}

/** Same columns the tier runner writes (scheduler.ts logTierJob), so cron-status and the failure observer read this run like any other. */
async function writeCronLog(row: CronLogRow): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;
    await db.insert(cronLog).values({
      id: randomUUID(),
      jobName: row.jobName,
      status: row.status,
      durationMs: row.durationMs,
      recordsProcessed: row.recordsProcessed,
      details: row.details?.slice(0, 2000) ?? null,
      errorMessage: row.errorMessage?.slice(0, 2000) ?? null,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    });
  } catch (e) {
    log.warn("[evolve/manual] cron_log write failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function defaultRun(now: Date): Promise<{ recordsProcessed: number; details: string }> {
  const { processPromptEvolutionWeekly } = await import("../cron/jobs/promptEvolutionWeekly");
  return processPromptEvolutionWeekly(now, { trigger: "manual" });
}

/**
 * Start one manual run, or say why not. Resolves as soon as the run is
 * STARTED; the run itself continues in the background (see the header).
 */
export async function startPromptEvolutionManualRun(deps: ManualRunDeps = {}): Promise<ManualRunStart> {
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const startedAt = now();

  if (active) {
    return { status: "running", startedAt: active.startedAt.toISOString(), elapsedMs: startedAt.getTime() - active.startedAt.getTime() };
  }
  // Claim before act: from here every early return hands the slot back.
  active = { startedAt, promise: null };
  const release = <T extends ManualRunStart>(r: T): T => { active = null; return r; };

  if (!env[PROMPT_EVOLUTION_REQUIRED_ENV]) {
    return release({ status: "refused", reason: `${PROMPT_EVOLUTION_REQUIRED_ENV} is not set on this service; the scheduler skips this job without it, and so does the manual door` });
  }

  const cron = await import("../cron/index");
  const isDraining = deps.isDraining ?? cron.isCronDraining;
  const acquireLock = deps.acquireLock ?? cron.acquireCronLock;
  const releaseLock = deps.releaseLock ?? cron.releaseCronLock;
  const track = deps.track ?? cron.trackCronRun;
  const run = deps.run ?? defaultRun;
  const logRun = deps.logRun ?? writeCronLog;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));

  if (isDraining()) {
    return release({ status: "skipped", reason: "server shutting down - no new job starts" });
  }

  // Same lock, same TTL rule as runTier and runJobByName: twice the budget.
  const lock = await acquireLock(PROMPT_EVOLUTION_JOB_NAME, PROMPT_EVOLUTION_BUDGET_MS * 2);
  if (lock.status === "held-by-other") {
    return release({ status: "skipped", reason: "cross-dyno lock held by another process: the scheduler or another manual run owns this job right now" });
  }
  // The drain flag can flip during the lock await; re-check before starting.
  if (isDraining()) {
    if (lock.status === "acquired") await releaseLock(lock);
    return release({ status: "skipped", reason: "server shutting down - no new job starts" });
  }

  const promise = (async () => {
    let timedOut = false;
    let timer: unknown;
    let record: ManualRunRecord;
    try {
      const result = await Promise.race([
        track(PROMPT_EVOLUTION_JOB_NAME, run(startedAt)),
        new Promise<never>((_, reject) => {
          timer = setTimer(() => { timedOut = true; reject(new Error("timeout")); }, PROMPT_EVOLUTION_BUDGET_MS);
        }),
      ]);
      const finishedAt = now();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      // The cycle's own details already end in " · manual run" (promptEvolutionWeekly.ts names the trigger).
      const details = result.details;
      record = { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs, status: "completed", recordsProcessed: result.recordsProcessed, details };
      await logRun({ jobName: PROMPT_EVOLUTION_JOB_NAME, status: "completed", durationMs, recordsProcessed: result.recordsProcessed, details, errorMessage: null, startedAt, completedAt: finishedAt });
      log.info("[evolve/manual] run completed", { durationMs, recordsProcessed: result.recordsProcessed });
    } catch (err) {
      const finishedAt = now();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const message = err instanceof Error ? err.message : String(err);
      const status = timedOut ? "timeout" : "failed";
      const details = timedOut ? `manual run exceeded its ${Math.round(PROMPT_EVOLUTION_BUDGET_MS / 60000)}-minute budget; the handler may still be running` : `manual run failed: ${message}`;
      record = { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs, status, recordsProcessed: 0, details };
      await logRun({ jobName: PROMPT_EVOLUTION_JOB_NAME, status: "failed", durationMs, recordsProcessed: 0, details, errorMessage: message, startedAt, completedAt: finishedAt });
      log.warn("[evolve/manual] run did not complete", { status, durationMs, error: message });
    } finally {
      if (timer !== undefined) clearTimer(timer);
      // Same contract as the tier runner: on TIMEOUT the handler is still
      // running, so the lock is held to its TTL rather than released.
      if (lock.status === "acquired" && !timedOut) {
        await releaseLock(lock).catch((e) => log.warn("[evolve/manual] lock release failed", { error: e instanceof Error ? e.message : String(e) }));
      } else if (lock.status === "acquired" && timedOut) {
        log.warn(`[evolve/manual] ${PROMPT_EVOLUTION_JOB_NAME} timed out - holding lock until TTL to prevent concurrent re-fire`, { errorId: "CRON_TIMEOUT_LOCK_HELD" });
      }
      active = null;
    }
    last = record!;
  })();

  active.promise = promise;
  // Never an unhandled rejection: every path above records and swallows.
  promise.catch(() => undefined);
  return { status: "started", startedAt: startedAt.toISOString(), budgetMs: PROMPT_EVOLUTION_BUDGET_MS };
}

/** Awaits the active run, if any. Tests and graceful shutdown; the HTTP door never calls it. */
export async function whenPromptEvolutionManualRunSettled(): Promise<void> {
  if (active?.promise) await active.promise;
}

export function promptEvolutionManualRunStatus(now: Date = new Date()): ManualRunStatus {
  return {
    active: active
      ? { startedAt: active.startedAt.toISOString(), elapsedMs: Math.max(0, now.getTime() - active.startedAt.getTime()), budgetMs: PROMPT_EVOLUTION_BUDGET_MS }
      : null,
    last,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Hashes, counts and reasons from the latest row. Exported for the test; the row's candidate prompt is never copied. */
export function summarizeLatestRow(raw: string | null): LatestRunSummary | null {
  if (!raw) return null;
  let row: Record<string, unknown> | null;
  try {
    row = obj(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!row) return null;
  const accepted = obj(row.accepted);
  const baseline = obj(row.baseline);
  const lanes = obj(row.lanes);
  const cohorts = obj(row.cohorts);
  const gates = obj(row.gates);
  const usage = obj(row.usage);
  const reasonOf = (g: unknown): string | null => str(obj(g)?.reason);
  const candidates = (Array.isArray(row.candidateSummaries) ? row.candidateSummaries : [])
    .map(obj)
    .filter((c): c is Record<string, unknown> => c !== null)
    .map((c) => ({
      promptHash: str(c.promptHash),
      train: str(c.train),
      rejectedInvariants: Array.isArray(c.rejectedInvariants) ? c.rejectedInvariants.filter((v): v is string => typeof v === "string") : [],
      trainMargin: num(c.trainMargin),
      trainUsable: bool(c.trainUsable),
    }));
  const trigger = row.trigger === "manual" ? "manual" : row.trigger === "scheduled" ? "scheduled" : "unknown";
  return {
    ranAt: str(row.ranAt),
    trigger,
    outcome: str(row.outcome),
    promotionStage: str(row.promotionStage),
    accepted: accepted !== null,
    confirmed: accepted?.confirmed === true,
    candidateHash: str(accepted?.promptHash) ?? str(obj(row.candidate)?.promptHash),
    baselinePromptHash: str(baseline?.promptHash),
    baselineParity: str(baseline?.parity),
    laneParity: bool(lanes?.parity),
    experimentId: str(row.experimentId),
    receiptDelivered: bool(row.receiptDelivered),
    seeds: {
      usable: num(row.usableSeeds),
      train: num(row.trainCount),
      holdout: num(row.holdoutCount),
      confirm: num(cohorts?.confirm),
      success: num(cohorts?.success),
    },
    gates: { holdout: reasonOf(gates?.holdout), success: reasonOf(gates?.success), confirmation: reasonOf(gates?.confirmation) },
    durationMs: num(usage?.durationMs),
    candidates,
  };
}

/** Reads prompt_evolution_latest and summarises it. A read error is "unknown", never an empty summary. */
export async function readLatestPromptEvolutionSummary(): Promise<{ state: "ok"; latest: LatestRunSummary | null } | { state: "unavailable"; reason: string }> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { state: "unavailable", reason: "database unavailable" };
    const rows = await db.select().from(shopSettings).where(eq(shopSettings.key, LATEST_KEY)).limit(1);
    return { state: "ok", latest: summarizeLatestRow(rows[0]?.value ?? null) };
  } catch (e) {
    return { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}

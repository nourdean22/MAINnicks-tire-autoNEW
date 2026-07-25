/**
 * Durable inbound-response obligation spine (NCSOS blueprint #1 + #2).
 *
 * THE GAP THIS CLOSES
 * Before this, an inbound customer text created a durable MESSAGE row
 * (`sms_messages.status='received'`, deduped by provider MessageSid) but NOT a
 * durable OBLIGATION TO RESPOND. The reply was computed in-process during the
 * webhook request (awaited on Twilio, fire-and-forget on the gateway). If the
 * process restarted between persisting the message and finishing the reply, the
 * obligation vanished silently — nothing ever re-scanned un-answered inbounds.
 * That is the single failure the blueprint calls out: "the system saying it will
 * do something and then forgetting."
 *
 * THE MODEL
 * Every inbound becomes a durable `sms_response_jobs` row that can only leave the
 * queue by reaching a terminal state:
 *   responded  — the AI produced a decision and dispatched a reply
 *   suppressed — the AI deliberately did not auto-send (human review / no-send)
 *   failed     — a decision was made but dispatch failed (send layer owns retry)
 *   dead       — retried `maxAttempts` times and still threw; needs a human
 * A job is retried ONLY when the orchestration THREW (the AI never decided) — a
 * completed run, even one that chose not to send, is terminal. The processor is a
 * safety net, not a second sender: the webhook still answers in-request for
 * latency; the job row guarantees nothing is quietly forgotten.
 *
 * NON-DESTRUCTIVE: purely additive. `handleInboundResponse` degrades to the exact
 * pre-spine behavior (direct `orchestrateSms`) if the job table is unreachable.
 */
import { createHash } from "node:crypto";
import { createLogger } from "../lib/logger";
import { affectedRowCount } from "../lib/db-affected";

const log = createLogger("sms-response-jobs");

/** A claimed job is reclaimable by another worker after this long (crash recovery). */
const LEASE_MS = 5 * 60_000;
/** Retry the whole orchestration at most this many times before marking `dead`. */
const MAX_ATTEMPTS = 5;
/** Backoff anchor: dueAt = now + BACKOFF_BASE_MS * attempts. */
const BACKOFF_BASE_MS = 60_000;
/** How often the safety-net processor sweeps for un-answered / stale jobs. */
const SWEEP_MS = 45_000;

/** Stable per-process id so a claim can be attributed and stale claims reclaimed. */
const INSTANCE_ID = `resp-${process.pid}-${Date.now().toString(36)}`;

export interface EnqueueInput {
  conversationId: number;
  phone: string;
  providerMsgId?: string | null;
  body: string;
}

export interface ResponseJob {
  id: number;
  conversationId: number;
  customerPhone: string;
  body: string;
  attempts: number;
}

/**
 * Deterministic idempotency key so a provider redelivery / replay maps to the
 * SAME job (INSERT IGNORE dedupes to one row). Keyed on the provider message id
 * when present, else a hash of (conversation, body) so a re-fired inbound with no
 * id still collapses instead of spawning a duplicate obligation.
 */
export function responseIdempotencyKey(input: EnqueueInput): string {
  if (input.providerMsgId) return `resp:${input.providerMsgId}`.slice(0, 191);
  const h = createHash("sha1").update(`${input.conversationId}:${input.body}`).digest("hex").slice(0, 32);
  return `resp:conv:${input.conversationId}:${h}`.slice(0, 191);
}

/** How long a human-pending obligation may wait before it counts as overdue. */
export const HUMAN_SLA_MS = 30 * 60_000;

/**
 * Map a completed orchestration result to the job's next status. A returned
 * result (no throw) is never re-orchestrated — the AI decided. But "decided"
 * no longer always means "done":
 *
 *   responded     — a reply was dispatched; the customer got an answer
 *   human_pending — a DRAFT awaits an operator (ROS-058: this used to collapse
 *                   to terminal 'suppressed', which proved the AI chose not to
 *                   send but NOT that any human ever answered; dashboards read
 *                   "handled" over waiting customers). dueAt becomes the SLA.
 *   suppressed    — genuinely no reply owed (opt-out block, rollout off)
 *   failed        — a decision was made but dispatch failed
 */
export function jobStatusFor(result: {
  status: string;
  shouldAutoSend?: boolean;
  requiresHumanApproval?: boolean;
}): "responded" | "suppressed" | "failed" | "human_pending" {
  if (result.status === "failed") return "failed";
  if (["sent", "queued", "delivered", "sending", "replied"].includes(result.status)) return "responded";
  if (result.status === "drafted" || result.requiresHumanApproval === true) return "human_pending";
  return "suppressed";
}

/** @deprecated renamed jobStatusFor when human_pending stopped being 'suppressed'. */
export const terminalStatusFor = jobStatusFor;

// ─── Enqueue ──────────────────────────────────────────────────────────────

/**
 * Durably record the obligation to respond. Idempotent: a redelivery of the same
 * inbound dedupes to the existing job. Returns null if the DB is unavailable.
 */
export async function enqueueResponseJob(input: EnqueueInput): Promise<{ jobId: number; created: boolean } | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  const key = responseIdempotencyKey(input);

  // INSERT IGNORE: affectedRows === 1 → inserted (new obligation); 0 → the
  // unique idempotency key already existed (redelivery) — dedupe to one job.
  const insertRes = await db.execute(sql`
    INSERT IGNORE INTO sms_response_jobs
      (conversationId, customerPhone, providerMsgId, idempotencyKey, body, status)
    VALUES (${input.conversationId}, ${input.phone}, ${input.providerMsgId ?? null}, ${key}, ${input.body}, 'pending')
  `);
  const created = affectedRowCount(insertRes) === 1;

  const [rows] = await db.execute(sql`SELECT id FROM sms_response_jobs WHERE idempotencyKey = ${key} LIMIT 1`);
  const row = (rows as Array<{ id: number }>)[0];
  if (!row) return null;
  return { jobId: row.id, created };
}

// ─── Claim ────────────────────────────────────────────────────────────────

/**
 * Atomically claim due `pending` jobs plus `processing` jobs whose lease expired
 * (a worker that crashed mid-run). Per-row guarded UPDATE + tuple-safe
 * affectedRowCount is the race-safe idiom this codebase already uses in
 * startDelayedQueueProcessor — a parallel worker that claimed the row first
 * bumps claimedAt to now, so the stale-processing branch no longer matches it.
 */
export async function claimDueResponseJobs(limit = 20): Promise<ResponseJob[]> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  const leaseCutoff = new Date(Date.now() - LEASE_MS);

  const [candidateRows] = await db.execute(sql`
    SELECT id FROM sms_response_jobs
    WHERE (status = 'pending' AND dueAt <= NOW())
       OR (status = 'processing' AND claimedAt < ${leaseCutoff})
    ORDER BY dueAt ASC
    LIMIT ${limit}
  `);
  const candidates = candidateRows as Array<{ id: number }>;

  const claimed: ResponseJob[] = [];
  for (const c of candidates) {
    const claimRes = await db.execute(sql`
      UPDATE sms_response_jobs
      SET status = 'processing', claimedAt = NOW(), claimedBy = ${INSTANCE_ID}, attempts = attempts + 1
      WHERE id = ${c.id}
        AND ( (status = 'pending' AND dueAt <= NOW())
           OR (status = 'processing' AND claimedAt < ${leaseCutoff}) )
    `);
    if (affectedRowCount(claimRes) !== 1) continue; // lost the race — another worker has it

    const [rows] = await db.execute(sql`
      SELECT id, conversationId, customerPhone, body, attempts
      FROM sms_response_jobs WHERE id = ${c.id} LIMIT 1
    `);
    const row = (rows as Array<ResponseJob>)[0];
    if (row) claimed.push(row);
  }
  return claimed;
}

// ─── Complete / fail ──────────────────────────────────────────────────────

async function setJobStatus(
  jobId: number,
  status: "responded" | "suppressed" | "failed" | "dead" | "pending" | "human_pending",
  opts: { orchestrationId?: number; lastError?: string; dueAt?: Date } = {},
): Promise<void> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return;
  // dueAt: keep the existing anchor for terminal states (no dueAt passed); for a
  // pending re-queue the caller passes the backoff time. COALESCE handles both.
  await db.execute(sql`
    UPDATE sms_response_jobs
    SET status = ${status},
        orchestrationId = COALESCE(${opts.orchestrationId ?? null}, orchestrationId),
        lastError = ${opts.lastError ?? null},
        dueAt = COALESCE(${opts.dueAt ?? null}, dueAt),
        claimedAt = NULL,
        claimedBy = NULL
    WHERE id = ${jobId}
  `);
}

// ─── Run one claimed job ──────────────────────────────────────────────────

/**
 * Run a claimed job: orchestrate the reply, then mark the job terminal. A THROW
 * (orchestration never produced a decision) is the only retryable outcome —
 * re-queue with backoff until maxAttempts, then `dead`.
 */
export async function runResponseJob(job: ResponseJob): Promise<void> {
  try {
    const { orchestrateSms } = await import("./smsOrchestrator");
    const result = await orchestrateSms({
      type: "inbound_sms",
      phone: job.customerPhone,
      body: job.body,
      conversationId: job.conversationId,
    });
    const next = jobStatusFor(result);
    if (next === "human_pending") {
      // The obligation transfers to a HUMAN with a deadline — dueAt becomes
      // the SLA anchor the summary counts overdue against. The claim guards
      // only touch pending/processing, so a human_pending job is never
      // re-orchestrated; it closes via an operator action (manual reply,
      // approved draft send, or an explicit no-reply-needed).
      await setJobStatus(job.id, "human_pending", { orchestrationId: result.id, dueAt: new Date(Date.now() + HUMAN_SLA_MS) });
    } else {
      await setJobStatus(job.id, next, { orchestrationId: result.id });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (job.attempts >= MAX_ATTEMPTS) {
      log.error("response job dead after max attempts", { jobId: job.id, attempts: job.attempts, error: msg });
      await setJobStatus(job.id, "dead", { lastError: msg });
    } else {
      const dueAt = new Date(Date.now() + BACKOFF_BASE_MS * job.attempts);
      log.warn("response job threw, re-queuing with backoff", { jobId: job.id, attempts: job.attempts, dueAt, error: msg });
      await setJobStatus(job.id, "pending", { lastError: msg, dueAt });
    }
  }
}

// ─── Webhook entry: durable + low-latency, with safe fallback ──────────────

/**
 * The single call the inbound webhooks use. Enqueues the durable obligation, then
 * claims+runs it immediately for latency. If the job infrastructure is
 * unavailable (e.g. the table is not migrated yet), it degrades to the exact
 * pre-spine behavior so an inbound is NEVER dropped.
 */
export async function handleInboundResponse(input: EnqueueInput): Promise<void> {
  let enqueued: { jobId: number; created: boolean } | null = null;
  try {
    enqueued = await enqueueResponseJob(input);
  } catch (err) {
    log.warn("enqueueResponseJob failed; falling back to direct orchestrate", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!enqueued) {
    // Fallback: preserve today's behavior exactly.
    const { orchestrateSms } = await import("./smsOrchestrator");
    await orchestrateSms({ type: "inbound_sms", phone: input.phone, body: input.body, conversationId: input.conversationId });
    return;
  }

  // Claim this specific job and run it now. If a concurrent processor already
  // claimed it, our claim finds nothing and we return — the other runner owns it.
  const claimed = await claimJobById(enqueued.jobId);
  if (claimed) await runResponseJob(claimed);
}

/** Claim one job by id (webhook fast path). Mirrors claimDueResponseJobs' guard. */
async function claimJobById(jobId: number): Promise<ResponseJob | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  const leaseCutoff = new Date(Date.now() - LEASE_MS);
  const claimRes = await db.execute(sql`
    UPDATE sms_response_jobs
    SET status = 'processing', claimedAt = NOW(), claimedBy = ${INSTANCE_ID}, attempts = attempts + 1
    WHERE id = ${jobId}
      AND ( (status = 'pending' AND dueAt <= NOW())
         OR (status = 'processing' AND claimedAt < ${leaseCutoff}) )
  `);
  if (affectedRowCount(claimRes) !== 1) return null;
  const [rows] = await db.execute(sql`
    SELECT id, conversationId, customerPhone, body, attempts
    FROM sms_response_jobs WHERE id = ${jobId} LIMIT 1
  `);
  return (rows as Array<ResponseJob>)[0] ?? null;
}

// ─── Human-pending resolution (ROS-058) ────────────────────────────────────

/**
 * Close open human_pending obligations for a conversation. Called by the
 * operator paths that PROVE a human acted: the manual/approved-draft send
 * (→ human_replied) and the explicit no-reply-needed action
 * (→ no_reply_required). Returns how many obligations closed.
 */
export async function resolveHumanPendingForConversation(
  conversationId: number,
  resolution: "human_replied" | "no_reply_required",
): Promise<number> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return 0;
  const res = await db.execute(sql`
    UPDATE sms_response_jobs
    SET status = ${resolution}
    WHERE conversationId = ${conversationId} AND status = 'human_pending'
  `);
  const closed = affectedRowCount(res);
  if (closed > 0) log.info("human-pending obligations resolved", { conversationId, resolution, closed });
  return closed;
}

export interface HumanPendingSummary {
  humanPending: number;
  overdue: number;
  oldestWaitingMinutes: number | null;
}

/**
 * The Needs-Reply truth for the admin: how many customers are waiting on a
 * human, how many have blown the SLA (dueAt in the past), and how long the
 * oldest has been waiting. Throws on DB unavailability — the caller must
 * render UNKNOWN, never zero (the admin-truth rule).
 */
export async function humanPendingSummary(): Promise<HumanPendingSummary> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("database unavailable — human-pending count is UNKNOWN, not zero");
  const [rows] = await db.execute(sql`
    SELECT COUNT(*) AS humanPending,
           COALESCE(SUM(CASE WHEN dueAt < NOW() THEN 1 ELSE 0 END), 0) AS overdue,
           TIMESTAMPDIFF(MINUTE, MIN(createdAt), NOW()) AS oldestWaitingMinutes
    FROM sms_response_jobs
    WHERE status = 'human_pending'
  `);
  const row = (rows as Array<{ humanPending: number | string; overdue: number | string; oldestWaitingMinutes: number | string | null }>)[0];
  return {
    humanPending: Number(row?.humanPending ?? 0),
    overdue: Number(row?.overdue ?? 0),
    oldestWaitingMinutes: row?.oldestWaitingMinutes == null ? null : Number(row.oldestWaitingMinutes),
  };
}

// ─── Safety-net processor (boot rehydrate + interval sweep) ────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the safety-net processor. On boot AND every SWEEP_MS it claims any
 * un-answered `pending` jobs (a restart lost the in-request run) and reclaims
 * stale `processing` jobs (a worker crashed mid-run), then runs them. THIS is the
 * piece that makes the obligation survive a restart — the gap the survey proved.
 */
export function startResponseJobProcessor(): void {
  if (sweepTimer) return;
  const sweep = async () => {
    try {
      const jobs = await claimDueResponseJobs(20);
      if (jobs.length) log.info(`response-job sweep claimed ${jobs.length}`);
      for (const job of jobs) await runResponseJob(job);
    } catch (err) {
      log.warn("response-job sweep failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  void sweep(); // boot rehydrate
  sweepTimer = setInterval(() => { void sweep(); }, SWEEP_MS);
  log.info("SMS response-job processor started");
}

export function stopResponseJobProcessor(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

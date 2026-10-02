/**
 * lib/system/capability-health.ts · 2026-10-02 · full-circle Lane A
 *
 * The durable receipt for a guarded capability that keeps failing. Before
 * this file a guardian terminal failure was `log.warn` + an in-memory circuit
 * breaker + a thrown error: Railway showed `guardian_call_failed` for
 * `firecrawl-scrape` (insufficient credits) for a day while the Owner Panel,
 * the one owner-exception surface, had no source to read. Logs are not a
 * source the panel can project.
 *
 * Reuses the incumbent `integrations` table (status healthy / degraded /
 * failed / disabled, `consecutiveFailures`, `errorCount`, `metadata`) with
 * `type = "capability"`, one row per guardian tool name. No new table.
 *
 * Rules:
 *   · never throws, never blocks the guarded call on a slow or dead database
 *     beyond the one read + write a failure costs; a recording error is a
 *     warn log, never the caller's error;
 *   · a row of any other type (a real OAuth integration that happens to share
 *     a name) is never touched, and a row the operator disabled is left alone;
 *   · `degraded` after CAPABILITY_DEGRADED_AFTER consecutive terminal
 *     failures; the first success afterwards sets it back to `healthy` and
 *     resets the streak (errorCount keeps the lifetime total);
 *   · one recovery write per process per tool until the next failure, so the
 *     success path costs a Set lookup, not a query;
 *   · while already degraded, failures closer than CAPABILITY_WRITE_THROTTLE_MS
 *     only update memory — a hot loop against a dead provider must not become
 *     a hot loop against the database.
 *
 * Projection: lib/system/owner-panel.ts `capability_degraded`.
 * Canary: tests/lib/system/capability-health.test.ts ·
 *         tests/tools/guardian-capability-receipt.test.ts.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("system/capability-health");

/** `integrations.type` for rows this module owns. */
export const CAPABILITY_INTEGRATION_TYPE = "capability";
/** Consecutive terminal failures before a capability row reads `degraded`. */
export const CAPABILITY_DEGRADED_AFTER = 3;
/** Already degraded: failures closer together than this only update memory. */
export const CAPABILITY_WRITE_THROTTLE_MS = 10_000;

export interface CapabilityFailure {
  toolName: string;
  /** Guardian FailureCategory (api_timeout, rate_limit, auth_expired, unknown, ...). */
  category: string;
  error: string;
  at?: Date;
}

interface ToolMemory {
  lastWriteAt: number;
  degraded: boolean;
  /** A recovery was written (or attempted) since the last failure in this process. */
  recoveryWritten: boolean;
}

const memory = new Map<string, ToolMemory>();
let noDatabaseLogged = false;

/**
 * No connection string means there is nothing to write to (unit tests, a shell
 * without env). Said once at debug, then silent: the guardian must stay cheap.
 * lib/prisma.ts reads the same variable to build its client.
 */
function noDatabase(): boolean {
  if (process.env.DATABASE_URL) return false;
  if (!noDatabaseLogged) {
    noDatabaseLogged = true;
    log.debug("capability_receipts_disabled_no_database");
  }
  return true;
}

function mem(toolName: string): ToolMemory {
  let m = memory.get(toolName);
  if (!m) {
    m = { lastWriteAt: 0, degraded: false, recoveryWritten: false };
    memory.set(toolName, m);
  }
  return m;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const describe = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);

/**
 * Record one terminal failure (retries exhausted, or a non-retryable class).
 * Call it at the failure boundary, after the breaker, before the throw.
 */
export async function recordCapabilityFailure(f: CapabilityFailure): Promise<void> {
  const at = f.at ?? new Date();
  const m = mem(f.toolName);
  // The next success must write a recovery again.
  m.recoveryWritten = false;
  if (m.degraded && at.getTime() - m.lastWriteAt < CAPABILITY_WRITE_THROTTLE_MS) return;
  if (noDatabase()) return;

  try {
    const existing = await prisma.integration.findUnique({
      where: { name: f.toolName },
      select: { type: true, status: true, enabled: true, consecutiveFailures: true, metadata: true },
    });
    if (existing && existing.type !== CAPABILITY_INTEGRATION_TYPE) return; // another integration owns this name
    if (existing && !existing.enabled) return; // the operator disabled this capability on purpose

    const consecutive = (existing?.consecutiveFailures ?? 0) + 1;
    const degraded = consecutive >= CAPABILITY_DEGRADED_AFTER;
    const prev = isRecord(existing?.metadata) ? existing.metadata : {};
    const firstFailureAt =
      existing && existing.consecutiveFailures > 0 && typeof prev.firstFailureAt === "string"
        ? prev.firstFailureAt
        : at.toISOString();
    const metadata = {
      ...prev,
      source: "guardian",
      lastCategory: f.category,
      lastError: f.error.slice(0, 500),
      lastFailureAt: at.toISOString(),
      firstFailureAt,
    };
    const status = degraded ? "degraded" : (existing?.status ?? "healthy");

    await prisma.integration.upsert({
      where: { name: f.toolName },
      create: {
        name: f.toolName,
        type: CAPABILITY_INTEGRATION_TYPE,
        enabled: true,
        status,
        errorCount: 1,
        consecutiveFailures: 1,
        metadata,
      },
      update: {
        status,
        errorCount: { increment: 1 },
        consecutiveFailures: { increment: 1 },
        metadata,
      },
    });
    m.degraded = degraded;
    m.lastWriteAt = at.getTime();
    // One line per write (bounded by the throttle): the runtime receipt a reader
    // without database access can verify in Railway logs.
    log.info("capability_receipt_written", { toolName: f.toolName, status, consecutive, category: f.category });
  } catch (error) {
    log.warn("capability_failure_receipt_failed", { toolName: f.toolName, error: describe(error) });
  }
}

/**
 * Record that a guarded call succeeded. Cheap on the hot path: after the first
 * success per process (or the first after a failure) this is a Set lookup.
 * A database error here is logged once and NOT retried on every later success:
 * a dead database must not turn every healthy call into a failing query.
 */
export async function recordCapabilityRecovery(toolName: string): Promise<void> {
  const m = mem(toolName);
  if (m.recoveryWritten) return;
  if (noDatabase()) return;
  m.recoveryWritten = true;

  try {
    const existing = await prisma.integration.findUnique({
      where: { name: toolName },
      select: { type: true, status: true, consecutiveFailures: true, metadata: true },
    });
    if (!existing || existing.type !== CAPABILITY_INTEGRATION_TYPE) return;
    if (existing.status === "healthy" && existing.consecutiveFailures === 0) {
      m.degraded = false;
      return;
    }
    const prev = isRecord(existing.metadata) ? existing.metadata : {};
    await prisma.integration.update({
      where: { name: toolName },
      data: {
        status: "healthy",
        consecutiveFailures: 0,
        metadata: { ...prev, lastRecoveryAt: new Date().toISOString() },
      },
    });
    m.degraded = false;
    log.info("capability_recovery_written", { toolName, previousStatus: existing.status, previousConsecutive: existing.consecutiveFailures });
  } catch (error) {
    log.warn("capability_recovery_receipt_failed", { toolName, error: describe(error) });
  }
}

/** Test-only · forgets every tool's in-process state. */
export function __resetCapabilityHealthMemory(): void {
  memory.clear();
  noDatabaseLogged = false;
}

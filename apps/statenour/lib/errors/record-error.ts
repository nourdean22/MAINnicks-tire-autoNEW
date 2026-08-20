/**
 * recordError — unified error capture for anything that used to be a
 * silent `.catch(() => {})`.
 *
 * Writes to the existing `auditEvent` table with `eventType: "ai_error"`
 * so we don't need a new table or migration. The NotificationCenter HUD
 * component polls `/api/ai/errors/recent` every 60s and surfaces any
 * error bursts as a top-of-feed alert so Nour actually sees when the
 * chat pipeline is quietly rotting.
 *
 * Usage (replace every `.catch(() => {})` pattern):
 *
 *   // BEFORE
 *   processConversation(u, t).catch(() => {});
 *
 *   // AFTER
 *   processConversation(u, t).catch((err) => recordError("chat:post-process", err));
 *
 * For task-scoped logging:
 *
 *   await withErrorCapture("runPeopleIntelligence", async () => {
 *     return runPeopleIntelligence();
 *   });
 *
 * Every call is fire-and-forget itself (it swallows DB write failures
 * rather than cascading), but every failure is now observable in:
 *   - /api/ai/errors/recent
 *   - NotificationCenter HUD
 *   - Direct DB query on auditEvent WHERE eventType = 'ai_error'
 */

import { prisma } from "@/lib/prisma";

export type ErrorDomain =
  | "chat:request"
  | "chat:stream"
  | "chat:db-write"
  | "chat:prompt-build"
  | "chat:post-process"
  | "chat:people-intel"
  | "chat:journal-ingest"
  | "chat:conversation-memory"
  | "chat:actions"
  | "chat:image-gen"
  | "chat:decision-capture"
  | "chat:brain-dump-capture"
  | "chat:slash-save"
  | "chat:compression"
  | "chat:recall" // v10.0.92 hybrid memory recall block
  | "ai:provider"
  | "ai:embedding"
  | "ai:tool-exec"
  | "ai:compression" // v10.0.529.106 wave-74 · conversation-compress.ts summary writes
  | "ai:suggestion-metric" // v10.0.529.106 wave-74 · suggestion-cache persistMetric
  | "ai:agent-feedback" // v10.0.529.106 wave-74 · nick-agent feedbackLoop
  | "integrations:make" // v10.0.529.106 wave-74 · notifyMake webhook posts
  | "notifications:audit" // v10.0.529.106 wave-74 · push notification audit-log writes
  | "notifications:cooldown" // 2026-08-20 · per-tag push flood-control check (fails open to sending)
  | "brain:memory-embedding" // v10.0.529.106 wave-77 · memory-manager storeMemoryEmbedding
  | "brain:memory-recall" // v10.0.529.106 wave-77 · memory-recall lastSeen bump
  | "brain:memory-consolidation" // v10.0.529.106 wave-77 · memory-consolidation graph link writes
  | "brain:pipeline-controller" // v10.0.529.106 wave-77 · pipeline-controller commitment + audit writes
  | "brain:knowledge-sync" // v10.0.529.106 wave-77 · knowledge-sync task/commitment/memory writes
  | "brain:relational-graph" // v10.0.529.106 wave-77 · relational-graph label fetchers
  | "brain:journal-ingest" // v10.0.529.106 wave-77 · journal-ingest task/commitment/telegram writes
  | "db:brain-bus-durable" // v10.0.529.106 wave-77 · brain-bus-durable dead-event escalation writes
  | "cron:job"
  | "api:unknown";

interface ErrorPayload {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Record an error to the audit log. Never throws — DB failure is
 * silently absorbed so error recording itself can't break a request.
 *
 * Domain is a short stable string like "chat:stream" — makes grouping
 * errors by source trivial from the HUD side.
 */
export function recordError(
  domain: ErrorDomain,
  err: unknown,
  context?: Record<string, unknown>
): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    const payload: ErrorPayload = { message };
    if (stack) payload.stack = stack.slice(0, 2000);
    if (context) payload.context = context;

    // Also log to console so server logs capture the detail even if DB is down
    console.error(`[recordError] ${domain}: ${message}`, context || "");

    // Fire and forget — we don't await. If this throws, .catch swallows it.
    prisma.auditEvent
      .create({
        data: {
          actor: domain.split(":")[0] || "system",
          eventType: "ai_error",
          detail: `${domain}: ${message.slice(0, 240)}`,
          payload: JSON.parse(JSON.stringify(payload)),
        },
      })
      .catch(() => {});
  } catch {
    // Last-resort swallow — recordError must never throw.
  }
}

/**
 * Wrap any async task with error capture + optional timeout.
 *
 * Returns the task's result on success. On error or timeout, records
 * the error to the audit log and returns `undefined` (caller should
 * treat as "task did not complete").
 *
 * Options:
 *   timeoutMs       — hard cap; task gets rejected after this elapses
 *   context         — extra fields stored with the error record
 *   silentTimeout   — when TRUE, timeouts are logged to console but NOT
 *                     to the ai_error audit channel (used for background
 *                     post-processing where a timeout is expected
 *                     degradation under load, not a real failure)
 *
 * Usage:
 *
 *   const result = await withErrorCapture(
 *     "chat:people-intel",
 *     () => runPeopleIntelligence(),
 *     { timeoutMs: 10_000, silentTimeout: true, context: { conversationId: convId } }
 *   );
 */
export async function withErrorCapture<T>(
  domain: ErrorDomain,
  task: () => Promise<T>,
  options?: {
    timeoutMs?: number;
    context?: Record<string, unknown>;
    silentTimeout?: boolean;
  }
): Promise<T | undefined> {
  const { timeoutMs, context, silentTimeout } = options || {};

  try {
    if (timeoutMs && timeoutMs > 0) {
      return await Promise.race([
        task(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);
    }
    return await task();
  } catch (err) {
    // Silent-timeout: log to console + swallow. Used for background post-
    // processing where a timeout is a routine load-shedding event — real
    // errors (exceptions thrown by the task itself) still surface.
    const isTimeout =
      err instanceof Error && /^Task timed out after \d+ms$/.test(err.message);
    if (isTimeout && silentTimeout) {
      console.warn(`[withErrorCapture:silent-timeout] ${domain}: ${(err as Error).message}`);
      return undefined;
    }
    recordError(domain, err, context);
    return undefined;
  }
}

/**
 * Get a count of recent ai_error audit events for the HUD pulse.
 * Use with a generous window (60min) — the point is to show bursts,
 * not noise.
 */
export async function getRecentErrorCount(windowMinutes = 60): Promise<number> {
  try {
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const count = await prisma.auditEvent.count({
      where: {
        eventType: "ai_error",
        createdAt: { gte: since },
      },
    });
    return count;
  } catch {
    return 0;
  }
}

/**
 * Get the most recent error audit events for the HUD drawer. Each
 * entry includes domain, message, and time so the HUD can show a
 * specific list (not just a count).
 */
export async function getRecentErrors(
  windowMinutes = 60,
  limit = 20
): Promise<
  Array<{
    id: string;
    domain: string;
    detail: string;
    createdAt: string;
  }>
> {
  try {
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const rows = await prisma.auditEvent.findMany({
      where: {
        eventType: "ai_error",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        actor: true,
        detail: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      domain: r.actor,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

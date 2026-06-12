/**
 * Brain-bus durable consumer registry · v10 Track B.2.1 · Apr 30.
 *
 * The v10.0.1 backfill cron (B.2) shipped with a default no-op
 * handler. Topic-routed consumers had nowhere to register, so any
 * future producer would write rows that never trigger real work.
 *
 * This module fixes that gap: it's the central registry the cron +
 * any future LISTEN-path consumer dispatch through.
 *
 * Architecture decision (per Round 1 audit "in-memory state survives
 * the worker, not the lambda"):
 *
 *   · Registration is STATIC at module-import time, not runtime
 *     mutation. Vercel cold-starts a lambda fresh; an in-memory
 *     register-then-publish pattern would silently lose handlers.
 *   · Handlers are declared in HANDLERS below and the dispatch
 *     function is the single entry point. Adding a new consumer
 *     means adding a row here + the handler module.
 *   · Topics are matched by exact name first, then by prefix
 *     (`brain.*` matches `brain.alert`, `brain.contradiction`, etc.)
 *
 * Composes with brain-bus-durable.ts: this is the layer above
 * pollAndProcess, providing real routing instead of a no-op handler.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import type { DurableEvent } from "./brain-bus-durable";

const log = rootLogger.withSurface("brain-bus/dispatch");

export interface HandlerContext {
  /** Worker that claimed the event — useful for trace + logging. */
  workerId: string;
  /** Whether this handler is being run from the polling backfill (vs LISTEN path). */
  fromBackfill: boolean;
}

export type DurableHandler = (
  event: DurableEvent,
  ctx: HandlerContext,
) => Promise<void>;

/**
 * Topic → handler map. Exact-match first; if no exact match, the
 * dispatcher tries prefix matches in declaration order.
 *
 * All handlers run with errors caught by the dispatcher — a failure
 * here surfaces to markFailed() for retry, not the cron itself.
 *
 * Adding a new consumer:
 *   1. Add the handler function here (or import from a sibling file).
 *   2. Register it in HANDLERS below.
 *   3. Producer side calls publishDurable("topic-name", "event-type", payload)
 *      and the polling cron + LISTEN path both route through dispatch().
 */
const HANDLERS: Array<{ topic: string; handler: DurableHandler }> = [
  // v10.0.20 · cron.failure handler. Records the failure in
  // BrainMemory under category `system_alert` so /brain searches
  // surface it + the operator's morning brief sees it. Dedupe at
  // the BrainMemory layer too via the event id as the key.
  {
    topic: "cron.failure",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        jobName?: string;
        error?: string;
        durationMs?: number;
        failedAt?: string;
      };
      const jobName = payload.jobName ?? "unknown";
      const error = payload.error ?? "no error message";
      log.warn("cron.failure", {
        jobName,
        eventId: event.id,
        attempts: event.attempts,
        worker: ctx.workerId,
      });
      try {
        // v10.0.26 — switched from upsert({update:{}}) to a
        // findUnique → conditional create so repeat dispatches are
        // a true no-op. Prior upsert with empty update body still
        // bumped updatedAt, polluting the brain-recall recency
        // signal (BrainMemory.updatedAt feeds several "recently
        // modified" sorts). This shape gives genuine idempotency.
        const memKey = `cron-failure-${event.id}`;
        const existing = await prisma.brainMemory.findUnique({
          where: {
            category_key: { category: "system_alert", key: memKey },
          },
          select: { id: true },
        });
        if (!existing) {
          await prisma.brainMemory.create({
            data: {
              category: "system_alert",
              key: memKey,
              content: `Cron \`${jobName}\` failed: ${error.slice(0, 400)}`,
              source: "brain-bus:cron.failure",
              confidence: 0.95,
              metadata: {
                eventId: event.id,
                jobName,
                error: error.slice(0, 1000),
                durationMs: payload.durationMs ?? null,
                failedAt: payload.failedAt ?? null,
              } as never,
            },
          });
        }
      } catch (err) {
        // v10.0.27 · P2002 race recovery. Two workers (LISTEN consumer
        // + polling backfill cron) can both claim the same event in a
        // narrow window between findUnique and create. The second
        // create gets a unique-violation. The row IS persisted by the
        // first worker — this is success, not failure. Treat P2002 as
        // a silent no-op so the dashboard doesn't show false errors.
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return; // race won by sibling — already written
        // Surface real errors but don't throw — markFailed retry would
        // fire the same handler again pointlessly.
        log.error("cron.failure.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.63 · drift.fired · writes a drift_history BrainMemory row
  // so the brain pipeline + chat search can surface drift trends
  // (separate from the alert-telegram-bridge which fires the live
  // Telegram). Idempotent via key = "drift_${ruleId}_${date}".
  {
    topic: "drift.fired",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        alertId?: string;
        ruleId?: string;
        ruleName?: string;
        severity?: string;
        message?: string;
        date?: string;
      };
      const ruleId = payload.ruleId ?? "unknown";
      const date = payload.date ?? new Date().toISOString().slice(0, 10);
      const memKey = `drift_${ruleId}_${date}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "drift_history", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          await prisma.brainMemory.create({
            data: {
              category: "drift_history",
              key: memKey,
              content: `[${payload.severity ?? "?"}] ${payload.ruleName ?? ruleId}: ${(payload.message ?? "").slice(0, 400)}`,
              source: "brain-bus:drift.fired",
              confidence: 0.95,
              metadata: {
                eventId: event.id,
                alertId: payload.alertId ?? null,
                ruleId,
                date,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return; // race won by sibling worker
        log.error("drift.fired.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.63 · commitment.transition · records every status change
  // so the decision-pattern engine can learn the transition arc
  // (active → broken vs active → completed). Each transition is a
  // unique row keyed by (id, newStatus, minute-bucket).
  {
    topic: "commitment.transition",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        commitmentId?: number;
        oldStatus?: string | null;
        newStatus?: string;
        description?: string;
        toWhom?: string | null;
        domain?: string | null;
        transitionedAt?: string;
      };
      const id = payload.commitmentId ?? 0;
      const newStatus = payload.newStatus ?? "unknown";
      const ts = payload.transitionedAt ?? new Date().toISOString();
      const minuteBucket = Math.floor(new Date(ts).getTime() / 60_000);
      const memKey = `commit_${id}_${newStatus}_${minuteBucket}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "commitment_event", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          const arc = `${payload.oldStatus ?? "?"}→${newStatus}`;
          const desc = (payload.description ?? "(no description)").slice(0, 240);
          const toWhom = payload.toWhom ? ` (to ${payload.toWhom.slice(0, 40)})` : "";
          await prisma.brainMemory.create({
            data: {
              category: "commitment_event",
              key: memKey,
              content: `Commitment ${arc}${toWhom}: "${desc}"`,
              source: "brain-bus:commitment.transition",
              confidence: 1.0,
              metadata: {
                eventId: event.id,
                commitmentId: id,
                oldStatus: payload.oldStatus ?? null,
                newStatus,
                domain: payload.domain ?? null,
                transitionedAt: ts,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("commitment.transition.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.63 · task.completed · writes a task_completion BrainMemory
  // row so chat queries like "what did I get done today" hit semantic
  // search instead of having to query prisma.task.findMany. Same-day
  // dedupe so re-marks don't double-record.
  {
    topic: "task.completed",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        taskId?: string;
        title?: string;
        missionId?: string | null;
        domain?: string | null;
        loopKind?: string;
        completedAt?: string;
      };
      const taskId = payload.taskId ?? "unknown";
      const completedAt = payload.completedAt ?? new Date().toISOString();
      const dateKey = completedAt.slice(0, 10);
      const memKey = `task_${taskId}_${dateKey}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "task_completion", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          const title = (payload.title ?? "(untitled)").slice(0, 240);
          const dom = payload.domain ? ` [${payload.domain.slice(0, 30)}]` : "";
          await prisma.brainMemory.create({
            data: {
              category: "task_completion",
              key: memKey,
              content: `Completed${dom}: ${title}`,
              source: "brain-bus:task.completed",
              confidence: 1.0,
              metadata: {
                eventId: event.id,
                taskId,
                missionId: payload.missionId ?? null,
                loopKind: payload.loopKind ?? "ONCE",
                completedAt,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("task.completed.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.63 · score.logged · day-by-day score history. identity_
  // snapshot category="current" key="current" is the live snapshot
  // (one row, mutated). This handler builds a per-day timeline by
  // writing score_event rows keyed by date, so the brain pipeline
  // can compute trends without parsing the snapshot's history JSON.
  {
    topic: "score.logged",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        date?: string;
        snapshot?: unknown;
        source?: string;
      };
      const date = payload.date ?? new Date().toISOString().slice(0, 10);
      const memKey = `score_${date}`;
      try {
        // Upsert (not findUnique→create) — score for a given date
        // legitimately gets re-written multiple times in a day as
        // the snapshot rolls. We want the latest content, but only
        // one row per date.
        await prisma.brainMemory.upsert({
          where: { category_key: { category: "score_event", key: memKey } },
          create: {
            category: "score_event",
            key: memKey,
            content: JSON.stringify(payload.snapshot ?? {}),
            source: `brain-bus:score.logged·${payload.source ?? "?"}`,
            confidence: 1.0,
            metadata: {
              eventId: event.id,
              date,
              source: payload.source ?? null,
              worker: ctx.workerId,
            } as never,
          },
          update: {
            content: JSON.stringify(payload.snapshot ?? {}),
            metadata: {
              eventId: event.id,
              date,
              source: payload.source ?? null,
              worker: ctx.workerId,
            } as never,
          },
        });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("score.logged.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.63 · autonomous.fired · trend tracking for which rules
  // fire how often + their result distribution. Dedupes via the
  // engine's existing idempotencyKey (rule + target + 1h bucket).
  {
    topic: "autonomous.fired",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        ruleName?: string;
        actionType?: string;
        targetType?: string;
        targetId?: string | null;
        result?: string;
        error?: string;
        idempotencyKey?: string;
      };
      const memKey = payload.idempotencyKey ?? `auto_${event.id}`;
      try {
        const rule = payload.ruleName ?? "unknown";
        const result = payload.result ?? "?";
        // v10.0.198 → v10.0.529.106 Wave 53 · canonical typed write.
        // Idempotent on eventId @unique · a retry of the same event
        // is a P2002 no-op caught below. The BrainMemory dual-write
        // ran from v10.0.198 to Wave 53 (two weeks of parity proven
        // in prod) · zero readers consumed the BrainMemory rows so
        // the cutover is invisible to operator surfaces. Legacy
        // rows age out via the category-ttl pass (7d, deprecated).
        // The structured logger.warn surfaces failures in
        // /system/errors so diagnosis is a SQL query, not a Vercel-
        // logs hunt.
        await prisma.autonomousEvent.create({
          data: {
            eventId: memKey.slice(0, 80),
            ruleName: rule.slice(0, 120),
            actionType: (payload.actionType ?? null)?.slice(0, 80) ?? null,
            targetType: (payload.targetType ?? null)?.slice(0, 80) ?? null,
            targetId: payload.targetId ?? null,
            result: result.slice(0, 40),
            errorMessage: payload.error ?? null,
            worker: ctx.workerId?.slice(0, 80) ?? null,
          },
        }).catch((e: unknown) => {
          const err = e as { code?: string; message?: string; meta?: unknown };
          if (err?.code === "P2002") return; // already persisted · normal
          log.warn("autonomous_event_typed_write_failed", {
            eventId: memKey.slice(0, 80),
            code: err?.code,
            message: err?.message?.slice(0, 200),
            meta: err?.meta,
          });
        });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("autonomous.fired.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.78 · goal.transition handler · same shape as commitment.transition
  // — write a long-term BrainMemory row keyed by goalId+status+date so the
  // brain pipeline + chat search can surface "what did Nour do with goal X
  // when?" without polling the LifeGoal table.
  {
    topic: "goal.transition",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        goalId?: string;
        oldStatus?: string | null;
        newStatus?: string;
        title?: string;
        domain?: string | null;
        horizon?: string | null;
        transitionedAt?: string;
      };
      const date = payload.transitionedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const memKey = `goal_${payload.goalId}_${payload.newStatus}_${date}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "goal_event", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          await prisma.brainMemory.create({
            data: {
              category: "goal_event",
              key: memKey,
              content: `Goal "${payload.title ?? "?"}" → ${payload.newStatus ?? "?"}${payload.oldStatus ? ` (was ${payload.oldStatus})` : ""}`,
              source: "brain-bus:goal.transition",
              confidence: 1.0,
              metadata: {
                eventId: event.id,
                goalId: payload.goalId ?? null,
                oldStatus: payload.oldStatus ?? null,
                newStatus: payload.newStatus ?? null,
                domain: payload.domain ?? null,
                horizon: payload.horizon ?? null,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("goal.transition.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // v10.0.78 · reflection.created handler · downstream learning-journal
  // and wisdom-distiller can subscribe to fresh reflections without
  // polling. Long-term BrainMemory mirror keyed by reflection id.
  //
  // Phase D follow-up (2026-05-18) · also fires the journal pattern-radar
  // auto-join hook for the new reflection. This was missing from the
  // initial Phase D ship which only wired BrainDump capture · per
  // ADR-0013 the radar should grow threads from ALL 4 journal sources.
  // The hook is fire-and-forget · errors don't fail the handler.
  {
    topic: "reflection.created",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        reflectionId?: string;
        date?: string;
        scope?: string;
        category?: string;
        insight?: string;
        actionable?: boolean;
      };
      const memKey = `reflection_${payload.reflectionId ?? event.id}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "reflection_event", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          await prisma.brainMemory.create({
            data: {
              category: "reflection_event",
              key: memKey,
              content: `[${payload.scope ?? "?"} · ${payload.category ?? "?"}${payload.actionable ? " · actionable" : ""}] ${(payload.insight ?? "").slice(0, 280)}`,
              source: "brain-bus:reflection.created",
              confidence: 1.0,
              metadata: {
                eventId: event.id,
                reflectionId: payload.reflectionId ?? null,
                date: payload.date ?? null,
                scope: payload.scope ?? null,
                category: payload.category ?? null,
                actionable: payload.actionable ?? false,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("reflection.created.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Phase D · ADR-0013 · journal pattern-radar auto-join hook for
      // reflections. Fire-and-forget · captures the reflection insight
      // (the body the cosine will run against) so the new entry can
      // either silently join an active thread (sim ≥ 0.80) or surface
      // a suggestion (0.65-0.80). Errors logged only · never fails
      // the handler.
      if (payload.reflectionId && payload.insight) {
        try {
          const { tryJoinActiveThreads } = await import(
            "@/lib/services/journal-threads"
          );
          await tryJoinActiveThreads(
            "reflection",
            payload.reflectionId,
            payload.insight,
          );
        } catch (err) {
          log.warn("reflection.created.thread_join_failed", {
            eventId: event.id,
            reflectionId: payload.reflectionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  },

  // v10.0.78 · brain_dump.finalized handler · subscribers (knowledge-sync,
  // emotional-arc, search-grounding) can react to fresh dumps without
  // polling the BrainDump table.
  {
    topic: "brain_dump.finalized",
    handler: async (event, ctx) => {
      const payload = (event.payload ?? {}) as {
        brainDumpId?: string;
        date?: string;
        mode?: string;
        extracted?: boolean;
        rawChars?: number;
      };
      const memKey = `brain_dump_${payload.brainDumpId ?? event.id}`;
      try {
        const existing = await prisma.brainMemory.findUnique({
          where: { category_key: { category: "brain_dump_event", key: memKey } },
          select: { id: true },
        });
        if (!existing) {
          await prisma.brainMemory.create({
            data: {
              category: "brain_dump_event",
              key: memKey,
              content: `BrainDump finalized · mode=${payload.mode ?? "?"} · ${payload.rawChars ?? 0}ch · extracted=${payload.extracted ? "y" : "n"}`,
              source: "brain-bus:brain_dump.finalized",
              confidence: 1.0,
              metadata: {
                eventId: event.id,
                brainDumpId: payload.brainDumpId ?? null,
                date: payload.date ?? null,
                mode: payload.mode ?? null,
                extracted: payload.extracted ?? false,
                rawChars: payload.rawChars ?? 0,
                worker: ctx.workerId,
              } as never,
            },
          });
        }
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") return;
        log.error("brain_dump.finalized.persist_failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },

  // Default fallback — every claim that doesn't match anything else
  // logs + acks. Without this, unknown topics would loop through
  // markFailed → retry → dead-letter for no good reason.
  {
    topic: "*",
    handler: async (event, ctx) => {
      log.info("dispatch.default", {
        topic: event.topic,
        eventType: event.eventType,
        eventId: event.id,
        attempts: event.attempts,
        worker: ctx.workerId,
        fromBackfill: ctx.fromBackfill,
      });
    },
  },
];

/**
 * Resolve the handler for a given topic. Exact match wins; otherwise
 * the longest prefix-matching handler wins; otherwise the wildcard
 * handler runs.
 */
function resolveHandler(topic: string): DurableHandler {
  // Exact match
  for (const entry of HANDLERS) {
    if (entry.topic === topic) return entry.handler;
  }
  // Prefix match — find the longest matching prefix
  let best: { handler: DurableHandler; len: number } | null = null;
  for (const entry of HANDLERS) {
    if (entry.topic.endsWith(".*")) {
      const prefix = entry.topic.slice(0, -2); // strip ".*"
      if (
        topic === prefix ||
        topic.startsWith(`${prefix}.`)
      ) {
        if (!best || prefix.length > best.len) {
          best = { handler: entry.handler, len: prefix.length };
        }
      }
    }
  }
  if (best) return best.handler;
  // Wildcard fallback
  const wildcard = HANDLERS.find((h) => h.topic === "*");
  if (wildcard) return wildcard.handler;
  // Should never reach here — the wildcard above is the safety net
  return async () => {};
}

/**
 * Single dispatch entry point used by:
 *   · brain-bus-backfill cron (poll path)
 *   · live LISTEN-path consumer (when wired)
 *
 * Errors propagate to the caller so markFailed/markDone can record
 * outcome correctly.
 */
export async function dispatchDurableEvent(
  event: DurableEvent,
  ctx: HandlerContext,
): Promise<void> {
  const handler = resolveHandler(event.topic);
  await handler(event, ctx);
}

/**
 * Internal — exposed for tests so the registry can be inspected
 * without importing the full module-level closure.
 */
export function _resolveHandlerForTopic(topic: string): DurableHandler {
  return resolveHandler(topic);
}

/**
 * List the registered topic patterns for /system/* dashboards.
 */
export function listRegisteredTopics(): string[] {
  return HANDLERS.map((h) => h.topic);
}

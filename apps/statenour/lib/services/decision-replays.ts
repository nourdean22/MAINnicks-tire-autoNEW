/**
 * lib/services/decision-replays.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The decision-replay read/mark assembly · lifted verbatim from
 * app/api/system/decision-replays/route.ts (the GET's due/recent split
 * + mapping) and app/api/system/decision-replays/[id]/mark/route.ts
 * (the dual-mode mark: consumedAt stamp ± markReplayed write) so the
 * legacy REST endpoints AND the new `system.decisionReplays` /
 * `system.markDecisionReplay` tRPC procedures call the SAME functions ·
 * drift between consumers structurally impossible.
 *
 * Both functions return EXPLICIT, shallow shapes
 * (`DecisionReplaysView` / `DecisionReplayMarkResult`). The Prisma
 * `BrainMemory.metadata` Json column is read internally and the `due`
 * rows project it through to `metadata: unknown` — never the recursive
 * Prisma `JsonValue` — the same TS2589-prevention discipline as
 * `TaskEventRow` in lib/trpc/routers/task.ts.
 *
 * Date columns are projected to ISO `string` (not `Date`) — matching
 * the `task-session` service precedent. The tRPC layer runs no
 * transformer, so a `Date` return would be a string at runtime but
 * ambiguous at the type level; returning `string` makes the procedure
 * type honest AND keeps the legacy REST JSON byte-identical (JSON
 * always serialized the Date to a string anyway).
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";
import { markReplayed } from "@/lib/services/decision-replay-coach";

const log = rootLogger.withSurface("service/decision-replays");

/** One decision-replay due row · queued by the cron, not yet consumed. */
export interface DecisionReplayDueRow {
  id: string;
  key: string;
  text: string;
  /** BrainMemory.metadata Json column · projected to `unknown` (TS2589 firewall). */
  metadata: unknown;
  queuedAt: string;
}

/** One reviewed decision-replay row · with outcome + lesson. */
export interface DecisionReplayRecentRow {
  id: string;
  decisionId: number | null;
  title: string;
  choiceMade: string;
  outcome: string | null;
  outcomeScore: number | null;
  lesson: string | null;
  reviewedAt: string | null;
  ageDays: number | null;
}

/** Shallow, explicit shape for the decision-replays GET view. */
export interface DecisionReplaysView {
  due: {
    unconsumedCount: number;
    unconsumed: DecisionReplayDueRow[];
    consumedTodayCount: number;
  };
  recent: DecisionReplayRecentRow[];
}

/** Shallow, explicit shape for a decision-replay mark result. */
export interface DecisionReplayMarkResult {
  ok: true;
  id: string;
  consumedAt: string;
  replayWritten: boolean;
  lessonStored: boolean;
}

type DueQueryRow = {
  id: string;
  key: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};
type RecentQueryRow = {
  id: string;
  decisionId: number | null;
  title: string;
  choiceMade: string;
  outcome: string | null;
  outcomeScore: number | null;
  lesson: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

/**
 * Build the decision-replays GET view · `due` (queued, split into
 * unconsumed / consumed-today) + `recent` (last 10 reviewed). The route
 * and the tRPC `system.decisionReplays` procedure both call this.
 */
export async function buildDecisionReplaysView(): Promise<DecisionReplaysView> {
  const [dueRowsRaw, recentRaw] = await Promise.all([
    prisma.brainMemory
      .findMany({
        where: { category: "decision_replay_due", deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: {
          id: true,
          key: true,
          content: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      .catch((): DueQueryRow[] => []),
    prisma.decisionReplay
      .findMany({
        where: { reviewed: true },
        orderBy: { reviewedAt: "desc" },
        take: 10,
        select: {
          id: true,
          decisionId: true,
          title: true,
          choiceMade: true,
          outcome: true,
          outcomeScore: true,
          lesson: true,
          reviewedAt: true,
          createdAt: true,
        },
      })
      .catch((): RecentQueryRow[] => []),
  ]);

  const dueRows = dueRowsRaw as DueQueryRow[];
  const recent = recentRaw as RecentQueryRow[];

  const unconsumed: DueQueryRow[] = [];
  const consumed: DueQueryRow[] = [];
  for (const row of dueRows) {
    const consumedAt = (row.metadata as Record<string, unknown> | null)
      ?.consumedAt;
    if (consumedAt) consumed.push(row);
    else unconsumed.push(row);
  }

  return {
    due: {
      unconsumedCount: unconsumed.length,
      unconsumed: unconsumed.map((r) => ({
        id: r.id,
        key: r.key,
        text: r.content,
        metadata: r.metadata,
        queuedAt: r.createdAt.toISOString(),
      })),
      consumedTodayCount: consumed.length,
    },
    recent: recent.map((r) => ({
      id: r.id,
      decisionId: r.decisionId,
      title: r.title,
      choiceMade: r.choiceMade,
      outcome: r.outcome,
      outcomeScore: r.outcomeScore,
      lesson: r.lesson,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      ageDays:
        r.reviewedAt && r.createdAt
          ? Math.floor(
              (r.reviewedAt.getTime() - r.createdAt.getTime()) /
                (24 * 60 * 60 * 1000),
            )
          : null,
    })),
  };
}

/**
 * Mark a decision-replay row. Dual-mode (matching the legacy POST): an
 * empty `lesson` argument stamps consumedAt only; a populated one ALSO
 * dual-writes the DecisionReplay row via `markReplayed`.
 *
 * A missing row throws ServiceError(404); a wrong-category row throws
 * ServiceError(400) — so both transports reject identically. The route
 * and the tRPC `system.markDecisionReplay` procedure both call this.
 */
export async function markDecisionReplay(input: {
  id: string;
  outcome?: string;
  outcomeScore?: number;
  lesson?: string;
}): Promise<DecisionReplayMarkResult> {
  const row = await prisma.brainMemory.findUnique({
    where: { id: input.id },
    select: { id: true, category: true, metadata: true },
  });
  if (!row) {
    throw new ServiceError("not_found", 404);
  }
  if (row.category !== "decision_replay_due") {
    throw new ServiceError("wrong_category", 400);
  }

  // A lesson payload exists only when `outcome` is supplied (the schema
  // / route make `outcome` the gate for dual-write mode).
  const lesson =
    typeof input.outcome === "string" && input.outcome.length > 0
      ? {
          outcome: input.outcome,
          outcomeScore: input.outcomeScore,
          lesson: input.lesson,
        }
      : null;

  const nowIso = new Date().toISOString();
  const prevMeta = (row.metadata as Record<string, unknown> | null) ?? {};
  const consumedVia = lesson ? "ultron-form" : "ultron-tile";
  const nextMeta = { ...prevMeta, consumedAt: nowIso, consumedVia };

  try {
    await prisma.brainMemory.update({
      where: { id: input.id },
      data: { metadata: nextMeta },
    });
  } catch (err) {
    log.error("mark_failed", {
      id: input.id,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw new ServiceError("update_failed", 500);
  }

  let replayWritten = false;
  let lessonStored = false;
  if (lesson) {
    const decisionIdRaw = prevMeta?.decisionId;
    const decisionId =
      typeof decisionIdRaw === "number"
        ? decisionIdRaw
        : typeof decisionIdRaw === "string"
          ? Number(decisionIdRaw)
          : null;
    if (decisionId !== null && Number.isFinite(decisionId)) {
      try {
        const result = await markReplayed({
          decisionId,
          outcome: lesson.outcome,
          outcomeScore: lesson.outcomeScore,
          lesson: lesson.lesson,
        });
        replayWritten = result.ok;
        lessonStored = result.lessonStored;
        if (!result.ok) {
          log.warn("mark_replay_write_failed", { id: input.id, decisionId });
        }
      } catch (err) {
        log.warn("mark_replay_threw", {
          id: input.id,
          decisionId,
          err: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    } else {
      log.warn("mark_lesson_missing_decisionid", {
        id: input.id,
        prevMetaKeys: Object.keys(prevMeta),
      });
    }
  }

  log.info("decision_replay_marked", {
    id: input.id,
    consumedVia,
    replayWritten,
    lessonStored,
  });

  return { ok: true, id: input.id, consumedAt: nowIso, replayWritten, lessonStored };
}

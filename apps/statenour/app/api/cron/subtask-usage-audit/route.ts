/**
 * GET /api/cron/subtask-usage-audit · 2026-05-23 OVERDRIVE.
 *
 * 30-day check-in on the parent_task_id wave (task #22 · ADR-0017
 * amended). Self-fires on/after 2026-06-22 (the migration applied
 * 2026-05-23 PM) and writes the audit result as a BrainMemory nudge
 * so the operator sees it in the daily-brief surfacing layer.
 *
 * The Elon move that ADR-0017 amendment A1 codified · "if a feature
 * has < 5% usage at 30 days, the feature is dead-weight · candidate
 * for deletion." This cron makes that gate falsifiable instead of
 * relying on memory + manual SQL.
 *
 * What it computes:
 *   · total non-deleted tasks (the denominator)
 *   · tasks where parentTaskId IS NOT NULL (the numerator)
 *   · count of distinct parents that have at least one subtask
 *   · usage ratio · % of tasks that are children
 *
 * What it writes:
 *   · BrainMemory(category=nudge_pin_hygiene, key=subtask_usage_audit_30d)
 *   · idempotent · subsequent runs upsert the same row with fresh
 *     numbers (so the operator always sees the LATEST stats, not
 *     stale 2026-06-22 snapshot)
 *   · expiresAt = +14d so the nudge naturally fades if the operator
 *     audits + dismisses without explicit dismissal
 *
 * Folded into mega-morning · runs daily as part of the morning fanout.
 * The date-gate (today >= 2026-06-22) is enforced INSIDE the route
 * so the cron registry stays simple.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = logger.withSurface("cron/subtask-usage-audit");

/**
 * Audit fires on/after this date. Set to migration-date + 30d.
 * Migration applied 2026-05-23 13:35 ET · so the audit window opens
 * 2026-06-22 EOD ET. We use a UTC midnight comparison · the few-hour
 * difference doesn't matter for a 30-day gate.
 */
const AUDIT_START_DATE = new Date("2026-06-22T00:00:00Z");

/** Migration baseline · ignore tasks created before this when computing usage. */
const FEATURE_LAUNCH_DATE = new Date("2026-05-23T00:00:00Z");

/**
 * ADR-0017 amendment A1 deletion threshold. If subtask usage at
 * the 30-day mark is below this %, the feature is dead-weight and
 * the operator should consider reverting per the amended gate.
 */
const DEAD_WEIGHT_THRESHOLD_PCT = 5;

/** Nudge re-surfaces every fortnight if not dismissed. */
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const now = new Date();

    // Date-gate · the cron is registered daily but only does work
    // on/after the audit window opens. Pre-window runs are cheap
    // no-ops (one DB query? no · just a Date comparison).
    if (now < AUDIT_START_DATE) {
      return {
        ok: true,
        gated: true,
        auditStartsAt: AUDIT_START_DATE.toISOString(),
        nudged: false,
      };
    }

    // Compute the actual numbers · 2 queries · counts only.
    const [totalSinceLaunch, withParentSinceLaunch, distinctParentsRaw] =
      await Promise.all([
        prisma.task.count({
          where: {
            deletedAt: null,
            createdAt: { gte: FEATURE_LAUNCH_DATE },
          },
        }),
        prisma.task.count({
          where: {
            deletedAt: null,
            createdAt: { gte: FEATURE_LAUNCH_DATE },
            parentTaskId: { not: null },
          },
        }),
        prisma.task.findMany({
          where: {
            deletedAt: null,
            createdAt: { gte: FEATURE_LAUNCH_DATE },
            parentTaskId: { not: null },
          },
          select: { parentTaskId: true },
          distinct: ["parentTaskId"],
        }),
      ]);

    const distinctParents = distinctParentsRaw.length;
    const usagePct =
      totalSinceLaunch === 0
        ? 0
        : Number(((withParentSinceLaunch / totalSinceLaunch) * 100).toFixed(1));
    const isDeadWeight = usagePct < DEAD_WEIGHT_THRESHOLD_PCT;

    const content = isDeadWeight
      ? `Subtask audit · 30 days in · ${withParentSinceLaunch}/${totalSinceLaunch} tasks have a parent (${usagePct}%). ` +
        `Below the ${DEAD_WEIGHT_THRESHOLD_PCT}% gate from ADR-0017 amendment A1 · the feature is dead-weight · candidate for revert.`
      : `Subtask audit · 30 days in · ${withParentSinceLaunch}/${totalSinceLaunch} tasks have a parent (${usagePct}%) across ${distinctParents} distinct parents. ` +
        `At or above the ${DEAD_WEIGHT_THRESHOLD_PCT}% gate · feature is earning its keep.`;

    const metadata = {
      totalSinceLaunch,
      withParentSinceLaunch,
      distinctParents,
      usagePct,
      threshold: DEAD_WEIGHT_THRESHOLD_PCT,
      isDeadWeight,
      featureLaunchDate: FEATURE_LAUNCH_DATE.toISOString(),
      auditStartedAt: AUDIT_START_DATE.toISOString(),
      computedAt: now.toISOString(),
    };

    try {
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE,
            key: "subtask_usage_audit_30d",
          },
        },
        create: {
          category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE,
          key: "subtask_usage_audit_30d",
          content,
          confidence: 0.9,
          source: "cron:subtask-usage-audit",
          createdBy: "system:subtask-usage-audit",
          expiresAt: new Date(now.getTime() + TWO_WEEKS_MS),
          metadata,
        },
        update: {
          content,
          confidence: 0.9,
          expiresAt: new Date(now.getTime() + TWO_WEEKS_MS),
          metadata,
          lastSeen: new Date(),
          deletedAt: null,
        },
      });
    } catch (err) {
      log.warn("nudge_upsert_failed", {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }

    return {
      ok: true,
      gated: false,
      ...metadata,
      nudged: true,
    };
  },
  { auth: "cron" },
);

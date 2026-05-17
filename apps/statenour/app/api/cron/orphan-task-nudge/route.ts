/**
 * GET /api/cron/orphan-task-nudge · Wave 24 (v10.0.529.80) · #3
 *
 * Detects "orphan" task completions — tasks that fired NO auto-learn
 * engine on complete. This usually means:
 *   · no mission.domain set (operator hasn't tagged the mission)
 *   · no goal linkage
 *   · title doesn't read like a learning event
 *   · no tutorial prefix
 *
 * When 3+ orphan completions land in 24h, emit a BrainMemory
 * (category="orphan_tasks_nudge") row so /brain's PatternCard can
 * surface "you completed 3 tasks today that connected to nothing —
 * want to tag them?"
 *
 * Why this matters:
 *   The auto-learn loop only compounds for tagged work. Orphan tasks
 *   leak from the system. This nudge catches the leak early so the
 *   operator can either:
 *     · tag the mission with a domain
 *     · re-frame the title to surface the learning
 *     · acknowledge it was genuinely off-loop work
 *
 * Folded into mega-morning so the nudge surfaces before the operator
 * starts their day · pairs well with the daily-brief.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const log = logger.withSurface("cron/orphan-task-nudge");

/** Min orphan completions in window before nudge fires. */
const MIN_ORPHANS = 3;

/** Window in hours · 24 = "yesterday". */
const WINDOW_HOURS = 24;

const LEARNING_VERB_PATTERN =
  /\b(learn(ed|ing)?|research(ed|ing)?|read|watched|stud(y|ied|ying)|discovered|figured out|understood|grokked|practiced)\b/i;
const TUTORIAL_PREFIX_PATTERN =
  /^(tutorial|lesson|learn|study|course)\s*[:\-—]\s*/i;

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000);

    const recentDone = await prisma.task
      .findMany({
        where: {
          status: "DONE",
          updatedAt: { gte: since },
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          finishCondition: true,
          goalId: true,
          mission: { select: { domain: true } },
        },
        take: 200,
      })
      .catch((): Array<{
        id: string;
        title: string;
        finishCondition: string | null;
        goalId: string | null;
        mission: { domain: string | null } | null;
      }> => []);

    const orphans = recentDone.filter((t) => {
      // A task is an "orphan" if NONE of the auto-learn engines would
      // have fired for it: no domain (mastery) + no goal + not a
      // learning verb (knowledge) + not a tutorial prefix (learn).
      const hasDomain = !!t.mission?.domain;
      const hasGoal = !!t.goalId;
      const hasLearningVerb = LEARNING_VERB_PATTERN.test(
        `${t.title} ${t.finishCondition ?? ""}`,
      );
      const hasTutorialPrefix = TUTORIAL_PREFIX_PATTERN.test(t.title);
      return !hasDomain && !hasGoal && !hasLearningVerb && !hasTutorialPrefix;
    });

    if (orphans.length < MIN_ORPHANS) {
      // Below threshold · clear any stale nudge so we don't surface
      // yesterday's noise.
      await prisma.brainMemory
        .updateMany({
          where: {
            category: "orphan_tasks_nudge",
            key: "current",
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        })
        .catch(() => null);
      return {
        ok: true,
        orphans: orphans.length,
        threshold: MIN_ORPHANS,
        nudged: false,
      };
    }

    const sampleTitles = orphans.slice(0, 5).map((o) => o.title);

    try {
      await prisma.brainMemory.upsert({
        where: { category_key: { category: "orphan_tasks_nudge", key: "current" } },
        create: {
          category: "orphan_tasks_nudge",
          key: "current",
          content: `${orphans.length} tasks completed today aren't connected to a domain · goal · or learning signal. tag them so the auto-learn loop captures the growth.`,
          confidence: 0.85,
          source: "cron:orphan-task-nudge",
          createdBy: "system:orphan-task-nudge",
          metadata: {
            orphanCount: orphans.length,
            sampleTitles,
            sampleTaskIds: orphans.slice(0, 5).map((o) => o.id),
            windowHours: WINDOW_HOURS,
            generatedAt: new Date().toISOString(),
          },
        },
        update: {
          content: `${orphans.length} tasks completed today aren't connected to a domain · goal · or learning signal. tag them so the auto-learn loop captures the growth.`,
          confidence: 0.85,
          metadata: {
            orphanCount: orphans.length,
            sampleTitles,
            sampleTaskIds: orphans.slice(0, 5).map((o) => o.id),
            windowHours: WINDOW_HOURS,
            generatedAt: new Date().toISOString(),
          },
          lastSeen: new Date(),
          deletedAt: null, // un-archive in case it was cleared earlier
        },
      });
    } catch (err) {
      log.warn("nudge_upsert_failed", {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }

    return {
      ok: true,
      orphans: orphans.length,
      threshold: MIN_ORPHANS,
      nudged: true,
      sampleTitles,
    };
  },
  { auth: "cron" },
);

/**
 * POST /api/tasks/[id]/check — unified loop completion endpoint.
 *
 * Handles all three kinds from the Loops unification:
 *
 *   ONCE    → status = DONE
 *   PROMISE → status = DONE (success) or ARCHIVED (broken, via action=break)
 *   DAILY   → lastCompletedAt = now, streakCount bumped
 *             Status stays READY so the loop keeps reappearing.
 *             Streak resets to 1 if the gap since last check > 1 day.
 *
 * Body: { action?: "complete" | "break" }
 */
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { emitTaskCompleted } from "@/lib/db/brain-bus-emit";
import { logger as rootLogger } from "@/lib/logger";
import { runAutoLearn, type AutoLearnReport } from "@/lib/services/auto-learn";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// v10.0.529.13 · 4 console.warn sites swapped to structured logger so
// silent-degradation in skill-reinforce, reality-gap, ghost-outcome,
// and break-promise writes surface in /system/errors instead of only
// in the platform log. Matches the rest of the codebase pattern.
const log = rootLogger.withSurface("api/tasks/check");

// v10.0.123 cleanup · migrated from raw requireSession+NextResponse to
// apiHandler({ auth: "owner" }) so this route matches its siblings
// (domain, event, parent /api/tasks/[id]) hardened in v10.0.118-120.
// Internal logic unchanged — only the auth gate + response shaping.
export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "break" ? "break" : "complete";

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true, // v10.0.63 · needed for emitTaskCompleted payload
      finishCondition: true, // v10.0.529.76 · auto-learn knowledge heuristic
      missionId: true, // v10.0.63 · same
      loopKind: true,
      status: true,
      lastCompletedAt: true,
      streakCount: true,
      startedAt: true,
      actualMinutes: true,
      context: true,
      effort: true,
      autoPriority: true,
      // v10.0.529.77 · Wave 22 adaptive scoring · need roiScore +
      // goalId for the bump formula (high-ROI goal-linked tasks earn
      // more mastery than orphan low-ROI ones).
      roiScore: true,
      goalId: true,
      mission: { select: { title: true, domain: true } },
      goal: { select: { domain: true } },
    },
  });

  if (!task) {
    throw new ServiceError("Task not found", 404);
  }

  const now = new Date();

  // Time-tracking diff: if the task was DOING (startedAt set), compute
  // minutes elapsed and add to actualMinutes. Floor at 1 minute so
  // one-tap completions still register as "1 min of work".
  let timeBump = 0;
  if (task.startedAt) {
    const deltaMs = now.getTime() - new Date(task.startedAt).getTime();
    timeBump = Math.max(1, Math.round(deltaMs / 60_000));
  }

  // ── DAILY: streak + last-completed, status unchanged ──
  if (task.loopKind === "DAILY" && action === "complete") {
    void timeBump; // DAILY doesn't time-track for now (too granular)
    let nextStreak = 1;
    if (task.lastCompletedAt) {
      const last = new Date(task.lastCompletedAt);
      const lastDayStart = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const gapDays = Math.round((todayStart.getTime() - lastDayStart.getTime()) / 86_400_000);
      if (gapDays === 0) {
        // Already checked off today — idempotent, keep streak.
        return {
          ok: true,
          idempotent: true,
          streakCount: task.streakCount,
          lastCompletedAt: task.lastCompletedAt,
        };
      }
      nextStreak = gapDays === 1 ? task.streakCount + 1 : 1;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        lastCompletedAt: now,
        lastTouchedAt: now,
        streakCount: nextStreak,
        // Keep status READY so the loop reappears in the active list
        // tomorrow. If upstream had it in another state, normalize.
        status: "READY",
      },
      select: { id: true, streakCount: true, lastCompletedAt: true, loopKind: true, title: true },
    });

    // v10.0.63 · brain-bus producer · emit task.completed for DAILY
    // check-offs. Same-task-same-day dedupe in the emit wrapper.
    void emitTaskCompleted({
      taskId: id,
      title: updated.title ?? task.title ?? "(untitled)",
      missionId: task.missionId ?? null,
      domain: task.mission?.domain ?? null,
      loopKind: "DAILY",
      completedAt: now.toISOString(),
    });

    // v10.0.529.76 · Wave 21 · DAILY check-offs also fire auto-learn.
    // Daily habits are the strongest mastery signal · checking off
    // "20-min run" daily lifts the fitness axis. The dedup is via
    // MasteryScore (date, domain) unique key — only the first check
    // of the day adds the +0.5 bump (subsequent calls return delta=0).
    let dailyAutoLearn: AutoLearnReport | null = null;
    try {
      dailyAutoLearn = await runAutoLearn({
        taskId: id,
        task: {
          title: updated.title ?? task.title ?? "",
          finishCondition: task.finishCondition,
          mission: task.mission
            ? { title: task.mission.title ?? null, domain: task.mission.domain ?? null }
            : null,
          goal: null, // DAILY tasks rarely link goals · select didn't include it
          // v22 · adaptive scoring inputs · DAILY uses the post-update
          // streakCount so 7-day streaks earn 2× this morning.
          roiScore: task.roiScore,
          effort: task.effort,
          loopKind: "DAILY",
          streakCount: updated.streakCount,
          hasGoalId: !!task.goalId,
        },
      });
    } catch (e) {
      log.warn("auto_learn_daily_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }

    // v10.0.529.79 · Wave 23 · Ghost Nick outcome moved INTO auto-learn.
    // The dailyAutoLearn report above carries the Ghost result on the
    // .ghost field · the toast surfaces "Ghost predicted this · X%
    // accuracy" when applicable.

    return { ok: true, task: updated, autoLearn: dailyAutoLearn };
  }

  // ── PROMISE broken ──
  if (task.loopKind === "PROMISE" && action === "break") {
    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        lastTouchedAt: now,
      },
      select: { id: true, status: true, loopKind: true },
    });

    // ── Skill failure reinforcement ──
    // A broken promise at this signal shape = evidence the skill
    // ISN'T landing. Fire reinforceSkill(key, false) so success_rate
    // reflects reality. Inverse of the DONE path below.
    void (async () => {
      try {
        const { matchSkillsForTask, reinforceSkill } = await import(
          "@/lib/brain/skill-extractor"
        );
        const matchedKeys = await matchSkillsForTask({
          context: task.context,
          effort: task.effort,
          autoPriority: task.autoPriority,
          missionDomain: task.mission?.domain ?? null,
        });
        for (const key of matchedKeys) {
          await reinforceSkill(key, false).catch(() => {});
        }
      } catch (e) {
        log.warn("skill_reinforce_break_failed", {
          taskId: id,
          err: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    })();

    return { ok: true, task: updated, broken: true };
  }

  // ── ONCE + PROMISE complete: mark DONE + commit time tracking ──
  const updated = await prisma.task.update({
    where: { id },
    data: {
      status: "DONE",
      lastTouchedAt: now,
      lastCompletedAt: now,
      // v10.0.118 audit fix · actualMinutes is nullable for legacy rows
      // created before the column existed. null + number = NaN, which
      // Prisma rejects with a 500 mid-completion. Coalesce to 0.
      actualMinutes: (task.actualMinutes ?? 0) + timeBump,
      startedAt: null, // clear timer
    },
    select: { id: true, status: true, loopKind: true, actualMinutes: true, effort: true },
  });

  // v10.0.63 · brain-bus producer · emit task.completed so chat
  // queries like "what did I get done today" hit semantic search
  // via the BrainMemory `task_completion` rows the handler writes.
  void emitTaskCompleted({
    taskId: id,
    title: task.title ?? "(untitled)",
    missionId: task.missionId ?? null,
    domain: task.mission?.domain ?? null,
    loopKind: task.loopKind,
    completedAt: now.toISOString(),
  });

  // v10.0.529.76 · Wave 21 · auto-learn cross-engine propagation.
  // Awaited (not fire-and-forget) so the report rides back on the
  // response · the /tasks UI uses it to toast the cross-engine wins
  // (mastery +0.5 → fitness 47/100 · knowledge: insight saved ·
  // learn: tutorial complete). Each engine fails gracefully so a
  // bad write never blocks task completion. See
  // lib/services/auto-learn.ts.
  let autoLearnReport: AutoLearnReport | null = null;
  try {
    autoLearnReport = await runAutoLearn({
      taskId: id,
      task: {
        title: task.title ?? "",
        finishCondition: task.finishCondition,
        mission: task.mission
          ? { title: task.mission.title ?? null, domain: task.mission.domain ?? null }
          : null,
        goal: task.goal ? { domain: task.goal.domain ?? null } : null,
        // v22 · adaptive scoring inputs for ONCE/PROMISE completion.
        roiScore: task.roiScore,
        effort: task.effort,
        loopKind: task.loopKind,
        streakCount: task.streakCount,
        hasGoalId: !!task.goalId,
      },
    });
  } catch (e) {
    log.warn("auto_learn_failed", {
      taskId: id,
      err: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  // ── Reality-gap writeback ──
  // Every DONE with time-on-task feeds back into the per-effort-band
  // rolling average. Stored as BrainMemory so todo-desk can read it
  // without scanning 50 DONE rows on every desk fetch, and chat system
  // prompts can quote Nour's real pace per band.
  if (updated.actualMinutes > 0) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const recent = await prisma.task.findMany({
        where: {
          status: "DONE",
          effort: updated.effort,
          actualMinutes: { gt: 0 },
          updatedAt: { gte: thirtyDaysAgo },
          deletedAt: null,
        },
        select: { actualMinutes: true },
        take: 50,
        orderBy: { updatedAt: "desc" },
      });
      if (recent.length > 0) {
        const total = recent.reduce((a, r) => a + r.actualMinutes, 0);
        const avg = Math.round((total / recent.length) * 10) / 10;
        await prisma.brainMemory.upsert({
          where: { category_key: { category: BRAIN_CATEGORIES.EFFORT_BAND_AVG, key: updated.effort } },
          create: {
            category: BRAIN_CATEGORIES.EFFORT_BAND_AVG,
            key: updated.effort,
            content: JSON.stringify({
              avgMinutes: avg,
              sampleSize: recent.length,
              lastUpdatedAt: now.toISOString(),
            }),
            confidence: Math.min(0.9, 0.5 + recent.length / 40),
            source: "reality_gap_writeback",
          },
          update: {
            content: JSON.stringify({
              avgMinutes: avg,
              sampleSize: recent.length,
              lastUpdatedAt: now.toISOString(),
            }),
            confidence: Math.min(0.9, 0.5 + recent.length / 40),
            lastSeen: now,
            seenCount: { increment: 1 },
          },
        });
      }
    } catch (e) {
      log.warn("reality_gap_writeback_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  // ── Skill reinforcement ──
  // Every DONE task is a chance for an active skill to fire + prove
  // itself. Match the task's feature shape against Nour's curated
  // active skill triggers and reinforce each match. Fire-and-forget
  // so the check response isn't blocked; skill-extractor.ts handles
  // success_rate math + graduation eligibility.
  void (async () => {
    try {
      const { matchSkillsForTask, reinforceSkill } = await import(
        "@/lib/brain/skill-extractor"
      );
      const matchedKeys = await matchSkillsForTask({
        context: task.context,
        effort: task.effort,
        autoPriority: task.autoPriority,
        missionDomain: task.mission?.domain ?? null,
      });
      for (const key of matchedKeys) {
        await reinforceSkill(key, true).catch(() => {});
      }
    } catch (e) {
      log.warn("skill_reinforce_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  })();

  // v10.0.529.79 · Wave 23 · Ghost Nick outcome moved INTO auto-learn
  // (lib/services/auto-learn.ts) so the result rides back on the
  // response. Pre-Wave-23 this was a fire-and-forget block · now the
  // toast can surface "Ghost predicted this · 67% accuracy" via the
  // autoLearnReport.ghost field.

  return { ok: true, task: updated, timeAdded: timeBump, autoLearn: autoLearnReport };
}, { auth: "owner" });

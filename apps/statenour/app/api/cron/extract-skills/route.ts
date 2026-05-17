/**
 * GET /api/cron/extract-skills — weekly harvest of skill candidates
 * from Nour's DONE tasks.
 *
 * Apr 18. Runs Sun 03:00 via vercel.json (lightweight, after weekly-
 * review at 02:00 — so the weekly summary ticker sees fresh candidates).
 *
 * The scan looks at the last 30 days of DONE tasks, clusters by
 * {context, effort, priority-band, mission domain}, and writes any
 * cluster with ≥3 members as a `skill_pending` BrainMemory row for
 * Nour to curate in /settings.
 *
 * Idempotent on repeat runs (deterministic key = sha1(trigger+action))
 * — merges evidence + last_fired into existing pending rows instead
 * of duping. Skips anything already promoted to an active `skill`.
 *
 * Emits a brain_insight AuditEvent only when `newCandidates > 0` so
 * the bottom ticker surfaces "Nick noticed X new skill patterns" to
 * Nour the moment they land.
 */
import { cronHandler } from "@/lib/utils/http";
import { extractSkillsFromTasks } from "@/lib/brain/skill-extractor";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  const result = await extractSkillsFromTasks();

  if (result.newCandidates > 0) {
    const label = result.newCandidates === 1 ? "pattern" : "patterns";
    await prisma.auditEvent
      .create({
        data: {
          actor: "skill_extractor",
          eventType: "brain_insight",
          detail: `Spotted ${result.newCandidates} new skill ${label} from recent wins — review in /settings`,
          payload: {
            ...result,
            durationMs: Date.now() - started,
          },
        },
      })
      .catch(() => {});
  }

  return {
    ...result,
    durationMs: Date.now() - started,
  };
});

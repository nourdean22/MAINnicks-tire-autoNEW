/**
 * GET /api/tasks/[id]/skill-hint — does this task match any active
 * skill? Used by task detail UIs to show "you usually handle this
 * by doing X" hints inline, so Nour knows if a proven pattern is
 * about to fire.
 *
 * Owner-auth.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { matchSkillsForTask, loadActiveSkills } from "@/lib/brain/skill-extractor";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async (_req, ctx) => {
    const params = await ctx.params;
    const id = params?.id;
    if (!id) throw new ServiceError("id required", 400);

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        context: true,
        effort: true,
        autoPriority: true,
        mission: { select: { domain: true } },
      },
    });
    if (!task) throw new ServiceError("task not found", 404);

    const [matchedKeys, allActive] = await Promise.all([
      matchSkillsForTask({
        context: task.context,
        effort: task.effort,
        autoPriority: task.autoPriority,
        missionDomain: task.mission?.domain ?? null,
      }),
      loadActiveSkills(),
    ]);

    const matches = allActive.filter((s) => matchedKeys.includes(s.key));
    return {
      matches: matches.map((s) => ({
        key: s.key,
        trigger: s.trigger,
        action: s.action_sequence[0] ?? null,
        success_rate: s.success_rate,
        times_fired: s.times_fired,
        polarity: s.polarity,
        graduated: s.graduated,
      })),
    };
  },
  { auth: "owner" },
);

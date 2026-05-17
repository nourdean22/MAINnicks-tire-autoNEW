/**
 * POST /api/tasks/[id]/score · Wave 26 (v10.0.529.82) · C3
 *
 * Lightweight AI-fill for tasks whose roiScore is the default 50.
 * The quick-add path hardcodes roiScore=50 (the operator doesn't
 * grade urgency every time) which means the urgency sort is
 * effectively random for new untagged tasks.
 *
 * This endpoint asks Nick to read the task title + finish condition
 * + mission domain and return a roiScore 0-100. Fire-and-forget
 * from the client after createTask succeeds · no operator wait.
 *
 * Idempotent: only updates when current roiScore is the default 50
 * (i.e. operator hasn't manually graded yet) or when explicitly
 * overridden via `?force=1` in the URL.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { createStructuredAiResponse, AiUnavailableError } from "@/lib/ai/structured";
import { logger } from "@/lib/logger";

const log = logger.withSurface("api/tasks/score");

export const dynamic = "force-dynamic";

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    roiScore: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "0-100 estimate of return-on-investment for this task. " +
        "Higher = more leverage per minute spent. Anchor at 50 = average. " +
        "Reserve 80+ for clear high-leverage moves, 20- for chores.",
    },
    reasoning: {
      type: "string",
      description: "1 sentence · why this score · plain English · lowercase.",
    },
  },
  required: ["roiScore"],
};

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = await params!;
    const body = (await readRequestJson(req).catch(() => ({}))) as { force?: boolean };

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        finishCondition: true,
        roiScore: true,
        mission: { select: { title: true, domain: true } },
      },
    });
    if (!task) return { ok: false, error: "task not found" };

    // Skip when operator already graded (roiScore != default 50) ·
    // unless ?force=1.
    if (task.roiScore !== 50 && !body.force) {
      return { ok: true, skipped: true, reason: "operator-graded" };
    }

    const systemPrompt =
      `You score tasks for an operator who runs a tire shop + builds his own personal OS. ` +
      `Return a roiScore 0-100 where higher = more leverage per minute. ` +
      `Anchor: 50 = average. Reserve 80+ for clear leverage moves. ` +
      `Lowercase reasoning · plain English · no AI clichés.`;

    const userPrompt = `Task title: ${task.title}
Finish condition: ${task.finishCondition ?? "(none)"}
Mission: ${task.mission?.title ?? "(none)"}
Mission domain: ${task.mission?.domain ?? "(none)"}`;

    try {
      const result = await createStructuredAiResponse<{
        roiScore: number;
        reasoning?: string;
      }>({
        systemPrompt,
        userPrompt,
        schemaName: "task_roi_score",
        schema: SCORE_SCHEMA,
      });

      const next = Math.max(
        0,
        Math.min(100, Math.round(Number(result.roiScore) || 50)),
      );
      await prisma.task.update({
        where: { id },
        data: {
          roiScore: next,
          autoPriorityExplanation: result.reasoning
            ? `roi · ${result.reasoning}`.slice(0, 240)
            : undefined,
        },
      });

      return {
        ok: true,
        roiScore: next,
        reasoning: result.reasoning ?? null,
      };
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        log.warn("ai_unavailable", { taskId: id, code: err.code });
        return { ok: false, error: "ai_unavailable" };
      }
      log.warn("score_failed", {
        taskId: id,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return { ok: false, error: "internal" };
    }
  },
  { auth: "owner" },
);

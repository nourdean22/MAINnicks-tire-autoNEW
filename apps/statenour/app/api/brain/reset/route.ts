/**
 * POST /api/brain/reset — nuke ALL brain-learning state.
 *
 * Wipes:
 *   chat_importance, chat_summary, skill, skill_pending,
 *   identity_snapshot (current + history), qualitative_identity
 *   (current + history), ghost_prediction (current + dismissals),
 *   ghost_accuracy, contradiction, belief, belief_candidate,
 *   brain_dump_importance
 *
 * Owner-auth. Intended for debugging / fresh start. Cannot be undone.
 * The UI confirms twice (confirm + prompt) before hitting this.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const BRAIN_CATEGORIES = [
  "chat_importance",
  "chat_summary",
  "skill",
  "skill_pending",
  "identity_snapshot",
  "qualitative_identity",
  "ghost_prediction",
  "ghost_accuracy",
  "contradiction",
  "belief",
  "belief_candidate",
  "brain_dump_importance",
];

export const POST = apiHandler(
  async () => {
    const result = await prisma.brainMemory.deleteMany({
      where: { category: { in: BRAIN_CATEGORIES } },
    });

    await prisma.auditEvent
      .create({
        data: {
          actor: "brain_reset",
          eventType: "brain_insight",
          detail: `Full brain reset — ${result.count} rows deleted across ${BRAIN_CATEGORIES.length} categories`,
          payload: { categories: BRAIN_CATEGORIES, count: result.count } as any,
        },
      })
      .catch(() => {});

    return { ok: true, deleted: result.count, categories: BRAIN_CATEGORIES };
  },
  { auth: "owner" },
);

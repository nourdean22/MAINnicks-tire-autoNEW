/**
 * POST /api/system/decision-replays/[id]/mark · v10.0.529.7 · extended v529.27
 *
 * Operator-only mark for a queued decision-replay row. Two modes ·
 * the body decides which one fires:
 *
 *   1. EMPTY body (legacy · v529.7 behavior)
 *      Stamps the BrainMemory row (category=decision_replay_due) with
 *      metadata.consumedAt so the decision-replay tile drops it from
 *      the unconsumed list and the next morning brief doesn't repeat.
 *      Used by the "tap-to-chat" row-click flow · operator goes to
 *      /chat to actually process the replay, the row drops from HQ
 *      immediately.
 *
 *   2. BODY { outcome, outcomeScore?, lesson? } (v529.27 · Arc B 1B)
 *      In addition to stamping consumedAt · ALSO calls
 *      decision-replay-coach.markReplayed() which writes the actual
 *      DecisionReplay row (outcome + score + lesson) + creates a
 *      BrainMemory(category="decision_replay_outcome") so future
 *      recall can pull the lesson forward into similar decisions.
 *      Used by the inline lesson form on the DecisionReplayCard ·
 *      operator logs the lesson without leaving /ultron.
 *
 * Idempotent in both modes · re-marking just overwrites the timestamp
 * and re-upserts the DecisionReplay row (markReplayed uses an
 * idempotencyKey of `decision_<id>_30d`). decisionId comes from the
 * BrainMemory.metadata blob the cron stamps · without it we can't
 * resolve the linked MasteryDecision so we fall back to legacy mode.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { z } from "zod";
import { markReplayed } from "@/lib/services/decision-replay-coach";

const log = rootLogger.withSurface("system/decision-replays/mark");

// v529.27 · optional body schema · the route is backward-compatible
// with empty bodies (legacy mark-as-consumed flow) AND with bodies
// carrying the inline-lesson form payload. Limits are tight on
// purpose · these get embedded into a BrainMemory.content + a
// DecisionReplay.lesson column · not user-facing prose surfaces.
const lessonBodySchema = z.object({
  outcome: z.string().min(1).max(500),
  outcomeScore: z.number().int().min(-5).max(5).optional(),
  lesson: z.string().max(800).optional(),
});

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const id = params?.id;
    if (!id || typeof id !== "string") {
      throw new ServiceError("id required", 400);
    }

    // Read the row to confirm it's in the right category + capture the
    // existing metadata so we don't blow away other fields (e.g. the
    // wisdom citation the cron stamped).
    const row = await prisma.brainMemory.findUnique({
      where: { id },
      select: {
        id: true,
        category: true,
        metadata: true,
      },
    });

    if (!row) {
      throw new ServiceError("not_found", 404);
    }
    if (row.category !== "decision_replay_due") {
      // Defense-in-depth · the auth gate already restricts to operator
      // but this guards against accidental updates against the wrong
      // BrainMemory row (e.g. operator pastes a chat-message id).
      throw new ServiceError("wrong_category", 400);
    }

    // v529.27 · best-effort body parse. We accept:
    //   · no body                → legacy consumedAt-only flow
    //   · valid lesson body      → mark + markReplayed dual write
    //   · invalid lesson body    → 400 (be strict when something IS sent
    //                              so silent malformed posts don't drop
    //                              the lesson on the floor)
    let lesson: z.infer<typeof lessonBodySchema> | null = null;
    let bodyWasSent = false;
    try {
      const text = await req.text();
      if (text.trim().length > 0) {
        bodyWasSent = true;
        const parsedJson = JSON.parse(text);
        const parsed = lessonBodySchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new ServiceError(
            "invalid_lesson_body",
            400,
          );
        }
        lesson = parsed.data;
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      // JSON.parse failure on a non-empty body = malformed client.
      // Don't silently drop the operator's lesson capture.
      if (bodyWasSent) {
        throw new ServiceError("invalid_json_body", 400);
      }
    }

    const nowIso = new Date().toISOString();
    const prevMeta = (row.metadata as Record<string, unknown> | null) ?? {};
    const consumedVia = lesson ? "ultron-form" : "ultron-tile";
    const nextMeta = {
      ...prevMeta,
      consumedAt: nowIso,
      consumedVia,
    };

    try {
      await prisma.brainMemory.update({
        where: { id },
        data: { metadata: nextMeta },
      });
    } catch (err) {
      log.error("mark_failed", {
        id,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      throw new ServiceError("update_failed", 500);
    }

    // v529.27 · write the DecisionReplay outcome row when the inline
    // form supplied a lesson. The cron stamps decisionId into
    // metadata; without it we can't link back to the MasteryDecision
    // so we degrade to legacy-only mode + log so /system/errors can
    // surface the data-shape regression.
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
            log.warn("mark_replay_write_failed", {
              id,
              decisionId,
            });
          }
        } catch (err) {
          log.warn("mark_replay_threw", {
            id,
            decisionId,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      } else {
        log.warn("mark_lesson_missing_decisionid", { id, prevMetaKeys: Object.keys(prevMeta) });
      }
    }

    log.info("decision_replay_marked", {
      id,
      consumedVia,
      replayWritten,
      lessonStored,
    });

    return {
      ok: true,
      id,
      consumedAt: nowIso,
      replayWritten,
      lessonStored,
    };
  },
  { auth: "owner" },
);

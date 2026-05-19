/**
 * Conversation→mission link review · v10.0.191 · Phase VV (2026-05-19 AM)
 *
 * GET   list pending reviews (sorted by similarity, highest first)
 * POST  decide one: { conversationId, missionId, decision }
 *         "approve" → write ChatConversation.mission_id + soft-delete row
 *         "reject"  → soft-delete row (mission stays unlinked)
 *         "snooze"  → bump lastSeen so it sinks in the queue
 *
 * Phase VV · heavy lifting moved to `lib/services/link-review` so both
 * this REST endpoint AND the new `trpc.brain.{linkReview, decideLinkReview}`
 * procedures call the same functions · drift impossible.
 */
import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { ServiceError } from "@/lib/utils/service-error";
import {
  listLinkCandidates,
  decideLinkCandidate,
  ReviewRowNotFoundError,
} from "@/lib/services/link-review";

const DecideSchema = z.object({
  conversationId: z.string().min(1),
  missionId: z.string().min(1),
  decision: z.enum(["approve", "reject", "snooze"]),
});

export const GET = apiHandler(async () => listLinkCandidates(), { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const parsed = DecideSchema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceError(`bad request: ${parsed.error.message}`, 400);
  }
  try {
    return await decideLinkCandidate(parsed.data);
  } catch (err) {
    if (err instanceof ReviewRowNotFoundError) {
      throw new ServiceError(err.message, 404);
    }
    throw err;
  }
}, { auth: "owner" });

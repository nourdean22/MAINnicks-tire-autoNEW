/**
 * GET /api/brain/provenance/[messageId] · v10.0.91 · 2026-05-02.
 *
 * Reverse search: given a chat message ID, find the brain memories
 * MOST LIKELY to have shaped its generation. Useful for debugging
 * "why did Nick say that?" and for citation UI.
 *
 * Phase EE (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/brain-provenance.ts` so both this REST endpoint AND
 * the `trpc.chat.messageProvenance` procedure call the same
 * `readMessageProvenance()` function · drift impossible.
 *
 * Stays mounted for back-compat with any non-tRPC consumer.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { readMessageProvenance } from "@/lib/services/brain-provenance";

export const GET = apiHandler(
  async (req, ctx) => {
    const params = await (ctx?.params as Promise<{ messageId: string }> | undefined);
    const messageId = params?.messageId;
    if (!messageId) throw new ServiceError("messageId required", 400);
    return readMessageProvenance({ messageId });
  },
  { auth: "owner" },
);

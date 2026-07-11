/**
 * lib/services/commitments.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * Commitment-create service · extracted from the create branch of the
 * POST /api/commitments route handler so the legacy REST endpoint AND
 * the new `operator.createCommitment` tRPC procedure (the `/commit`
 * direct-action) both call this one function · drift between the two
 * consumers is structurally impossible.
 *
 * Scope · CREATE only. The route's other branches (update · bulk_update
 * · expire_stale) stay inline in the REST handler — no tRPC consumer in
 * this slice touches them.
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { logCreate } from "@/lib/db/entity-audit";

export interface CreateCommitmentArgs {
  description: string;
  toWhom?: string | null;
  deadline?: string | null;
  domain?: string | null;
}

/**
 * Normalize an extractor-supplied deadline. LLM extraction emits
 * "YYYY-MM-DD" without knowing the current date, so "tonight" has
 * landed as 2024-03-16 on a commitment made 2026-06-02 (prod rows
 * #271/#295/#302…). A deadline before today at creation time is
 * always an extraction error, never intent — drop it instead of
 * storing a lie that instantly reads as "N-hundred days overdue".
 * Non-YYYY-MM-DD shapes are dropped for the same reason.
 */
export function sanitizeDeadline(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const trimmed = deadline.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed < today() ? null : trimmed;
}

/**
 * Create a commitment. `toWhom` defaults to "self". Writes the
 * entity-audit create event, exactly as the REST route did. Returns
 * `{ ok, id }` mirroring the legacy envelope.
 */
export async function createCommitment(
  args: CreateCommitmentArgs,
): Promise<{ ok: true; id: number }> {
  const created = await prisma.commitment.create({
    data: {
      dateMade: today(),
      toWhom: args.toWhom || "self",
      description: args.description,
      deadline: sanitizeDeadline(args.deadline),
      domain: args.domain || null,
    },
  });

  void logCreate(
    "commitment",
    String(created.id),
    created as unknown as Record<string, unknown>,
    { source: "api:commitments.POST.create" },
  );

  return { ok: true, id: created.id };
}

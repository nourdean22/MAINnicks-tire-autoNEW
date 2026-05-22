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
      deadline: args.deadline || null,
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

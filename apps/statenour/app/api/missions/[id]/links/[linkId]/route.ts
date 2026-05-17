/**
 * DELETE /api/missions/[id]/links/[linkId] · v10.0.421
 *
 * Remove a single mission-to-mission link. Idempotent · returns
 * { ok: true } even if the link is already gone.
 */

import { apiHandler } from "@/lib/utils/http";
import { deleteMissionLink } from "@/lib/services/mission-links";

export const dynamic = "force-dynamic";

export const DELETE = apiHandler(async (_req, { params }) => {
  const { linkId } = await params!;
  return deleteMissionLink(linkId);
}, { auth: "owner" });

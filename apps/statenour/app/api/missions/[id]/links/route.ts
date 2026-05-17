/**
 * /api/missions/[id]/links · v10.0.421
 *
 * GET   · list all links touching this mission (outbound + inbound)
 * POST  · create a link from this mission to another
 *           body { targetId, relation?, note? }
 *
 * Auth · owner-gated via apiHandler.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  createMissionLink,
  getLinksFor,
} from "@/lib/services/mission-links";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  const links = await getLinksFor(id);
  return { links };
}, { auth: "owner" });

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = (await readRequestJson(req)) as {
    targetId?: string;
    relation?: string | null;
    note?: string | null;
  };
  if (!body.targetId) {
    return { error: "targetId required" };
  }
  const link = await createMissionLink({
    sourceId: id,
    targetId: body.targetId,
    relation: body.relation,
    note: body.note,
    createdBy: "user",
  });
  return { link };
}, { auth: "owner" });

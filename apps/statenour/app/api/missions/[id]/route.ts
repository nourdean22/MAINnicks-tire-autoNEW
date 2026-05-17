import { deleteMission, getMissionById, updateMission } from "@/lib/services/missions";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

// v10.0.37 — owner-gated. Pre-fix unauthed.
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return getMissionById(id);
}, { auth: "owner" });

// v10.0.254 audit fix · PATCH was unauthenticated. Anyone could
// rename / re-prioritize / re-domain any mission. Same shape as the
// v10.0.253 /api/missions POST fix · now owner-gated to match GET.
export const PATCH = apiHandler(async (req, { params }) => {
  const payload = await readRequestJson(req);
  const { id } = await params!;
  return updateMission(id, payload);
}, { auth: "owner" });

// v10.0.254 audit fix · DELETE was unauthenticated. Most severe of
// the three · an attacker could delete any mission and orphan all of
// its tasks. Now owner-gated.
export const DELETE = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return deleteMission(id);
}, { auth: "owner" });

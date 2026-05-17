import { createMission, listMissions } from "@/lib/services/missions";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

// v10.0.37 — owner-gated. Pre-fix unauthed.
export const GET = apiHandler(async () => {
  return listMissions();
}, { auth: "owner" });

// v10.0.253 audit fix · POST was unauthenticated. v10.0.37 added auth
// to GET only. Same shape as the v10.0.118 /api/tasks POST fix · an
// unauthenticated caller could create missions at will, polluting the
// active-mission count, the AI tool catalog (which lists missions by
// title), and the daily brief. Now owner-gated to match GET.
export const POST = apiHandler(async (req) => {
  const payload = await readRequestJson(req);
  return createMission(payload);
}, { auth: "owner" });

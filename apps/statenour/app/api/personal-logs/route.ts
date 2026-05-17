import { createPersonalLog, listPersonalLogs } from "@/lib/services/personal";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

// v10.0.44 — auth: "owner" added to both. Personal logs are private
// by definition; the bare apiHandler() wrapper had no auth opt-in.
export const GET = apiHandler(async () => {
  return listPersonalLogs();
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const payload = await readRequestJson(req);
  return createPersonalLog(payload);
}, { auth: "owner" });

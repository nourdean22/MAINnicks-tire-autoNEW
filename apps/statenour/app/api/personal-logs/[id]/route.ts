import { deletePersonalLog, getPersonalLogById, updatePersonalLog } from "@/lib/services/personal";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

// v10.0.44 — auth: "owner" added on all 3 handlers. Personal logs
// are private by definition.
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return getPersonalLogById(id);
}, { auth: "owner" });

export const PATCH = apiHandler(async (req, { params }) => {
  const payload = await readRequestJson(req);
  const { id } = await params!;
  return updatePersonalLog(id, payload);
}, { auth: "owner" });

export const DELETE = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return deletePersonalLog(id);
}, { auth: "owner" });

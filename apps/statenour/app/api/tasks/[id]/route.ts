import { deleteTask, getTaskById, updateTask } from "@/lib/services/tasks";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

// v10.0.37 — owner-gated. Pre-fix unauthed.
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return getTaskById(id);
}, { auth: "owner" });

// v10.0.118 audit fix · PATCH + DELETE were unauthenticated. v10.0.37
// only added auth to GET; the mutating handlers slipped through. Any
// caller who knew a task id could update or delete it from the
// public internet. Now owner-gated like GET.
export const PATCH = apiHandler(async (req, { params }) => {
  const payload = await readRequestJson(req);
  const { id } = await params!;
  return updateTask(id, payload);
}, { auth: "owner" });

export const DELETE = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  return deleteTask(id);
}, { auth: "owner" });

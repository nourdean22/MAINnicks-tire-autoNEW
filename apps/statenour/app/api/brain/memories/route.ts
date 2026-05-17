import { apiHandler } from "@/lib/utils/http";
import { brainMemory } from "@/lib/brain/memory-manager";
import { ServiceError } from "@/lib/utils/service-error";

/** GET /api/brain/memories — List memories with filters */
// v9.1.14 · auth-locked. Was leaking the entire brain memory store.
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? undefined;
  const query = url.searchParams.get("q") ?? undefined;
  const minConfidence = parseFloat(url.searchParams.get("minConfidence") ?? "0");
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  return brainMemory.recall(category, { query, minConfidence, limit });
}, { auth: "owner" });

/** POST /api/brain/memories — Manually add a memory */
export const POST = apiHandler(async (req) => {
  const body = await req.json();

  if (!body.category || !body.key || !body.content) {
    throw new ServiceError("category, key, and content are required", 400);
  }

  return brainMemory.remember(
    body.category,
    body.key,
    body.content,
    body.source ?? "manual",
    body.metadata
  );
}, { auth: "owner" });

/** PATCH /api/brain/memories — Confirm or contradict a memory */
export const PATCH = apiHandler(async (req) => {
  const body = await req.json();

  if (!body.id || !body.action) {
    throw new ServiceError("id and action (confirm|contradict|forget) are required", 400);
  }

  switch (body.action) {
    case "confirm":
      return brainMemory.confirm(body.id);
    case "contradict":
      if (!body.evidence) throw new ServiceError("evidence required for contradict", 400);
      return brainMemory.contradict(body.id, body.evidence);
    case "forget":
      await brainMemory.forget(body.id);
      return { deleted: true };
    case "reinforce":
      return brainMemory.reinforce(body.id, body.content);
    default:
      throw new ServiceError(`Unknown action: ${body.action}`, 400);
  }
}, { auth: "owner" });

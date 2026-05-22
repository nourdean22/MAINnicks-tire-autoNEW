import { apiHandler } from "@/lib/utils/http";
import { brainMemory } from "@/lib/brain/memory-manager";
import { ServiceError } from "@/lib/utils/service-error";
import { listMemories, recordMemory } from "@/lib/services/brain-memories";

/**
 * GET /api/brain/memories — List memories with filters.
 *
 * v9.1.14 · auth-locked. Was leaking the entire brain memory store.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the recall + record
 * logic moved to the shared `lib/services/brain-memories` module · this
 * route AND the new `trpc.brain.{memories,recordMemory}` procedures call
 * the same functions · drift impossible. The route returns the recall
 * rows directly (not the `{ memories }` envelope the service wraps) to
 * keep the legacy response shape — the route's prior return was the raw
 * `brainMemory.recall` array.
 */
export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const query = url.searchParams.get("q") ?? undefined;
    const minConfidence = parseFloat(
      url.searchParams.get("minConfidence") ?? "0",
    );
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    const { memories } = await listMemories({
      category,
      query,
      minConfidence,
      limit,
    });
    return memories;
  },
  { auth: "owner" },
);

/** POST /api/brain/memories — Manually add a memory. */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();

    if (!body.category || !body.key || !body.content) {
      throw new ServiceError("category, key, and content are required", 400);
    }

    const { memory } = await recordMemory({
      category: body.category,
      key: body.key,
      content: body.content,
      source: body.source ?? "manual",
      metadata: body.metadata,
    });
    return memory;
  },
  { auth: "owner" },
);

/** PATCH /api/brain/memories — Confirm or contradict a memory. */
export const PATCH = apiHandler(
  async (req) => {
    const body = await req.json();

    if (!body.id || !body.action) {
      throw new ServiceError(
        "id and action (confirm|contradict|forget) are required",
        400,
      );
    }

    switch (body.action) {
      case "confirm":
        return brainMemory.confirm(body.id);
      case "contradict":
        if (!body.evidence)
          throw new ServiceError("evidence required for contradict", 400);
        return brainMemory.contradict(body.id, body.evidence);
      case "forget":
        await brainMemory.forget(body.id);
        return { deleted: true };
      case "reinforce":
        return brainMemory.reinforce(body.id, body.content);
      default:
        throw new ServiceError(`Unknown action: ${body.action}`, 400);
    }
  },
  { auth: "owner" },
);

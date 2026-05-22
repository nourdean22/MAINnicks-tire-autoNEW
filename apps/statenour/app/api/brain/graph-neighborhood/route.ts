/**
 * GET /api/brain/graph-neighborhood?type=<t>&id=<id>&depth=1
 *
 * Returns the edge neighborhood around a single node so the
 * MemoryGraphExplorer modal can show everything the clicked chip is
 * connected to. Depth=1 returns direct edges; depth=2 expands one
 * more hop (capped so we don't flood the UI).
 *
 * Node label resolution reuses the same lookup the chip renderer does:
 * commitments by description, brain dumps by summary, reflections by
 * insight+date, decisions by title, tasks by title, brain memories by
 * content. Unknown types fall back to the raw id.
 *
 * Response shape:
 *   {
 *     root:   { type, id, label },
 *     nodes:  [{ type, id, label, degree }],
 *     edges:  [{ source: {type,id}, target: {type,id}, relationship, strength, evidence }],
 *   }
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline neighborhood walk + label resolution moved to
 * `lib/services/brain-domain.buildGraphNeighborhood` so this route AND
 * the new `trpc.brain.graphNeighborhood` procedure call the same
 * function · drift impossible.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildGraphNeighborhood } from "@/lib/services/brain-domain";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  const depth = Math.max(
    1,
    Math.min(2, Number(url.searchParams.get("depth") ?? "1")),
  ) as 1 | 2;
  return buildGraphNeighborhood({ type, id, depth });
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts

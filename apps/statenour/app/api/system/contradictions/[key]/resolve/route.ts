/**
 * POST /api/system/contradictions/[key]/resolve · v10.0.529.28 · Arc B 1C
 *
 * Operator-only resolve action for a queued contradiction. Wraps
 * `resolveContradiction()` from `lib/brain/contradiction-surfacer`
 * so the Ultron `ContradictionsCard` can mark a contradiction as
 * one of:
 *
 *   · current_wins  → deprecates the OLD memory (confidence → 0.1)
 *                     so the recall pipeline stops re-surfacing the
 *                     stale position
 *   · old_wins      → deprecates the NEW memory · operator kept the
 *                     prior position, the recent statement was wrong
 *   · both_valid    → no deprecation · context-dependent · ticker
 *                     drops it from the rotation
 *   · dismissed     → false-positive · confidence floored at 0.2 so
 *                     downstream consumers can treat the surface as
 *                     low-signal without losing the row outright
 *
 * Idempotent · re-resolving updates the existing row's status +
 * resolution_note + resolved_at. The route is keyed by the
 * `key` path param (the 16-char sha1 prefix the surfacer
 * generates from new_memory_id + old_memory_id).
 *
 * No body required for the simplest cases · `{status}` is enough.
 * `note` is optional · 200-char operator-supplied explanation that
 * lands in resolution_note for future audit.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
// Phase B.6c · the resolve wrapper moved to a shared service + the body
// schema is the SHARED validator the tRPC `system.resolveContradiction`
// procedure also imports · drift impossible.
import { resolveContradictionEntry } from "@/lib/services/contradictions";
import { contradictionResolveSchema } from "@/lib/validators/system";

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const key = params?.key;
    if (!key || typeof key !== "string") {
      throw new ServiceError("key required", 400);
    }

    let body: import("@/lib/validators/system").ContradictionResolveInput;
    try {
      const text = await req.text();
      if (text.trim().length === 0) {
        throw new ServiceError("body required", 400);
      }
      const json = JSON.parse(text);
      const parsed = contradictionResolveSchema.safeParse(json);
      if (!parsed.success) {
        throw new ServiceError("invalid_body", 400);
      }
      body = parsed.data;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("invalid_json_body", 400);
    }

    // `resolveContradictionEntry` throws ServiceError(404) when the row
    // is missing or its content JSON is corrupt — apiHandler maps it.
    return resolveContradictionEntry({
      key,
      status: body.status,
      note: body.note,
    });
  },
  { auth: "owner" },
);

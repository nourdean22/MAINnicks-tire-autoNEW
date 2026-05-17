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
import { z } from "zod";
import { logger as rootLogger } from "@/lib/logger";
import { resolveContradiction } from "@/lib/brain/contradiction-surfacer";

const log = rootLogger.withSurface("system/contradictions/resolve");

// Strict on `status` · the four values exactly match the
// `ContradictionStatus` union (minus "unresolved" which would be a
// no-op resolve). Note is optional + tight cap · 200 chars covers
// "the SMB pivot was right" / "context-dependent" type explanations.
const resolveSchema = z.object({
  status: z.enum(["current_wins", "old_wins", "both_valid", "dismissed"]),
  note: z.string().max(200).optional(),
});

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const key = params?.key;
    if (!key || typeof key !== "string") {
      throw new ServiceError("key required", 400);
    }

    let body: z.infer<typeof resolveSchema>;
    try {
      const text = await req.text();
      if (text.trim().length === 0) {
        throw new ServiceError("body required", 400);
      }
      const json = JSON.parse(text);
      const parsed = resolveSchema.safeParse(json);
      if (!parsed.success) {
        throw new ServiceError("invalid_body", 400);
      }
      body = parsed.data;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("invalid_json_body", 400);
    }

    const trimmedNote = body.note?.trim() || undefined;

    const result = await resolveContradiction(key, body.status, trimmedNote);
    if (!result) {
      // resolveContradiction returns null when:
      //   · the row doesn't exist (404 territory)
      //   · the content JSON parse failed (data corruption · 500 territory)
      // We can't cheaply distinguish the two without re-reading the row
      // here · return 404 since "row not found" is the dominant case ·
      // log so /system/errors can surface the rarer corruption mode.
      log.warn("resolve_returned_null", { key, status: body.status });
      throw new ServiceError("not_found", 404);
    }

    log.info("contradiction_resolved", {
      key,
      status: body.status,
      hasNote: !!trimmedNote,
    });

    return {
      ok: true,
      key,
      status: body.status,
      resolvedAt: result.resolved_at,
    };
  },
  { auth: "owner" },
);

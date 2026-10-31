/**
 * POST /api/coach/events/[key]/ack
 *
 * Mastery Layer Stage A · dismiss a coach event so it stops surfacing in
 * the active feed. Sets metadata.doneAt (operator done) · preserves the row for
 * history. Idempotent: re-acking just bumps the timestamp.
 *
 * Path param: the event's compound key (e.g. "coach:prune-candidate:abc")
 * — passed URL-encoded by the dismiss button. Server decodes via the
 * built-in Next.js dynamic-param parsing.
 *
 * Returns:
 *   { ok: true, key }   on success
 *   { ok: false, reason } when the event key didn't resolve
 *
 * Auth: owner only · same as the read endpoint.
 */

import { apiHandler } from "@/lib/utils/http";
import { markCoachEventDone } from "@/lib/services/coach-events";
import { ServiceError } from "@/lib/utils/service-error";

interface RouteContext {
  params: Promise<{ key: string }>;
}

export const POST = apiHandler(
  async (_req, ctx: unknown) => {
    const { params } = ctx as RouteContext;
    const { key } = await params;
    if (!key) throw new ServiceError("missing event key", 400);
    // Next.js passes the param URL-decoded already, but be defensive
    // for callers that double-encode.
    const decoded = (() => {
      try {
        return decodeURIComponent(key);
      } catch {
        return key;
      }
    })();
    // The operator dismissing is "done", which survives the writer re-firing; ackCoachEvent is the
    // writer's "condition cleared" signal and made the banner come back (home-pulse W3).
    const ok = await markCoachEventDone(decoded);
    if (!ok) return { ok: false, reason: "event not found or ack failed" };
    return { ok: true, key: decoded };
  },
  { auth: "owner" },
);

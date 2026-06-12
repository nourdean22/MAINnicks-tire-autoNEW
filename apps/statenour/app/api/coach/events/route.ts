/**
 * GET /api/coach/events?surface=<tasks|goals|journal|brain|scoreboard>[&limit=N]
 *
 * Mastery Layer Stage A · Unified Coach Channel reader endpoint.
 * Returns active (not acked, not expired) coach events filtered to
 * the surface the caller renders on. Default limit 5.
 *
 * Surfaces consume this via the <CoachEventBanner> component +
 * usePollingFetch. The channel is read-mostly · this is a list-and-
 * sort endpoint, no fan-out or mutation.
 *
 * POST handler is intentionally NOT defined here — ack flows go
 * through a separate POST /api/coach/events/:eventKey/ack endpoint
 * (added when the dismiss UI lands).
 *
 * Auth: owner only · coach events can reference customer/business
 * subjects, never expose to non-owner surfaces.
 */

import { apiHandler } from "@/lib/utils/http";
import { getActiveCoachEvents, type CoachEventSurface } from "@/lib/services/coach-events";
import { ServiceError } from "@/lib/utils/service-error";

const VALID_SURFACES = new Set<CoachEventSurface>([
  "tasks",
  "goals",
  "journal",
  "brain",
  "scoreboard",
  "home",
]);

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const surfaceParam = url.searchParams.get("surface")?.trim();
    const limitParam = url.searchParams.get("limit")?.trim();

    // surface is optional · omit to fetch ALL (dashboard / admin use).
    // When present, must be one of the closed surfaces.
    let surface: CoachEventSurface | undefined;
    if (surfaceParam) {
      if (!VALID_SURFACES.has(surfaceParam as CoachEventSurface)) {
        throw new ServiceError(
          `invalid surface · use one of ${[...VALID_SURFACES].join("|")}`,
          400,
        );
      }
      surface = surfaceParam as CoachEventSurface;
    }

    // Wave AU · 2026-05-28 · expose includeAcked + bumped cap to 100.
    // The dashboard viewer at /system/coach-events consumes both ·
    // operator filters by surface/kind/priority/acked in-page rather
    // than round-tripping. Default behavior unchanged (5, active only).
    const includeAcked = url.searchParams.get("includeAcked") === "1";
    const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 5;
    const events = await getActiveCoachEvents({ surface, limit, includeAcked });
    return { events };
  },
  { auth: "owner" },
);

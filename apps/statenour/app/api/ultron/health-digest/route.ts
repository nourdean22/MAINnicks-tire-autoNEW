// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

/**
 * GET /api/ultron/health-digest — expose the latest persisted digest.
 *
 * The nightly `health-digest` cron writes to BrainMemory(category=
 * "system_health_digest") at 4am. HQ fetches here to render the morning
 * card.
 *
 * ── Apr 26 freshness rework ──
 * Stale data is the enemy. The original GET handler returned whatever
 * was persisted, even if it was 36+ hours old (cron silently failed).
 * That meant the Ultron card would confidently re-display yesterday's
 * "OAuth expired" warning when today's actual state was different.
 *
 * New policy:
 *   · If the persisted digest is < 4h old → return as-is.
 *   · If older than 4h OR missing → recompute live (cheap parallel
 *     scan of crons / stale / env / oauth / slow routes), persist
 *     the fresh row, return with `livelyComputed: true` so the card
 *     knows it's grounded in current state.
 *   · Errors recomputing → return the stale row with a clear `stale`
 *     flag so the card can degrade visually rather than fabricate.
 *
 * Returns { data: null } when no digest exists at all (fresh install).
 *
 * POST /api/ultron/health-digest — explicit manual refresh.
 *   Forces a recompute regardless of age. Used by the "Refresh" button
 *   on the SystemHealthCard when staleness is surfaced.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  loadLatestHealthDigest,
  computeHealthDigest,
  persistHealthDigest,
  type SystemHealthDigest,
} from "@/lib/system/health-digest";

const STALE_AFTER_MS = 4 * 3_600_000; // 4 hours

interface DigestPayload extends SystemHealthDigest {
  /** True when this response was computed live in the request. */
  livelyComputed?: boolean;
  /** True when we wanted to recompute but couldn't, falling back to a known-stale row. */
  staleFallback?: boolean;
}

async function recomputeAndPersist(): Promise<SystemHealthDigest> {
  const fresh = await computeHealthDigest();
  // Persist is fire-and-forget — we return fresh either way.
  persistHealthDigest(fresh).catch(() => {
    /* nightly cron will retry */
  });
  return fresh;
}

export async function GET() {
  try {
    const persisted = await loadLatestHealthDigest();
    const ageMs = persisted
      ? Date.now() - new Date(persisted.generatedAt).getTime()
      : Infinity;

    if (persisted && ageMs < STALE_AFTER_MS) {
      // Fresh enough — return as-is.
      return NextResponse.json({ data: persisted });
    }

    // Stale or missing — recompute live.
    try {
      const fresh = await recomputeAndPersist();
      const payload: DigestPayload = { ...fresh, livelyComputed: true };
      return NextResponse.json({ data: payload });
    } catch (recomputeErr) {
      // Recompute failed — degrade gracefully. If we have a stale row,
      // return it but flag the staleness explicitly so the card can
      // refuse to display it as authoritative.
      if (persisted) {
        const payload: DigestPayload = { ...persisted, staleFallback: true };
        return NextResponse.json({ data: payload });
      }
      throw recomputeErr;
    }
  } catch (err) {
    return NextResponse.json(
      { data: null, error: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const fresh = await recomputeAndPersist();
    const payload: DigestPayload = { ...fresh, livelyComputed: true };
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: String(err) },
      { status: 500 },
    );
  }
}

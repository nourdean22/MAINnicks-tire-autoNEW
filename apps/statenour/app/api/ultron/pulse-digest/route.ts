import { NextResponse } from "next/server";
import { buildPulseDigest } from "@/lib/services/pulse-digest";

// CP7 · Railway build cannot reach Neon during static prerender. Force
// runtime-only · same effective behavior as Vercel due to cached().
export const dynamic = "force-dynamic";

/**
 * GET /api/ultron/pulse-digest
 *
 * Replacement data source for the raw-list notification bell. Instead
 * of dumping every DriftAlert + AuditEvent as its own row, this
 * endpoint CLUSTERS and RANKS into priority / emerging / wins /
 * maintenance tiers + a summary mood.
 *
 * actions-surface REST→tRPC slice (2026-05-22) · the clustering logic
 * moved to the shared `lib/services/pulse-digest.buildPulseDigest`
 * service · this route AND the new `trpc.brain.pulseDigest` procedure
 * call the same function · drift impossible. The route stays mounted as
 * the rollback path.
 */

export const revalidate = 60;

export async function GET() {
  try {
    return NextResponse.json({ data: await buildPulseDigest() });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          priority: [],
          emerging: [],
          wins: [],
          maintenance: { count: 0, sample: null },
          summary: { total: 0, headline: null, mood: "quiet" as const },
          generatedAt: new Date().toISOString(),
        },
        error: String(err),
      },
      { status: 200 },
    );
  }
}

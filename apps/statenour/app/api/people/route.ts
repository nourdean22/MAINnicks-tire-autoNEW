/**
 * GET /api/people — list PersonProfile rows with derived state.
 * v10.0.529.106 · Wave 67.
 *
 * The people-intelligence backend (lib/brain/people-intelligence.ts ·
 * 218 LOC) has been building PersonProfile rows + trust scores +
 * neglect detection for months. Pre-Wave-67 there was no operator-
 * facing surface · the engine fired alerts into the system prompt
 * and that was it. This endpoint exposes the full set for the
 * /relationships page.
 *
 * Sort: most-recently-interacted first when `sort=recent` ·
 * highest-trust first when `sort=trust` · neglect-first when
 * `sort=neglect` (the operator-action mode).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external
 * fetch consumers · returning unwrapped data lets the envelope wrap
 * cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
}

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") ?? "recent";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

    const orderBy = sort === "trust"
      ? { trustScore: "desc" as const }
      : sort === "neglect"
      ? { lastInteraction: "asc" as const }
      : { lastInteraction: "desc" as const };

    const rows = await prisma.personProfile.findMany({
      // 2026-05-28 · Wave AC.b · operator bug · soft-deleted rows still
      // showed in the relationships list because the findMany was missing
      // the `deletedAt: null` filter. The softDeletePerson mutation does
      // set `deletedAt` correctly · the list query just wasn't honoring
      // it. Single-line fix · all sibling endpoints (watchlist, morning-
      // brief, search) already filter the same way.
      where: { deletedAt: null },
      orderBy,
      take: limit,
      select: {
        id: true,
        name: true,
        role: true,
        relationship: true,
        trustScore: true,
        leverageNotes: true,
        lastInteraction: true,
        interactionCount: true,
      },
    });

    const now = Date.now();
    const NEGLECT_THRESHOLD_DAYS = 14;

    const people: PersonRow[] = rows.map((r) => {
      const daysSinceInteraction = r.lastInteraction
        ? Math.round((now - r.lastInteraction.getTime()) / (24 * 3600_000))
        : null;
      const isNeglected =
        r.interactionCount >= 3 &&
        daysSinceInteraction !== null &&
        daysSinceInteraction > NEGLECT_THRESHOLD_DAYS;
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        relationship: r.relationship,
        trustScore: r.trustScore,
        leverageNotes: r.leverageNotes,
        lastInteraction: r.lastInteraction ? r.lastInteraction.toISOString() : null,
        interactionCount: r.interactionCount,
        daysSinceInteraction,
        isNeglected,
      };
    });

    // Roll-up counts for the page header
    const totals = {
      total: people.length,
      neglected: people.filter((p) => p.isNeglected).length,
      high_trust: people.filter((p) => p.trustScore >= 0.7).length,
      sparse: people.filter((p) => !p.leverageNotes || p.role === "unknown").length,
    };

    return {
      people,
      totals,
      generatedAt: new Date().toISOString(),
    };
  },
  { auth: "owner" },
);

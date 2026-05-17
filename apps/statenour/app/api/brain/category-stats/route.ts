// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

/**
 * GET /api/brain/category-stats — BrainMemory category heat-map.
 *
 * Returns per-category row counts, freshness, confidence, and registry
 * status (known / deprecated / unregistered). Powers /brain/categories
 * which is the first observability surface for what's ACTUALLY in
 * BrainMemory vs what code paths think is there.
 *
 * Shape (flattened for one-pass client render):
 *   {
 *     totalRows: number,
 *     totalCategories: number,
 *     categoriesRegistered: number,
 *     categoriesUnregistered: number,   // drift — writes to unknown buckets
 *     categoriesDeprecated: number,      // rows still under deprecated keys
 *     stats: Array<{
 *       category: string,
 *       rows: number,
 *       permanentRows: number,           // expiresAt IS NULL
 *       latestAt: string | null,         // ISO
 *       oldestAt: string | null,         // ISO
 *       avgConfidence: number,           // 0-1
 *       domain: string,                   // from CATEGORY_DOMAINS
 *       status: 'registered' | 'deprecated' | 'unregistered',
 *       canonicalTarget: string | null,  // only when deprecated
 *     }>
 *   }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  KNOWN_BRAIN_CATEGORIES,
  DEPRECATED_CATEGORY_MAP,
  CATEGORY_DOMAINS,
} from "@/lib/brain/categories";

type StatRow = {
  category: string;
  rows: number;
  permanentRows: number;
  latestAt: string | null;
  oldestAt: string | null;
  avgConfidence: number;
  domain: string;
  status: "registered" | "deprecated" | "unregistered";
  canonicalTarget: string | null;
};

function domainFor(category: string): string {
  for (const [domain, cats] of Object.entries(CATEGORY_DOMAINS)) {
    if (cats.includes(category)) return domain;
  }
  return "Unregistered";
}

export async function GET(req: Request) {
  await requireSession(req);
  try {
    // One query pulls every category's full stats — bigint casts are
    // explicit so we don't have to remember them on the client side.
    const rows = await prisma.$queryRaw<
      Array<{
        category: string;
        rows: bigint;
        permanent_rows: bigint;
        latest_at: Date | null;
        oldest_at: Date | null;
        avg_confidence: number | null;
      }>
    >`
      SELECT
        category,
        COUNT(*)::bigint AS rows,
        COUNT(*) FILTER (WHERE expires_at IS NULL)::bigint AS permanent_rows,
        MAX(created_at) AS latest_at,
        MIN(created_at) AS oldest_at,
        AVG(confidence)::float8 AS avg_confidence
      FROM brain_memories
      GROUP BY category
      ORDER BY COUNT(*) DESC
    `;

    const stats: StatRow[] = rows.map((r) => {
      const isDeprecated = DEPRECATED_CATEGORY_MAP[r.category] !== undefined;
      const isKnown = KNOWN_BRAIN_CATEGORIES.has(r.category);
      return {
        category: r.category,
        rows: Number(r.rows),
        permanentRows: Number(r.permanent_rows),
        latestAt: r.latest_at?.toISOString() ?? null,
        oldestAt: r.oldest_at?.toISOString() ?? null,
        avgConfidence: Number(r.avg_confidence ?? 0),
        domain: domainFor(r.category),
        status: isDeprecated
          ? "deprecated"
          : isKnown
            ? "registered"
            : "unregistered",
        canonicalTarget: DEPRECATED_CATEGORY_MAP[r.category] ?? null,
      };
    });

    const totalRows = stats.reduce((s, x) => s + x.rows, 0);

    return NextResponse.json({
      data: {
        totalRows,
        totalCategories: stats.length,
        categoriesRegistered: stats.filter((s) => s.status === "registered")
          .length,
        categoriesDeprecated: stats.filter((s) => s.status === "deprecated")
          .length,
        categoriesUnregistered: stats.filter(
          (s) => s.status === "unregistered",
        ).length,
        stats,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 },
    );
  }
}

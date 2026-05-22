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
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { buildCategoryStats } from "@/lib/services/brain-domain";

// Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
// the inline GROUP BY query + registry-status mapping moved to
// `lib/services/brain-domain.buildCategoryStats` so this route AND the
// new `trpc.brain.categoryStats` procedure call the same function ·
// drift impossible.
export async function GET(req: Request) {
  await requireSession(req);
  try {
    return NextResponse.json({ data: await buildCategoryStats() });
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

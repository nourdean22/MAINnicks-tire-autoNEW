/**
 * lib/services/reflection-read.ts · reflection viewer read-side (task
 * #13 · 2026-05-23).
 *
 * Shared shallow read for the /brain/reflections viewer. The tRPC
 * `brain.recentReflections` procedure delegates here · a future REST
 * route could call the same function · drift structurally impossible.
 *
 * The companion file `lib/services/reflection.ts` writes reflections
 * (the CoALA synthesis). This file reads them back projected to a flat
 * `ReflectionView` shape — `metadata` Json is opened inside the service
 * and its three known fields (`sourceCategory`, `derivedFrom`,
 * `reflectionWindow`, `confidence`) are projected to top-level scalars
 * + a clean string[] · the recursive Prisma `JsonValue` type never
 * reaches the AppRouter. That is the TS2589 firewall · same pattern as
 * `lib/services/brain-memories.ts` (`BrainMemoryRow`).
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * A flat, shallow projection of a `reflection`-category BrainMemory row
 * with the known metadata fields projected to top-level scalars. The
 * caller never sees raw Prisma Json — the TS2589 firewall.
 */
export interface ReflectionView {
  /** BrainMemory.id. */
  id: string;
  /** The synthesized insight text. */
  content: string;
  /** Model-reported confidence at synthesis time · 0-1. Null if absent. */
  confidence: number | null;
  /** The source category the reflection was derived from. */
  sourceCategory: string;
  /** Source BrainMemory ids the model cited as evidence. */
  derivedFrom: string[];
  /** The rolling window the reflection covered. Null if missing/malformed. */
  reflectionWindow: { from: string; to: string; days: number } | null;
  /** ISO timestamp · the row's createdAt. */
  createdAt: string;
}

/** Input for {@link listRecentReflections}. */
export interface ListRecentReflectionsInput {
  /**
   * Optional source-category filter. When set, only reflections whose
   * `metadata.sourceCategory` matches are returned. Omit (or pass "all")
   * to return every source category. The cron iterates `decision_log`,
   * `pattern`, `belief`, `lesson`, `learning_journal`.
   */
  sourceCategory?: string;
  /** Page size · default 50 · clamped at 1..100 in the procedure. */
  limit?: number;
}

/**
 * Coerce the loose Json `reflectionWindow` field to a typed window or
 * null. Defensive — drops the shape on any malformed value.
 */
function coerceWindow(
  raw: unknown,
): { from: string; to: string; days: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { from?: unknown; to?: unknown; days?: unknown };
  if (typeof obj.from !== "string") return null;
  if (typeof obj.to !== "string") return null;
  if (typeof obj.days !== "number" || !Number.isFinite(obj.days)) return null;
  return { from: obj.from, to: obj.to, days: obj.days };
}

/**
 * Coerce the loose Json `derivedFrom` field to a string[]. Defensive —
 * filters out non-string entries.
 */
function coerceDerivedFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/**
 * Coerce the loose Json `confidence` field to a [0,1] number or null.
 * Defensive — clamps to bounds, drops non-finite values.
 */
function coerceConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * Coerce the loose Json `sourceCategory` field to a string. Falls back
 * to "unknown" if missing or malformed — preserves the row in the list
 * (a synthesized insight is still worth seeing even if its category
 * citation drifted).
 */
function coerceSourceCategory(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "unknown";
  return raw;
}

/**
 * List recent `reflection`-category BrainMemory rows projected to the
 * flat `ReflectionView` shape · newest first. Optionally filtered by
 * `metadata.sourceCategory`.
 *
 * Why the filter happens in JS rather than SQL · the Postgres JSON-path
 * operator (`metadata @> '{...}'`) isn't ergonomic via Prisma without
 * a raw query, and the row volume here is tiny (the cron writes 3-5
 * per category per week — even at year scale we're under ~1k rows). A
 * `take: 200` ceiling + post-filter is correct and cheap.
 */
export async function listRecentReflections(
  input: ListRecentReflectionsInput = {},
): Promise<{ reflections: ReflectionView[] }> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  // Sentinel that means "no filter" — both undefined and "all".
  const filterCategory =
    input.sourceCategory && input.sourceCategory !== "all"
      ? input.sourceCategory
      : null;

  // Over-pull when filtering to give the post-filter room. The
  // brain.reflect dedup guarantees we won't see runaway row counts.
  const takeFromDb = filterCategory ? Math.min(200, limit * 4) : limit;

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.REFLECTION,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: takeFromDb,
    select: {
      id: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  const projected: ReflectionView[] = [];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as {
      sourceCategory?: unknown;
      derivedFrom?: unknown;
      reflectionWindow?: unknown;
      confidence?: unknown;
    };
    const sourceCategory = coerceSourceCategory(meta.sourceCategory);
    if (filterCategory && sourceCategory !== filterCategory) continue;
    projected.push({
      id: r.id,
      content: r.content,
      confidence: coerceConfidence(meta.confidence),
      sourceCategory,
      derivedFrom: coerceDerivedFrom(meta.derivedFrom),
      reflectionWindow: coerceWindow(meta.reflectionWindow),
      createdAt: r.createdAt.toISOString(),
    });
    if (projected.length >= limit) break;
  }

  return { reflections: projected };
}

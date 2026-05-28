/**
 * 2026-05-27 · Power Atlas · fuzzy person-profile resolution.
 *
 * Pre-fix: `prisma.personProfile.upsert({ where: { name } })` used exact
 * case-sensitive match. The people-intelligence engine parsed "Dania"
 * as "Danai" from one brain dump on 2026-05-07 and created a ghost
 * duplicate row · the typo-dup sat in the operator's relationship
 * dossier for 20 days until manual cleanup.
 *
 * This module replaces those upsert call sites with a fuzzy resolver
 * that:
 *
 *   1. Exact case-sensitive match (fast path)
 *   2. Case-insensitive exact (catches "MIKE" vs "Mike")
 *   3. Levenshtein distance ≤ 1 for names ≥ 4 chars (catches "Dania" vs "Danai")
 *   4. Jaro-Winkler similarity ≥ 0.92 for names ≥ 5 chars (catches softer typos)
 *
 * If any check matches, the EXISTING row is updated + a BrainMemory
 * audit row written so the operator can review the auto-merge later.
 *
 * If no match, a NEW row is created.
 *
 * Cost: a single `findMany` over PersonProfile names per resolution.
 * People-intelligence runs once per conversation digest at most · this
 * is cheap.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/person-profile-fuzzy");

/** Levenshtein distance (iterative · O(m*n) time, O(min(m,n)) space). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const al = a.length;
  const bl = b.length;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/** Jaro-Winkler similarity (0.0 to 1.0). */
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1.0;
  const al = a.length;
  const bl = b.length;
  if (al === 0 || bl === 0) return 0.0;

  const matchDist = Math.floor(Math.max(al, bl) / 2) - 1;
  const aMatches = new Array<boolean>(al).fill(false);
  const bMatches = new Array<boolean>(bl).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < al; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, bl);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < al; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / al + m / bl + (m - transpositions / 2) / m) / 3;

  // Winkler prefix bonus (up to 4 matching prefix chars · scale 0.1)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, al, bl); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

interface ResolveResult {
  /** The existing or newly-created profile row. */
  person: { id: string; name: string };
  /** Whether the resolution returned an existing row. */
  matched: boolean;
  /** When matched, the tier of match · "exact" | "case_insensitive" | "levenshtein" | "jaro_winkler" | "created". */
  matchTier: "exact" | "case_insensitive" | "levenshtein" | "jaro_winkler" | "created";
}

/**
 * Resolve a person by name with fuzzy fallbacks · create when no match.
 *
 * Always call this instead of `prisma.personProfile.upsert({where:{name}})`
 * in the auto-creation paths (conversation-memory · nick-agent person.update).
 */
export async function resolvePersonByName(
  inputName: string,
  createDefaults: {
    role?: string;
    relationship?: string;
    trustScore?: number;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<ResolveResult> {
  const name = inputName.trim();
  if (name.length < 2) {
    throw new Error("Name too short for resolution (min 2 chars)");
  }

  // ── Tier 1 · exact case-sensitive ──────────────────────────────
  const exact = await prisma.personProfile.findFirst({
    where: { name },
    select: { id: true, name: true },
  });
  if (exact) return { person: exact, matched: true, matchTier: "exact" };

  // ── Tier 2 · case-insensitive ──────────────────────────────────
  const ci = await prisma.personProfile.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (ci) {
    void logFuzzyMerge(inputName, ci.name, "case_insensitive");
    return { person: ci, matched: true, matchTier: "case_insensitive" };
  }

  // ── Tier 3 + 4 · Levenshtein + Jaro-Winkler ────────────────────
  // Only worth the scan if input is long enough to typo into a similar
  // existing name. Skip for very short names (false-positive risk).
  if (name.length >= 4) {
    const allActive = await prisma.personProfile.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const inputLower = name.toLowerCase();

    // Levenshtein ≤ 1
    for (const candidate of allActive) {
      const candidateLower = candidate.name.toLowerCase();
      if (Math.abs(candidateLower.length - inputLower.length) > 2) continue;
      const dist = levenshtein(inputLower, candidateLower);
      if (dist <= 1 && candidate.name !== name) {
        void logFuzzyMerge(inputName, candidate.name, "levenshtein", { distance: dist });
        return { person: candidate, matched: true, matchTier: "levenshtein" };
      }
    }

    // Jaro-Winkler ≥ 0.92 for names ≥ 5 chars
    if (name.length >= 5) {
      for (const candidate of allActive) {
        const candidateLower = candidate.name.toLowerCase();
        if (Math.abs(candidateLower.length - inputLower.length) > 3) continue;
        const sim = jaroWinkler(inputLower, candidateLower);
        if (sim >= 0.92 && candidate.name !== name) {
          void logFuzzyMerge(inputName, candidate.name, "jaro_winkler", { similarity: sim });
          return { person: candidate, matched: true, matchTier: "jaro_winkler" };
        }
      }
    }
  }

  // ── Tier 5 · create ────────────────────────────────────────────
  const created = await prisma.personProfile.create({
    data: {
      name,
      role: createDefaults.role ?? "unknown",
      relationship: createDefaults.relationship ?? "",
      trustScore: createDefaults.trustScore ?? 0.5,
      lastInteraction: new Date(),
      interactionCount: 1,
      metadata: createDefaults.metadata as never,
    },
    select: { id: true, name: true },
  });
  return { person: created, matched: false, matchTier: "created" };
}

/** Fire-and-forget audit log for fuzzy merges · operator can review later. */
async function logFuzzyMerge(
  inputName: string,
  matchedName: string,
  tier: "case_insensitive" | "levenshtein" | "jaro_winkler",
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PEOPLE_INTELLIGENCE_MERGE,
        key: `merge_${Date.now()}_${matchedName}_${inputName}`.slice(0, 120),
        content: `Auto-merged "${inputName}" → "${matchedName}" via ${tier} match.${
          Object.keys(extra).length > 0 ? ` Detail: ${JSON.stringify(extra)}` : ""
        }`,
        confidence: tier === "case_insensitive" ? 1.0 : tier === "levenshtein" ? 0.95 : 0.9,
        source: "person-profile-fuzzy",
        metadata: { inputName, matchedName, tier, ...extra } as never,
      },
    });
  } catch (err) {
    log.warn("merge_audit_log_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

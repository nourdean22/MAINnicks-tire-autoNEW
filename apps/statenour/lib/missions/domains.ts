/**
 * Canonical life domains · operator brainstorm 2026-06-09.
 *
 * The single backbone for: the per-domain GENERAL anchor missions, the task
 * classifier's routing target, and (later) the goals page. Six domains, each
 * mapped onto a character-sheet stat branch so task completions still credit
 * the right stats.
 *
 * NOTE on the legacy `MissionDomain` Prisma enum (BUSINESS/PERSONAL/HEALTH/
 * CONTENT/FINANCE): we deliberately do NOT extend that enum (ALTER TYPE is the
 * risky migration class). Instead `Mission.canonicalDomain` (additive text
 * column) is the real routing key; the legacy enum is kept for back-compat and
 * mapped in via `canonicalFromLegacy`.
 *
 * Pure — no IO. Safe to import anywhere.
 */

export const CANONICAL_DOMAINS = [
  { key: "health", label: "Health", anchorTitle: "GENERAL HEALTH", statBranch: "body" },
  { key: "mind", label: "Mind", anchorTitle: "GENERAL MIND", statBranch: "mind" },
  { key: "business", label: "Business", anchorTitle: "GENERAL BUSINESS", statBranch: "empire" },
  { key: "social", label: "Social", anchorTitle: "GENERAL SOCIAL", statBranch: "influence" },
  // Personal = errands/home/admin · no single stat branch (catch-all).
  { key: "personal", label: "Personal", anchorTitle: "GENERAL PERSONAL", statBranch: null },
] as const;

export type CanonicalDomain = (typeof CANONICAL_DOMAINS)[number]["key"];

export const CANONICAL_DOMAIN_KEYS: readonly CanonicalDomain[] =
  CANONICAL_DOMAINS.map((d) => d.key);

/** The marker value stored in `Mission.systemKind` for the 6 anchor missions. */
export const GENERAL_ANCHOR_KIND = "GENERAL";

export function isCanonicalDomain(s: string | null | undefined): s is CanonicalDomain {
  return !!s && (CANONICAL_DOMAIN_KEYS as readonly string[]).includes(s);
}

/** Anchor mission title for a domain, e.g. "health" → "GENERAL HEALTH". */
export function anchorTitleFor(domain: CanonicalDomain): string {
  return CANONICAL_DOMAINS.find((d) => d.key === domain)!.anchorTitle;
}

/**
 * Map the legacy `MissionDomain` enum → a canonical domain (back-compat for
 * missions created before this system). CONTENT + FINANCE fold into business
 * (content/marketing + money are empire-branch activities); the 6 canonical
 * domains have no separate content/finance bucket.
 */
const LEGACY_DOMAIN_MAP: Record<string, CanonicalDomain> = {
  HEALTH: "health",
  BUSINESS: "business",
  PERSONAL: "personal",
  CONTENT: "business",
  FINANCE: "business",
};

/** Resolve a canonical domain from the legacy enum · defaults to "personal". */
export function canonicalFromLegacy(legacy: string | null | undefined): CanonicalDomain {
  return LEGACY_DOMAIN_MAP[(legacy ?? "").toUpperCase()] ?? "personal";
}

/**
 * Best legacy `MissionDomain` enum value for a canonical domain — needed
 * because `Mission.domain` is a non-null enum, so a new anchor still needs a
 * legacy value even though `canonicalDomain` is the real key. mind/social/
 * spiritual have no legacy equivalent → PERSONAL placeholder.
 */
const CANONICAL_TO_LEGACY: Record<CanonicalDomain, string> = {
  health: "HEALTH",
  business: "BUSINESS",
  personal: "PERSONAL",
  mind: "PERSONAL",
  social: "PERSONAL",
};

export function legacyDomainFor(domain: CanonicalDomain): string {
  return CANONICAL_TO_LEGACY[domain];
}

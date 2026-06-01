/**
 * Person roles · single source of truth · 2026-06-01
 *
 * BEFORE this file the role vocabulary had drifted three ways:
 *   · createPerson tRPC enum  → 17 roles
 *   · person-edit-drawer UI   → its own hardcoded list
 *   · people-intelligence AI  → only 8 (and invented "partner", which
 *     isn't even a valid role) → the AI could NEVER assign acquaintance,
 *     rival, mentor, close_friend, etc., so it silently downgraded people
 *     to generic buckets. That was half of "it classifies whatever it wants".
 *
 * Everything now imports from here: the Zod enum, the dropdown options,
 * and the AI prompt's allowed-values list.
 */
export const PERSON_ROLES = [
  "employee",
  "customer",
  "vendor",
  "family",
  "competitor",
  "advisor",
  "friend",
  "close_friend",
  "mentor",
  "mentee",
  "ex_friend",
  "acquaintance",
  "network_only",
  "romantic",
  "ex_romantic",
  "enemy",
  "rival",
] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

/** Human labels for the dropdown. */
export const PERSON_ROLE_LABELS: Record<PersonRole, string> = {
  employee: "Employee",
  customer: "Customer",
  vendor: "Vendor",
  family: "Family",
  competitor: "Competitor",
  advisor: "Advisor",
  friend: "Friend",
  close_friend: "Close Friend",
  mentor: "Mentor",
  mentee: "Mentee",
  ex_friend: "Ex-Friend",
  acquaintance: "Acquaintance",
  network_only: "Network Only",
  romantic: "Romantic",
  ex_romantic: "Ex-Romantic",
  enemy: "Enemy",
  rival: "Rival",
};

/** Dropdown-ready options. */
export const PERSON_ROLE_OPTIONS: { value: PersonRole; label: string }[] =
  PERSON_ROLES.map((value) => ({ value, label: PERSON_ROLE_LABELS[value] }));

/** Pipe-joined list for AI prompts (the exact allowed values). */
export const PERSON_ROLE_PROMPT_LIST = PERSON_ROLES.join("|");

/** Type guard — is this string one of the canonical roles? */
export function isPersonRole(v: unknown): v is PersonRole {
  return typeof v === "string" && (PERSON_ROLES as readonly string[]).includes(v);
}

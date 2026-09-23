/**
 * Candidate lifecycle + intake vocabulary — one definition for the form, the
 * router's zod enums, the admin panel and the SLA alarm.
 *
 * WHY (2026-09-23, docs/recruiting/RECRUITING-ENGINE-2026-09.md): the careers
 * funnel had six statuses and one kind of conversion (an application). An
 * employed technician usually will not apply cold; he asks a private question,
 * looks at the shop, or asks to be kept in mind. Those are different first
 * steps, and without naming them "not ready yet" was indistinguishable from
 * "never answered", and a source that produced conversations but few
 * applications looked worthless.
 *
 * Both columns are VARCHAR(32) (drizzle/0122, 0129) — the longest value below
 * is 17 characters. Never widen this list past 32 without a DDL change.
 */

/**
 * candidates.source for a submission whose hidden honeypot field was filled.
 * Saved (never dropped — autofill can fill it for a real person), never
 * alerted, kept out of the 48h SLA alarm, badged in admin. 16 chars; the
 * column is VARCHAR(40). technicianReferrals only links rows whose source is
 * exactly "careers", so a flagged row cannot carry a $300 claim.
 */
export const CANDIDATE_SOURCE_HONEYPOT = "careers_honeypot";

/** What the person asked for on the form. `apply` is the default. */
export const CANDIDATE_INTENTS = [
  "apply",
  "confidential",
  "shop_tour",
  "talent_network",
  "apprentice",
] as const;
export type CandidateIntent = (typeof CANDIDATE_INTENTS)[number];

export const CANDIDATE_INTENT_LABELS: Record<CandidateIntent, string> = {
  apply: "Apply now",
  confidential: "Talk privately first",
  shop_tour: "See the shop first",
  talent_network: "Not ready — keep me in mind",
  apprentice: "Apprentice / want to learn",
};

/** Owner-facing one-liner describing what the person is waiting for. */
export const CANDIDATE_INTENT_ACTION: Record<CandidateIntent, string> = {
  apply: "Review the application and call.",
  confidential: "Currently employed — contact DISCREETLY (text first, never call their shop).",
  shop_tour: "Wants to see the shop — offer an after-hours visit time.",
  talent_network: "Not ready to move — reply once, then check back in a few months.",
  apprentice: "Apprentice interest — ask about schooling and availability.",
};

/**
 * The "what would make you move?" self-selector. Stored as a comma list in
 * candidates.moveReasons (VARCHAR 500): all keys joined fit easily.
 */
export const MOVE_REASONS = [
  "steady_work",
  "better_pay_plan",
  "no_flat_rate",
  "schedule",
  "equipment",
  "less_corporate",
  "better_management",
  "diagnostic_work",
  "shorter_commute",
  "advancement",
] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

export const MOVE_REASON_LABELS: Record<MoveReason, string> = {
  steady_work: "More consistent work",
  better_pay_plan: "Better pay",
  no_flat_rate: "Off flat rate",
  schedule: "Better schedule",
  equipment: "Better equipment",
  less_corporate: "Less corporate pressure",
  better_management: "Better management",
  diagnostic_work: "More diagnostic work",
  shorter_commute: "Shorter commute",
  advancement: "Room to move up",
};

/**
 * Full lifecycle, in funnel order. The first six are the original 0122 set
 * and keep their meaning.
 */
export const CANDIDATE_STATUSES = [
  "new",
  "reviewed",
  "contact_attempted",
  "contacted",
  "conversation",
  "shop_tour",
  "interviewing",
  "skill_check",
  "offer",
  "accepted",
  "started",
  "hired",
  "talent_network",
  "not_now",
  "no_show",
  "declined",
  "withdrew",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * Statuses in which nobody has actually reached the person yet — the set the
 * 48-hour reply alarm watches (together with `contactedAt IS NULL`).
 * `interviewing` stays for the reason getCandidateSlaBreaches gives: an admin
 * can jump there without ever having called.
 */
export const CANDIDATE_SLA_OPEN_STATUSES: readonly CandidateStatus[] = [
  "new",
  "reviewed",
  "contact_attempted",
  "interviewing",
];

/**
 * Moving INTO one of these means a human really talked to the person, so the
 * router stamps contactedAt (once — it never overwrites an earlier stamp).
 */
export const CANDIDATE_CONTACT_IMPLIED_STATUSES: readonly CandidateStatus[] = [
  "contacted",
  "conversation",
  "shop_tour",
  "skill_check",
  "offer",
  "accepted",
  "started",
  "hired",
  "talent_network",
  "not_now",
];

/** Parse a stored comma list back into known reasons, dropping anything unknown. */
export function parseMoveReasons(raw: string | null | undefined): MoveReason[] {
  if (!raw) return [];
  const known = new Set<string>(MOVE_REASONS);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MoveReason => known.has(s));
}

/**
 * The `ref` code from a personal referral link, e.g. /careers?ref=mike-snapon.
 * Read from the captured landing page, so no client change is needed. Only
 * [a-z0-9-] up to 64 chars survives; anything else is not a code we issued.
 */
export function refCodeFromLandingPage(landingPage: string | null | undefined): string | null {
  if (!landingPage) return null;
  try {
    return normalizeRefCode(new URL(landingPage, "https://nickstire.org").searchParams.get("ref"));
  } catch {
    return null;
  }
}

/** A referral code as issued ([a-z0-9-], 1-64 chars, lowercased), or null. The
 *  one rule for both the landing-page code and the last-touch code the careers
 *  form keeps in sessionStorage. */
export function normalizeRefCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(code) ? code : null;
}

/** Referral link for a code — what the admin panel prints on a QR card. */
export function referralLinkFor(code: string, siteUrl: string): string {
  return `${siteUrl}/careers?ref=${encodeURIComponent(code)}&utm_source=referral&utm_medium=qr&utm_campaign=refer-a-tech`;
}

/** Normalize a free-text name into a referral code: "Mike (Snap-on)" -> "mike-snap-on". */
export function slugifyRefCode(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

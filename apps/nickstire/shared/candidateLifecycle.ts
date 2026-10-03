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

/**
 * The follow-up clock — what writes candidates.nextFollowUpAt.
 *
 * WHY (2026-10-03 recruiting audit): drizzle/0129 added nextFollowUpAt "for a
 * not-now / talent-network candidate due another contact", and nothing ever
 * wrote or read it. A technician who said "not yet" was recorded and then
 * forgotten, which throws away the one advantage a small shop has over a
 * job board: being the first call when that tech finally decides to leave.
 *
 * The date is a FUNCTION OF STATUS, set every time the status changes:
 *  - a status in this map schedules the next touch N days out;
 *  - every other status CLEARS it (an active conversation does not need a
 *    nudge, and a hired / declined / withdrawn person must never be chased).
 * The admin can override the day count (snooze) for any non-terminal status.
 *
 * Surfaced only: nothing here sends a message. The owner reaches out by hand,
 * and applicant texts still wait on a consent checkbox + A2P 10DLC campaign.
 * Day counts are PROVISIONAL operating choices, not measured truths.
 */
export const CANDIDATE_FOLLOW_UP_DAYS: Partial<Record<CandidateStatus, number>> = {
  /** Called, no answer: try again tomorrow. */
  contact_attempted: 1,
  /** Missed a tour or interview: one friendly second chance, not a dead file. */
  no_show: 2,
  /** Offer is out: check in before another shop's offer lands. */
  offer: 2,
  /** "Keep me in mind": a light check-in about every two months. */
  talent_network: 60,
  /** Timing is wrong (bonus, raise review, vacation): check back in a quarter. */
  not_now: 90,
};

/** Statuses that must never carry a follow-up: the person is ours or gone. */
export const CANDIDATE_FOLLOW_UP_NEVER: readonly CandidateStatus[] = [
  "accepted",
  "started",
  "hired",
  "declined",
  "withdrew",
];

/** Snooze bounds an admin may pick (days). */
export const CANDIDATE_FOLLOW_UP_MAX_DAYS = 365;

/**
 * Days until the next follow-up for a status change, or null to clear it.
 * `overrideDays` (an admin snooze) wins for any status not in
 * CANDIDATE_FOLLOW_UP_NEVER; out-of-range overrides are ignored, not clamped,
 * so a bad value falls back to the status default rather than inventing one.
 */
export function followUpDaysFor(status: CandidateStatus, overrideDays?: number | null): number | null {
  if (CANDIDATE_FOLLOW_UP_NEVER.includes(status)) return null;
  if (
    typeof overrideDays === "number" &&
    Number.isInteger(overrideDays) &&
    overrideDays >= 1 &&
    overrideDays <= CANDIDATE_FOLLOW_UP_MAX_DAYS
  ) {
    return overrideDays;
  }
  return CANDIDATE_FOLLOW_UP_DAYS[status] ?? null;
}

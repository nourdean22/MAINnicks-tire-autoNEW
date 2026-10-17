/**
 * lib/services/personal-gap.ts · 2026-10-17 (brain W5)
 *
 * The shape and the plain-words rendering of the "own memories without a search
 * vector" gauge. PURE on purpose: no prisma import, because the /system/health
 * page is a client component and a value import from embedding-coverage.ts
 * (which reads the database) would pull the server client into the browser
 * bundle and fail `next build`, not `tsc`. The query lives in
 * embedding-coverage.ts `buildPersonalGap`.
 */

/**
 * Live brain_memories that the embedding policy says SHOULD be embedded and that
 * have no vector in the space dense recall reads. `unknown` is a failed or
 * impossible read. It is never 0.
 */
export type PersonalGap =
  | {
      state: "ok";
      eligible: number;
      missing: number;
      byCategoryTop5: Array<{ category: string; missing: number }>;
    }
  | { state: "unknown"; reason: string };

/**
 * Warn only when the missing share is ABOVE this. The embed-backfill runs in
 * batches, so a small standing lag (prod 2026-10-17: 18 of 17,721 = 0.1%) is
 * normal, and a gauge that is amber for it every day teaches the operator to
 * ignore amber. 1% is a deliberate round number, not a measured threshold.
 */
export const PERSONAL_GAP_WARN_FRACTION = 0.01;

/** What the operator reads for the gauge: one value, a tone, and detail lines. */
export function formatPersonalGap(gap: PersonalGap): {
  label: string;
  value: string;
  tone: "warn" | "ok";
  detail: string[];
} {
  const label = "searchable memories without a vector";
  if (gap.state === "unknown") {
    return { label, value: "?", tone: "warn", detail: [`unknown, not zero: ${gap.reason}`] };
  }
  // No denominator means no rate: say so rather than a "0 of 0" in ok tone.
  if (gap.eligible === 0) {
    return { label, value: "?", tone: "warn", detail: ["unknown, not zero: no eligible rows"] };
  }
  return {
    label,
    value: `${gap.missing} of ${gap.eligible}`,
    tone: gap.missing / gap.eligible > PERSONAL_GAP_WARN_FRACTION ? "warn" : "ok",
    detail: gap.byCategoryTop5.map((c) => `${c.category} ${c.missing}`),
  };
}

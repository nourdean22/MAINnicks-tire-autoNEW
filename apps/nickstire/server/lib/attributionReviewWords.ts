/**
 * Plain words for an attribution review row (job 2026-10-25-attribution-self-learning).
 *
 * The card used to show "Call #20070022 · invoice #6060001 · phone_time_service_candidate".
 * Nour cannot act on that. A row now names the person (from the matched invoice; calls carry
 * no name, 0 of 5,355 on 2026-10-25) and what they asked for: the call's recorded service
 * mention only (set on 5,273 of 5,355 calls). The free-text AI summary is never used: it can
 * open with a caller's name or number, and nothing unredacted leaves the server. Pure.
 */

/** First word of a house greeting name (services/invoiceReviewRequests greetingName); null for its "there" fallback. */
export function firstNameWords(greeting: string | null | undefined): string | null {
  const first = (greeting ?? "").trim().split(" ")[0] ?? "";
  return first && first !== "there" ? first : null;
}

const PLACEHOLDER_MENTION = /^(unknown|none|n\/?a|general( inquiry)?|other)$/i;

/** What the caller asked for: the recorded service mention, at most 90 characters, or null. */
export function askedForWords(serviceMention: string | null | undefined): string | null {
  const mention = (serviceMention ?? "").replace(/\s+/g, " ").trim();
  if (!mention || PLACEHOLDER_MENTION.test(mention)) return null;
  return mention.slice(0, 90);
}

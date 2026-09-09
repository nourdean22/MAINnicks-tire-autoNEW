/**
 * License-plate normalization for the camera -> customer lookup
 * (2026-09-08, ADR-0017). Pure, no I/O.
 *
 * A camera read arrives as "ABC 1234", "abc-1234" or "ABC1234"; every stored
 * plate is compared on the same key: uppercase, alphanumerics only. OCR also
 * confuses O/0, I/1, B/8, S/5 and Z/2, so `plateVariants` yields the plate
 * plus every single-character confusable swap, capped, for an IN (...) match.
 */

export function normalizePlate(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

const CONFUSABLE: Record<string, string> = {
  O: "0",
  "0": "O",
  I: "1",
  "1": "I",
  B: "8",
  "8": "B",
  S: "5",
  "5": "S",
  Z: "2",
  "2": "Z",
};

/** The normalized plate first, then single-swap confusable variants (deduped, capped). */
export function plateVariants(normalized: string, max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (p && !seen.has(p) && out.length < max) {
      seen.add(p);
      out.push(p);
    }
  };
  add(normalized);
  for (let i = 0; i < normalized.length && out.length < max; i++) {
    const swap = CONFUSABLE[normalized[i]];
    if (!swap) continue;
    add(normalized.slice(0, i) + swap + normalized.slice(i + 1));
  }
  return out;
}

/**
 * First two characters only, for LOG LINES: enough to correlate a request
 * with an event, never enough to identify the vehicle. The route logs every
 * call's filters at info level and `lint:pii` cannot see log output.
 */
export function maskPlate(plate: unknown): string {
  const n = normalizePlate(plate);
  if (n.length <= 2) return "*".repeat(n.length);
  return n.slice(0, 2) + "*".repeat(n.length - 2);
}

/**
 * How strongly a booking found by PHONE belongs to the member found by PLATE.
 * A shared household/business number attaches every booking on that phone,
 * so only a first-name (or full-name) agreement upgrades the row from
 * "phone_only" to "phone+name"; callers hide service/vehicle on phone_only.
 * Initials ("J. Smith") never match: one letter is not a name.
 */
export function bookingLinkage(memberName: unknown, bookingName: unknown): "phone+name" | "phone_only" {
  const norm = (s: unknown) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const a = norm(memberName);
  const b = norm(bookingName);
  if (!a || !b) return "phone_only";
  if (a === b) return "phone+name";
  const firstA = a.split(" ")[0];
  const firstB = b.split(" ")[0];
  return firstA.length >= 2 && firstA === firstB ? "phone+name" : "phone_only";
}

/** Last four digits only — the shape every other bridge response uses for phones. */
export function maskPhone(phone: unknown): string {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 4 ? `***-${digits.slice(-4)}` : "***";
}

/** The four outcomes of a plate lookup. Single source of truth: the camera visit
 * ingest validates `customerMatch` against this same list, so the API contract and
 * the classifier cannot drift apart. */
export const PLATE_MATCH_CLASSES = ["EXACT", "CONFUSABLE_UNIQUE", "AMBIGUOUS", "NONE"] as const;
export type PlateMatchClass = (typeof PLATE_MATCH_CLASSES)[number];

/**
 * Classify what a plate lookup actually found (2026-09-09).
 *
 * `plateVariants` deliberately widens the search with single-character OCR
 * confusable swaps (O/0, I/1, B/8, S/5, Z/2), so a hit is NOT necessarily the
 * plate that was read. Until now the only signal of that was a per-row `exact`
 * boolean inside `matches`, which is easy to miss: a caller doing
 * `if (count === 1) linkCustomer(matches[0])` binds a CONFUSABLE match as though
 * it were a confirmed identity.
 *
 * The error cost is asymmetric. Missing a customer match is annoying; attaching
 * the wrong person's history, vehicle and bookings to a car is much worse. So the
 * result carries an explicit class and only `EXACT` is safe to auto-link:
 *
 *   EXACT              exactly one stored plate equals the normalized read
 *   CONFUSABLE_UNIQUE  no exact hit, exactly one confusable candidate — advisory,
 *                      needs staff confirmation, never auto-bound
 *   AMBIGUOUS          several candidates and no single exact hit — no association
 *   NONE               nothing matched
 *
 * Two stored plates equal to the same read (duplicate membership rows) is
 * AMBIGUOUS, not EXACT: the plate no longer identifies one customer.
 */
export function classifyPlateMatches(
  normalized: string,
  matches: ReadonlyArray<{ plate?: unknown }>,
): { matchClass: PlateMatchClass; autoLinkAllowed: boolean; exactCount: number; confusableCount: number } {
  const target = normalizePlate(normalized);
  // Nothing matches nothing. Without this guard an unreadable plate ("") paired
  // with a membership row that has no plate on file scored as CONFUSABLE_UNIQUE,
  // i.e. a blank read looked like a near-miss on a real customer.
  if (!target) {
    return { matchClass: "NONE", autoLinkAllowed: false, exactCount: 0, confusableCount: 0 };
  }

  let exactCount = 0;
  let confusableCount = 0;
  for (const m of matches) {
    const stored = normalizePlate(m.plate);
    if (!stored) continue;          // a row with no plate on file is not a candidate
    if (stored === target) exactCount += 1;
    else confusableCount += 1;
  }

  let matchClass: PlateMatchClass;
  if (exactCount === 1) matchClass = "EXACT";
  else if (exactCount > 1) matchClass = "AMBIGUOUS";
  else if (confusableCount === 1) matchClass = "CONFUSABLE_UNIQUE";
  else if (confusableCount > 1) matchClass = "AMBIGUOUS";
  else matchClass = "NONE";

  return { matchClass, autoLinkAllowed: matchClass === "EXACT", exactCount, confusableCount };
}

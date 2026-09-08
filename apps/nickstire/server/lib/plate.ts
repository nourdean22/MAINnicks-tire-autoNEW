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

/** Last four digits only — the shape every other bridge response uses for phones. */
export function maskPhone(phone: unknown): string {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 4 ? `***-${digits.slice(-4)}` : "***";
}

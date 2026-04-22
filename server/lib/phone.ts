/**
 * Canonical phone-number utilities.
 * One source of truth for E.164 normalization across SMS, ALG, ShopDriver,
 * Messenger, Twilio webhooks, customer imports, booking creation.
 *
 * Any function that needs to compare, store, or send to a phone number
 * should go through normalizePhone() first.
 */

/**
 * Normalize any user-input phone into E.164 format (`+1XXXXXXXXXX` for US).
 * Returns null for invalid inputs — callers MUST handle null.
 *
 * Accepts:
 *   "2168620005"       -> "+12168620005"
 *   "(216) 862-0005"   -> "+12168620005"
 *   "216-862-0005"     -> "+12168620005"
 *   "12168620005"      -> "+12168620005"
 *   "+12168620005"     -> "+12168620005"
 *   "+442071838750"    -> "+442071838750"  (international E.164 passes through)
 *   "12345"            -> null             (too short)
 *   ""                 -> null
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");

  // Already valid E.164 US
  if (digits.startsWith("+1") && digits.length === 12) return digits;
  // International E.164 (11+ digits with +)
  if (digits.startsWith("+") && digits.length >= 11) return digits;

  const justDigits = digits.replace(/\D/g, "");
  // 10-digit US
  if (justDigits.length === 10) return `+1${justDigits}`;
  // 11-digit starting with 1 (US with country code but no +)
  if (justDigits.length === 11 && justDigits.startsWith("1")) return `+${justDigits}`;

  return null;
}

/**
 * Format an E.164 US number for display: +12168620005 -> (216) 862-0005
 * Non-US numbers returned as-is.
 */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  if (!e164.startsWith("+1") || e164.length !== 12) return e164;
  const a = e164.slice(2, 5);
  const b = e164.slice(5, 8);
  const c = e164.slice(8, 12);
  return `(${a}) ${b}-${c}`;
}

/**
 * Strip to 10 raw digits for tracking / data attributes.
 * Returns empty string for invalid input.
 */
export function phoneRawDigits(input: string | null | undefined): string {
  const e164 = normalizePhone(input);
  if (!e164) return "";
  if (e164.startsWith("+1") && e164.length === 12) return e164.slice(2);
  return e164.replace(/\D/g, "");
}

/**
 * True if two phone inputs represent the same number (after normalization).
 */
export function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!na && na === nb;
}

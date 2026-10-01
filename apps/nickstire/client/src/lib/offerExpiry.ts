/**
 * A special "valid through December 31" runs through the END of that day.
 * `new Date("December 31, 2026")` is midnight at its START, so SpecialsPage,
 * comparing that to now, hid every hardcoded offer a day early: OIL2999
 * disappeared on September 30, its last valid day. A phrase that does not
 * parse ("While supplies last") never expires.
 */
export function isSpecialActive(validThrough: string, now: Date = new Date()): boolean {
  const expires = new Date(validThrough);
  if (isNaN(expires.getTime())) return true;
  expires.setHours(23, 59, 59, 999);
  return expires >= now;
}

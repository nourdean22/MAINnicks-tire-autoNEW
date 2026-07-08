/**
 * shopHours — single source of truth for "is the shop open right now".
 *
 * Extracted from StickyTrustBar (2026-07-04, conversion-finisher wave) so
 * time-aware CTAs (diagnose "get down here" card, emissions "come get a
 * scan" hint) can share it instead of re-deriving the schedule.
 *
 * Hours: Mon–Sat 8 AM–6 PM · Sunday 9 AM–4 PM (ET, matches BUSINESS copy).
 */
export function getOpenStatus(): { isOpen: boolean; label: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const minutes = now.getHours() * 60 + now.getMinutes();

  // Sunday: 9 AM - 4 PM
  if (day === 0) {
    const open = 9 * 60;
    const close = 16 * 60;
    if (minutes >= open && minutes < close) return { isOpen: true, label: "Open Now" };
    if (minutes < open) return { isOpen: false, label: "Opens at 9 AM" };
    return { isOpen: false, label: "Opens at 8 AM" };
  }

  // Monday-Saturday: 8 AM - 6 PM
  if (day >= 1 && day <= 6) {
    const open = 8 * 60;
    const close = 18 * 60;
    if (minutes >= open && minutes < close) return { isOpen: true, label: "Open Now" };
    if (minutes < open) return { isOpen: false, label: "Opens at 8 AM" };
    // After closing — next day
    if (day === 6) return { isOpen: false, label: "Opens at 9 AM" }; // Saturday -> Sunday
    return { isOpen: false, label: "Opens at 8 AM" };
  }

  return { isOpen: false, label: "Opens at 8 AM" };
}

/** Today -> Arrival load: the phone tire-demand line. Consumer: ArrivalLoadStrip.tsx. */
/** Shape of dispatch.phoneTireDemandToday (server/lib/tireDemand.ts TireDemandSummary). */
export interface PhoneTireDemand {
  total: number;
  sizes: Array<{ size: string; count: number; new: number; used: number }>;
  sizeUnknown: number;
}

/**
 * "225/65R17 ×3 (2 used) · 205/55R16 · +1 more · 2 without a size" — the sizes
 * to pull for callers who may walk in. Null when nobody asked.
 */
export function phoneDemandLine(d: PhoneTireDemand, maxSizes = 4): string | null {
  if (d.total === 0) return null;
  const parts = d.sizes.slice(0, maxSizes).map((s) => {
    const cond = [s.used ? `${s.used} used` : "", s.new ? `${s.new} new` : ""].filter(Boolean).join(", ");
    return `${s.size}${s.count > 1 ? ` ×${s.count}` : ""}${cond ? ` (${cond})` : ""}`;
  });
  if (d.sizes.length > maxSizes) parts.push(`+${d.sizes.length - maxSizes} more`);
  if (d.sizeUnknown) parts.push(`${d.sizeUnknown} without a size`);
  return parts.join(" · ");
}

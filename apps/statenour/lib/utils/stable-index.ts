/**
 * A stable index from a string key (djb2): the same key always picks the same slot, so a pick keyed on a
 * date or a date-hour holds still while the operator looks at it. Moved out of lib/services/morning-brief.ts
 * (its wisdom-of-the-day) on 2026-10-29 so the Home maxim (lib/wisdom/maxims.ts) uses the same pick.
 */
export function stableIndex(key: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % Math.max(1, mod);
}

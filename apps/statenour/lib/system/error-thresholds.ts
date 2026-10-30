/**
 * lib/system/error-thresholds.ts · 2026-10-29 sync audit, finding 3.
 *
 * The one threshold table for "how bad is today's error count", read by Home
 * (lib/home/health-state.ts) and the /system tower (lib/system/control-tower.ts). Before this the
 * tower flagged any error and went rose at 10 while Home only reacted at 40, so an ordinary day
 * (~12.6 level='error' rows, the 2026-08-04 live baseline) read healthy on Home and rose on the tower.
 *
 * Counts ErrorLog rows with level='error' in the last 24h (no writer emits 'fatal').
 * Elevated >= 20 (well over the daily mean), critical >= 40 (~3x the mean).
 */

export const ERROR_THRESHOLDS = { elevated: 20, critical: 40 } as const;

export type ErrorSeverity = "normal" | "elevated" | "critical";

export function errorSeverity(errors24h: number): ErrorSeverity {
  if (errors24h >= ERROR_THRESHOLDS.critical) return "critical";
  if (errors24h >= ERROR_THRESHOLDS.elevated) return "elevated";
  return "normal";
}

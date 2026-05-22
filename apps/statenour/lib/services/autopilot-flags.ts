/**
 * Auto-pilot flags service · Phase UU.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC settings slice).
 *
 * Lifted near-verbatim from `app/api/settings/autopilot/route.ts` so the
 * legacy REST endpoint AND the new `system.autopilotFlags` /
 * `system.setAutopilotFlags` procedures call the same functions · drift
 * between consumers structurally impossible.
 *
 * Storage: a single `UserPreference` row keyed "autopilot_flags" whose
 * `value` column holds a JSON-stringified `Record<string, boolean>`.
 * Reads fall back to DEFAULTS; writes merge over DEFAULTS so every known
 * flag key always has a value.
 */

import { prisma } from "@/lib/prisma";

/**
 * The historical default flag set. Kept identical to the REST route's
 * `DEFAULTS` map verbatim — the settings page seeds its own richer list
 * of flags client-side, but this server-side default is what a brand-new
 * install (no UserPreference row) reads back. The page merges whatever
 * the server returns over its local list, so extra client-only keys are
 * simply preserved at their local default.
 */
export const AUTOPILOT_DEFAULTS: Record<string, boolean> = {
  auto_morning_autopilot: true,
  auto_morning_brief: true,
  auto_stale_lead_alert: true,
  auto_commitment_check: true,
  auto_brain_cycle: true,
  auto_drift_escalation: true,
  auto_followup_quotes: true,
  auto_weekly_targets: false,
  auto_revenue_alerts: true,
};

const PREF_KEY = "autopilot_flags";

/** Read the persisted auto-pilot flag map. Falls back to DEFAULTS. */
export async function getAutopilotFlags(): Promise<Record<string, boolean>> {
  try {
    const pref = await prisma.userPreference.findFirst({
      where: { key: PREF_KEY },
    });
    if (!pref?.value) return { ...AUTOPILOT_DEFAULTS };
    return JSON.parse(pref.value as string) as Record<string, boolean>;
  } catch {
    return { ...AUTOPILOT_DEFAULTS };
  }
}

/**
 * Persist an auto-pilot flag map. Merges over DEFAULTS so every known
 * key is present, then upserts the single UserPreference row. Returns
 * the merged map (matching the REST route's response).
 */
export async function setAutopilotFlags(
  flags: Record<string, boolean>,
): Promise<Record<string, boolean>> {
  const merged = { ...AUTOPILOT_DEFAULTS, ...flags };
  await prisma.userPreference.upsert({
    where: { key: PREF_KEY },
    create: { key: PREF_KEY, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  return merged;
}

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
 * flag key always has a value. Unknown keys are dropped on both sides.
 */

import { prisma } from "@/lib/prisma";

/**
 * The flag set the runtime actually reads. 2026-10-02 (settings census): the
 * nine `auto_*` keys that lived here (auto_morning_autopilot, auto_morning_brief,
 * auto_stale_lead_alert, auto_commitment_check, auto_brain_cycle,
 * auto_drift_escalation, auto_followup_quotes, auto_weekly_targets,
 * auto_revenue_alerts) had no reader anywhere in apps/ or packages/ — stored
 * dead weight that looked like controls. The one live key is
 * `adhd_operating_rhythm`, read by lib/brain/operating-rhythm.ts (absent or
 * true = ON; only an explicit false stops the rhythm).
 */
export const AUTOPILOT_DEFAULTS: Record<string, boolean> = {
  adhd_operating_rhythm: true,
};

/** Keep only keys something reads, so a dead key cannot ride along forever. */
function knownOnly(flags: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(AUTOPILOT_DEFAULTS)) {
    if (typeof flags[key] === "boolean") out[key] = flags[key] as boolean;
  }
  return out;
}

const PREF_KEY = "autopilot_flags";

/** Read the persisted auto-pilot flag map. Falls back to DEFAULTS. */
export async function getAutopilotFlags(): Promise<Record<string, boolean>> {
  try {
    const pref = await prisma.userPreference.findFirst({
      where: { key: PREF_KEY },
    });
    if (!pref?.value) return { ...AUTOPILOT_DEFAULTS };
    const stored = JSON.parse(pref.value as string) as Record<string, unknown>;
    return { ...AUTOPILOT_DEFAULTS, ...knownOnly(stored) };
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
  // Dead keys in the payload (the toggle spreads whatever the read returned)
  // or already in the stored row are dropped here, so the row converges on
  // the live set at the next write.
  const merged = { ...AUTOPILOT_DEFAULTS, ...knownOnly(flags) };
  await prisma.userPreference.upsert({
    where: { key: PREF_KEY },
    create: { key: PREF_KEY, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  return merged;
}

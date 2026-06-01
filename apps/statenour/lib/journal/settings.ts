/**
 * Journal Brain settings · single-row config (id = "singleton").
 *
 * Tunable knobs for the Journal Brain (scoring weights, anti-gaming floor,
 * link auto-confirm threshold, challenge cadence, creative intensity). Edited
 * by the Phase 2 settings panel; read here with a safe fallback to
 * JOURNAL_SETTINGS_DEFAULTS so callers ALWAYS get a usable config — including
 * the window before the 20260601_journal_brain_foundation migration is applied
 * to prod (the table simply doesn't exist yet → caught → defaults). Never throws.
 */
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("journal/settings");

export interface JournalSettingsValues {
  /** Baseline mastery XP weight for a qualifying capture (habit reward). */
  baselineXp: number;
  /** Master switch for baseline (habit) XP on captures. */
  baselineEnabled: boolean;
  /** Min trimmed chars for an entry to qualify for baseline XP (anti-gaming). */
  qualityFloorChars: number;
  /** Multiplier applied to a goal's stat weight when an entry is grounded to it. */
  groundedXpMultiplier: number;
  /** Auto-confirm a proposed goal link at/above this confidence (0-1). */
  autoConfirmThreshold: number;
  /** Challenge cadence: "every" | "daily" | "off". */
  challengeCadence: string;
  /** Creative idea intensity: "bold" | "balanced" | "off". */
  creativeIntensity: string;
}

export const JOURNAL_SETTINGS_DEFAULTS: JournalSettingsValues = {
  baselineXp: 0.8,
  baselineEnabled: true,
  qualityFloorChars: 40,
  groundedXpMultiplier: 1.5,
  autoConfirmThreshold: 0.8,
  challengeCadence: "daily",
  creativeIntensity: "bold",
};

/**
 * Read the singleton Journal Brain config. Returns JOURNAL_SETTINGS_DEFAULTS
 * when the row — or the whole table, pre-migration — is absent. Never throws.
 */
export async function getJournalSettings(): Promise<JournalSettingsValues> {
  try {
    const row = await prisma.journalSettings.findUnique({ where: { id: "singleton" } });
    if (!row) return JOURNAL_SETTINGS_DEFAULTS;
    return {
      baselineXp: row.baselineXp,
      baselineEnabled: row.baselineEnabled,
      qualityFloorChars: row.qualityFloorChars,
      groundedXpMultiplier: row.groundedXpMultiplier,
      autoConfirmThreshold: row.autoConfirmThreshold,
      challengeCadence: row.challengeCadence,
      creativeIntensity: row.creativeIntensity,
    };
  } catch (err) {
    // Table absent (pre-migration) or transient DB error · degrade to defaults
    // so the capture/enrichment path never breaks on a config read.
    log.warn("journal_settings_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return JOURNAL_SETTINGS_DEFAULTS;
  }
}

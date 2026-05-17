"use client";

/**
 * THE SIGNAL ZONE — unified.
 *
 * Apr 20 rewrite. The old stack (RuminationCard + TomorrowNoteCard +
 * ReflectNudge + MemoryCalibrationCard + BrainCarousel + BetDesk +
 * NarratorStrip) was 7 cards competing to tell Nour the same
 * "you're slipping" story. Nour called it out — stale, redundant,
 * manual STARTs, no synthesis.
 *
 * One card now. /api/ultron/situation does the synthesis server-side
 * (blind spots → narrator → bets → calibration → pin hygiene →
 * ruminations → momentum) and ranks by severity × freshness ×
 * source weight, deduplicates, and returns { primary, secondaries,
 * autoResolved, monitors, counts }.
 *
 * Manual rituals (Calibrate Memory START) are handled by cron now:
 * /api/cron/auto-calibrate re-rules low-risk beliefs overnight and
 * writes a `belief_refresh_report` that morning's situation card
 * surfaces as "overnight: 3 refreshed, 2 need your call."
 *
 * Retired components kept in the repo for reference until a later
 * cleanup sweep — none are mounted here anymore.
 */

import { SituationCard } from "./situation-card";

export function SignalZone() {
  return (
    <section className="space-y-3">
      <SituationCard />
    </section>
  );
}

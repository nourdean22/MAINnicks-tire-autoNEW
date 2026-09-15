/**
 * Snooze presets · 2026-09-15.
 *
 * The two dates every snooze affordance offers, lifted out of
 * components/missions/mission-task-row.tsx (where they were module-private
 * and duplicated verbatim in execution-panel.tsx) so the task inspector's
 * page actions snooze to the SAME instants as the row. Pure, `now`
 * injectable, client-safe.
 *
 *   tomorrow 6am   the resurface cron flips WAITING→READY when snoozedUntil
 *                  ≤ now; 6am gives a soft morning re-entry, not 12:01am churn.
 *   next Mon 6am   "next week" = the start of the next operator-cadence week.
 */

// Both helpers are called from client components only (the Missions row and
// MissionInspectorActions); the local clock is the operator's clock there —
// check-et-clock.mjs waives client components for exactly this reason, and
// the inline waiver below says so on the one line the lint would flag.
export function tomorrow6am(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

export function nextMonday6am(now: Date = new Date()): string {
  const d = new Date(now);
  const dow = d.getDay(); // 0 Sun · 1 Mon · ... — et-clock-allow: browser-only helper (mission row + inspector page actions); the operator's LOCAL clock is the right "next Monday", the lint's own client-component policy
  const daysUntilNextMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  d.setDate(d.getDate() + daysUntilNextMon);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

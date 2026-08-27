/**
 * When work actually gets finished, rendered verbatim for the daily brief.
 *
 * `energy-router` was the last of the read-only modules with no production
 * consumer, and it was the one I twice recommended leaving dark: it reported
 * `totalSamples: 0`, so every recommendation it could make was unearned.
 *
 * That reading was right about the output and wrong about the cause. The module
 * gated its query on `actualMinutes > 0` — a column nothing writes, whose NOT
 * NULL default of 0 makes it look populated (268 of 268 rows non-null, 0 above
 * zero). One filter on an empty column threw away 124 perfectly real
 * completion timestamps. The data was there the whole time; the query refused
 * to look at it.
 *
 * WHAT IS MEASURED, AND WHAT IS NOT — the whole point of this block:
 *
 *   MEASURED    when a task moved to DONE (124 completions, 90d)
 *   MEASURED    the energy band it carried
 *   UNMEASURED  how long it took — nothing has ever written a duration
 *
 * So this renders completion TIMING and says plainly that duration is not
 * measured. It does not render a routing recommendation. `bestForHighEnergy`
 * is null by design here: HIGH-energy completions are 4 of 124, spread one per
 * window, and a "best window" chosen from four coin flips is the brief's
 * documented failure mode with a new source — the same reason `insights[]`
 * stays out of the pages block beside it.
 */
import type { EnergyProfile } from "@/lib/personal/energy-router";
import { MIN_BAND_SAMPLES } from "@/lib/personal/energy-router";

/** Reading order for the windows. Not alphabetical — it is the shape of a day. */
const WINDOW_ORDER = ["morning", "afternoon", "evening", "late"] as const;

/** Human labels, with the boundaries spelled out so the reader can check them. */
const WINDOW_LABEL: Record<string, string> = {
  morning: "morning (6-11)",
  afternoon: "afternoon (12-16)",
  evening: "evening (17-20)",
  late: "late (21-1)",
};

/**
 * Render, or say plainly that nothing was measured.
 *
 * `null` is a failed read and renders UNMEASURED. A profile with zero
 * completions is a real measured result and says so. Collapsing those two is
 * the confusion the EmptyState provenance work removed from every panel.
 */
export function renderEnergyBlock(profile: EnergyProfile | null): string {
  if (!profile) {
    return [
      "## Energy · when work lands",
      "",
      "**UNMEASURED** — the completion-history read failed. This is not a claim",
      "that nothing was finished; nothing was counted.",
    ].join("\n");
  }

  if (profile.totalSamples === 0) {
    return [
      "## Energy · when work lands",
      "",
      "Measured: no tasks completed in the last 90 days.",
    ].join("\n");
  }

  const lines = ["## Energy · when work lands", ""];

  const ranked = WINDOW_ORDER.map((w) => ({ w, slot: profile.windows[w] }))
    .filter((x) => x.slot && x.slot.count > 0)
    .sort((a, b) => b.slot.count - a.slot.count);

  lines.push(
    `${profile.totalSamples} completions in 90d · ` +
      ranked.map((x) => `${WINDOW_LABEL[x.w] ?? x.w} ${x.slot.count}`).join(" · "),
  );

  // The band count, not a routing call. Below the floor this is the only
  // honest thing to say about high-energy work.
  const high = Object.values(profile.windows).reduce((n, s) => n + s.highEnergyCount, 0);
  if (high < MIN_BAND_SAMPLES) {
    lines.push(
      "",
      `HIGH-energy tasks: ${high} of ${profile.totalSamples}. Too few to say which ` +
        `window suits them (floor is ${MIN_BAND_SAMPLES}), so no window is named.`,
    );
  } else if (profile.bestForHighEnergy) {
    const slot = profile.windows[profile.bestForHighEnergy];
    lines.push(
      "",
      `HIGH-energy tasks: ${high} of ${profile.totalSamples}, most in ` +
        `**${WINDOW_LABEL[profile.bestForHighEnergy] ?? profile.bestForHighEnergy}** (${slot?.highEnergyCount ?? 0}).`,
    );
  }

  // Never silently omit the missing half. A reader who sees only timing would
  // reasonably assume duration was considered and found unremarkable.
  if (profile.durationSamples === 0) {
    lines.push(
      "",
      "Task duration is **UNMEASURED** — nothing records how long a task took,",
      "so none of the above says anything about whether work runs long or short.",
    );
  } else {
    const timed = WINDOW_ORDER.map((w) => ({ w, slot: profile.windows[w] })).filter(
      (x) => x.slot && x.slot.overageSamples > 0 && x.slot.avgOverageMinutes !== null,
    );
    lines.push(
      "",
      `Measured durations (${profile.durationSamples}): ` +
        timed
          .map(
            (x) =>
              `${WINDOW_LABEL[x.w] ?? x.w} ${(x.slot.avgOverageMinutes ?? 0) >= 0 ? "+" : ""}` +
              `${Math.round(x.slot.avgOverageMinutes ?? 0)}min over ${x.slot.overageSamples}`,
          )
          .join(" · "),
    );
  }

  return lines.join("\n");
}

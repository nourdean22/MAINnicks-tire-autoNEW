export type FreshnessState = "fresh" | "stale" | "offline" | "unknown" | "failing";

export interface FreshnessResult {
  state: FreshnessState;
  ageMinutes: number | null;
  label: string;
}

/**
 * ROS-083 · `failing` exists because age-since-last-success cannot see a live
 * outage. This card runs on staleAfterMinutes = 24h, so when ALG authentication
 * starts failing at 9am the last success is minutes old and this returned
 * emerald "Fresh · 12m old" — and kept returning it for a FULL DAY while every
 * probe in between was writing an auth_failed row. Recency of the last success
 * and health right now are different questions; the old signature could only
 * ask the first one.
 *
 * `failing` therefore OUTRANKS fresh/stale — a currently-failing integration is
 * not fresh no matter how recent the last good probe was. It does NOT outrank
 * `readable === false`: if our own database is unreadable we have measured
 * nothing, and must not claim ALG is broken either.
 */
export function classifyIntegrationFreshness(input: {
  connected?: boolean | null;
  lastSuccessfulAt?: string | Date | null;
  staleAfterMinutes: number;
  now?: Date;
  /** false when OUR probe log could not be read — a different failure from ALG being down. */
  readable?: boolean | null;
  /** Consecutive auth-attempting probes that have failed since the last success. */
  failuresSinceLastSuccess?: number | null;
  lastAttemptOutcome?: string | null;
}): FreshnessResult {
  if (input.readable === false) {
    return { state: "unknown", ageMinutes: null, label: "Unknown — the probe log could not be read" };
  }
  if (input.connected === false) return { state: "offline", ageMinutes: null, label: "Offline" };

  const failures = input.failuresSinceLastSuccess ?? 0;
  if (failures > 0) {
    const what = input.lastAttemptOutcome === "auth_failed" ? "Auth failing" : "Probe erroring";
    return {
      state: "failing",
      ageMinutes: null,
      label: `${what} · ${failures} failed ${failures === 1 ? "probe" : "probes"} since the last success`,
    };
  }

  if (!input.lastSuccessfulAt) return { state: "unknown", ageMinutes: null, label: "No successful sync recorded" };
  const at = input.lastSuccessfulAt instanceof Date ? input.lastSuccessfulAt : new Date(input.lastSuccessfulAt);
  if (Number.isNaN(at.getTime())) return { state: "unknown", ageMinutes: null, label: "Invalid sync timestamp" };
  const ageMinutes = Math.max(0, Math.floor(((input.now ?? new Date()).getTime() - at.getTime()) / 60000));
  if (ageMinutes > input.staleAfterMinutes) return { state: "stale", ageMinutes, label: `Stale · ${ageMinutes}m old` };
  return { state: "fresh", ageMinutes, label: `Fresh · ${ageMinutes}m old` };
}

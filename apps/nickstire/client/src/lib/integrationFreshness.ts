export type FreshnessState = "fresh" | "stale" | "offline" | "unknown";

export interface FreshnessResult {
  state: FreshnessState;
  ageMinutes: number | null;
  label: string;
}

export function classifyIntegrationFreshness(input: {
  connected?: boolean | null;
  lastSuccessfulAt?: string | Date | null;
  staleAfterMinutes: number;
  now?: Date;
}): FreshnessResult {
  if (input.connected === false) return { state: "offline", ageMinutes: null, label: "Offline" };
  if (!input.lastSuccessfulAt) return { state: "unknown", ageMinutes: null, label: "No successful sync recorded" };
  const at = input.lastSuccessfulAt instanceof Date ? input.lastSuccessfulAt : new Date(input.lastSuccessfulAt);
  if (Number.isNaN(at.getTime())) return { state: "unknown", ageMinutes: null, label: "Invalid sync timestamp" };
  const ageMinutes = Math.max(0, Math.floor(((input.now ?? new Date()).getTime() - at.getTime()) / 60000));
  if (ageMinutes > input.staleAfterMinutes) return { state: "stale", ageMinutes, label: `Stale · ${ageMinutes}m old` };
  return { state: "fresh", ageMinutes, label: `Fresh · ${ageMinutes}m old` };
}

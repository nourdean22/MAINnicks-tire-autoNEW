/**
 * lib/home/health-state.ts — the Home page's "is anything broken?" verdict,
 * as a pure function.
 *
 * EXTRACTED 2026-09-01 from components/home/home-health-chip.tsx (Command
 * Surface rewrite) so the SERVER brief builder (operator-brief.ts) can make
 * the same claim the old client chip made — one truth for both transports.
 * The chip component is retired; this function and its test are the part
 * that mattered. History preserved from the chip's header:
 *
 * "SYSTEM · healthy" on the HOME page is a claim about all three sources;
 * when the server marks any of them unmeasured (`measured === false` — the
 * quota circuit or a crashed scan handed the payload filler zeros), the
 * answer is unknown, never green. The chip was the second consumer of the
 * fabricated-zero payload the 2026-08-04 false-green sweep registered
 * (hub-grid was the first).
 */

export type ChipState = "unknown" | "healthy" | "degraded" | "broken";

/** The slice of the system.hub payload this verdict actually reads. */
export interface HomeHealthSlice {
  crons: { declared: number; silent: number; measured?: boolean };
  errors: { count24h: number; fatal24h: number; measured?: boolean };
  devices: { offline: number; measured?: boolean };
}

export function homeHealthState(
  d: HomeHealthSlice | null,
): { state: ChipState; detail: string } {
  if (!d) return { state: "unknown", detail: "" };
  if (
    d.errors.measured === false ||
    d.crons.measured === false ||
    d.devices.measured === false
  ) {
    return { state: "unknown", detail: "sections unmeasured — db quota or scan failure" };
  }
  // fatal24h counts level='error' (no writer ever emits 'fatal'; the old
  // >0 branch could never fire). "Needs attention" on the HOME page means
  // clearly elevated: >=40/24h is ~3x the live 2026-08-04 baseline of
  // ~12.6 errors/day. A bare >0 would paint most ordinary days red.
  if (d.errors.fatal24h >= 40) {
    return {
      state: "broken",
      detail: `${d.errors.fatal24h} errors in 24h — well above baseline`,
    };
  }
  if (d.crons.silent > 0 || d.devices.offline > 0) {
    return {
      state: "degraded",
      detail: [
        d.crons.silent > 0 ? `${d.crons.silent} silent cron${d.crons.silent === 1 ? "" : "s"}` : null,
        d.devices.offline > 0 ? `${d.devices.offline} device${d.devices.offline === 1 ? "" : "s"} offline` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    state: "healthy",
    detail: `${d.errors.count24h} error-log rows 24h · ${d.crons.declared} crons declared`,
  };
}

"use client";

/**
 * components/home/home-health-chip.tsx — Home consolidation (2026-07-25).
 * The "is anything broken?" answer, in one measured chip. Reads the SAME
 * trpc.system.hub rollup the /system hub grid renders, and applies the
 * same honest-health rules shipped in the 2026-07-25 truth wave: never
 * claim healthy without a measurement; before data arrives the state is
 * UNKNOWN, not green. Tapping through lands on /system for the drill-down.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";

export type ChipState = "unknown" | "healthy" | "degraded" | "broken";

const CHIP_STYLES: Record<ChipState, { dot: string; text: string; label: string }> = {
  unknown: { dot: "bg-zinc-500", text: "text-zinc-400", label: "SYSTEM · not yet measured" },
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300", label: "SYSTEM · healthy" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "SYSTEM · degraded" },
  broken: { dot: "bg-rose-400 animate-pulse", text: "text-rose-300", label: "SYSTEM · needs attention" },
};

/** The slice of the hub payload this chip actually reads. */
export interface HomeHealthSlice {
  crons: { declared: number; silent: number; measured?: boolean };
  errors: { count24h: number; fatal24h: number; measured?: boolean };
  devices: { offline: number; measured?: boolean };
}

/**
 * PURE and exported for the pin. "SYSTEM · healthy" on the HOME page is a
 * claim about all three sources; when the server marks any of them
 * unmeasured (`measured === false` — the quota circuit or a crashed scan
 * handed the payload filler zeros), the answer is unknown, never green.
 * This chip was the second consumer of the fabricated-zero payload the
 * 2026-08-04 false-green sweep registered (hub-grid was the first).
 */
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
  if (d.errors.fatal24h > 0) {
    return {
      state: "broken",
      detail: `${d.errors.fatal24h} fatal error${d.errors.fatal24h === 1 ? "" : "s"} in 24h`,
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
    detail: `${d.errors.count24h} non-fatal errors · ${d.crons.declared} crons declared`,
  };
}

export function HomeHealthChip() {
  const hubQuery = trpc.system.hub.useQuery(undefined, { refetchInterval: 60_000 });
  const d = hubQuery.data ?? null;

  const { state, detail } = homeHealthState(d);
  const s = CHIP_STYLES[state];

  return (
    <Link
      href="/system"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.12em] transition hover:bg-white/[0.05] min-h-[36px]",
        s.text,
      )}
    >
      <span className={cn("inline-block h-2 w-2 rounded-full", s.dot)} />
      {s.label}
      {detail && <span className="normal-case tracking-normal text-zinc-500">· {detail}</span>}
    </Link>
  );
}

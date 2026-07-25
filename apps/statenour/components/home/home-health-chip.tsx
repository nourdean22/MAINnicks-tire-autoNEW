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

type ChipState = "unknown" | "healthy" | "degraded" | "broken";

const CHIP_STYLES: Record<ChipState, { dot: string; text: string; label: string }> = {
  unknown: { dot: "bg-zinc-500", text: "text-zinc-400", label: "SYSTEM · not yet measured" },
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300", label: "SYSTEM · healthy" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "SYSTEM · degraded" },
  broken: { dot: "bg-rose-400 animate-pulse", text: "text-rose-300", label: "SYSTEM · needs attention" },
};

export function HomeHealthChip() {
  const hubQuery = trpc.system.hub.useQuery(undefined, { refetchInterval: 60_000 });
  const d = hubQuery.data ?? null;

  let state: ChipState = "unknown";
  let detail = "";
  if (d) {
    if (d.errors.fatal24h > 0) {
      state = "broken";
      detail = `${d.errors.fatal24h} fatal error${d.errors.fatal24h === 1 ? "" : "s"} in 24h`;
    } else if (d.crons.silent > 0 || d.devices.offline > 0) {
      state = "degraded";
      detail = [
        d.crons.silent > 0 ? `${d.crons.silent} silent cron${d.crons.silent === 1 ? "" : "s"}` : null,
        d.devices.offline > 0 ? `${d.devices.offline} device${d.devices.offline === 1 ? "" : "s"} offline` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      state = "healthy";
      detail = `${d.errors.count24h} non-fatal errors · ${d.crons.declared} crons declared`;
    }
  }
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

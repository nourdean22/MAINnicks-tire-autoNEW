/**
 * AutonomyCensusPanel — NT-004 (2026-08-13).
 *
 * Declared-vs-live readout over the SMS autonomy ladder, derived from
 * SMS_AUTOMATION_REGISTRY on the server (never a hand-list — the statenour
 * census precedent: its first live run found 17 severed rules where the hand
 * inspection found 2). Read-only: the census says what IS, the Rollout
 * Control Center above it is where the operator changes anything.
 *
 * Honesty rules carried over: an unreadable lane renders as UNKNOWN, never
 * off; "off" is not flagged (may be intentionally dormant); the panel prints
 * its own blind spots — an instrument that hides them is the failure class
 * it exists to catch.
 */
import { Radar } from "lucide-react";
import { trpc } from "@/lib/trpc";

const STATUS_STYLE: Record<string, string> = {
  within_ceiling: "border-border/30 text-foreground/60",
  over_ceiling: "border-red-500/50 text-red-400",
  unreadable: "border-amber-500/50 text-amber-400",
  not_live_read: "border-border/30 text-foreground/40",
};

export default function AutonomyCensusPanel() {
  const census = trpc.smsOrchestrator.autonomyCensus.useQuery(undefined, {
    refetchInterval: 300_000,
    staleTime: 240_000,
    refetchIntervalInBackground: false,
  });

  if (census.isError) {
    return (
      <div className="bg-card border border-amber-500/40 p-4 text-xs text-amber-400">
        Autonomy census unreadable — declared-vs-live state is UNKNOWN right now, not fine.
      </div>
    );
  }
  const data = census.data;
  if (!data) {
    return <div className="bg-card border border-border/30 p-4 text-xs text-foreground/40">Running autonomy census…</div>;
  }

  return (
    <div className="bg-card border border-border/30 p-6 space-y-4">
      {!data.dbAvailable && (
        <div className="border border-red-500/50 bg-red-500/10 p-2.5 text-[11px] text-red-400 font-semibold">
          DB UNREACHABLE — the dispatcher falls back to legacy_passthrough, so the autonomy ladder is
          unenforceable right now. Every mode below is the fallback state, not an operator choice.
        </div>
      )}
      <div className="border-b border-border/20 pb-3">
        <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2">
          <Radar className="w-4.5 h-4.5 text-primary" />
          Autonomy Census — declared ceiling vs live mode
        </h3>
        <p className="text-[11px] text-foreground/40 mt-0.5">
          {data.summary.total} lanes from the code registry · {data.summary.liveRead} live-read ·{" "}
          {data.summary.overCeiling > 0 ? (
            <span className="text-red-400 font-bold">{data.summary.overCeiling} OVER CEILING</span>
          ) : (
            "0 over ceiling"
          )}
          {data.summary.unreadable > 0 && (
            <span className="text-amber-400"> · {data.summary.unreadable} unreadable</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.lanes.map((lane) => (
          <div
            key={lane.key}
            className={`p-2.5 border rounded bg-accent/10 text-[11px] ${STATUS_STYLE[lane.status] ?? "border-border/30"}`}
            title={lane.detail}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold truncate">{lane.key}</span>
              <span className="shrink-0 font-mono">
                L{lane.level} · {lane.liveMode ?? (lane.status === "not_live_read" ? "flag/env" : "?")}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] opacity-80 truncate">
              ceiling {lane.declaredCeiling}
              {lane.armedBy ? ` · armed by ${lane.armedBy}` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-foreground/35 border-t border-border/15 pt-2">
        Blind spots (by design): {data.blindSpots.join(" · ")}
      </div>
    </div>
  );
}

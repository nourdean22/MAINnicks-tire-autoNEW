/**
 * VoiceBrief — wave-181.x Voice Phase 2.
 *
 * Mirror of CustomersBrief / OutreachBrief / LeadsBrief / MoneyBrief
 * · 3-line auto-narrative that lands above the MetricGrid so the
 * operator's first eye-grab is "what's happening with Nick today"
 * rather than 5 KPI tiles + a chart.
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. VELOCITY · today's call volume + forwarded + avg duration
 *   2. LIVE     · in-flight calls right now · auto-refreshes
 *   3. ACTION   · "stuck" calls (Nick reached for a tool but never
 *                 confirmed) — the highest-value review target ·
 *                 clarity-gate · self-hides when no stuck calls
 *
 * STEAL (per skill-mining agent · DFII 8-9)
 *   · data-storytelling · headline = "specific number + business
 *                          impact + actionable context"
 *   · clarity-gate     · null Action line when nothing actionable
 *   · verification-before-completion · the "stuck" call concept ·
 *                          Nick CLAIMED it was working but never
 *                          confirmed success · highest-value
 *                          review target per karpathy verify rule
 *
 * NO NEW SERVER WORK · composes from queries the parent already
 * runs: vapi.todayMetrics + vapi.activeCallStates.
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · Loading state    · short shimmer line · not full skeleton
 *   · "Stuck call"     · activeCallStates entry where state ===
 *                        "tool_called" but the parent hasn't seen
 *                        a "confirmed" event yet · best signal we
 *                        have client-side for "Nick fumbled this"
 *   · Action threshold · >= 1 stuck call shows the line · else
 *                        null (per clarity-gate empty > fake)
 *   · Avg-duration units · seconds → minutes for readability ·
 *                        sub-1min stays in seconds
 */
import { trpc } from "@/lib/trpc";
import { PhoneCall, Activity, AlertTriangle, ArrowRight, Phone } from "lucide-react";

interface VoiceBriefProps {
  /** Click handler for the stuck-calls Action CTA · scrolls to LiveCallsCard. */
  onStuckCallsAction: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 10) return `${minutes.toFixed(1)} min`;
  return `${Math.round(minutes)} min`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function VoiceBrief({ onStuckCallsAction }: VoiceBriefProps) {
  // Today's window (no sinceISO/untilISO → server defaults to start-of-day)
  const { data: metrics } = trpc.vapi.todayMetrics.useQuery(undefined, {
    staleTime: 60_000,
  });
  // In-flight calls (LiveCallsCard polls this · we share the cache via
  // tRPC · no double fetch). Same input shape · matches the parent.
  const { data: live } = trpc.vapi.activeCallStates.useQuery(
    { maxAgeMinutes: 10 },
    { staleTime: 10_000 },
  );

  // Clarity-gate · loading state · don't render fake numbers
  if (!metrics || !live) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading voice brief…
        </div>
      </div>
    );
  }

  // Guard against the error-shape (metrics.ok === false during outage)
  const totalCalls = metrics.ok ? metrics.total ?? 0 : 0;
  const forwarded = metrics.ok ? metrics.forwarded ?? 0 : 0;
  const avgSeconds = metrics.ok ? metrics.avgSeconds ?? 0 : 0;
  const inbound = metrics.ok ? metrics.inbound ?? 0 : 0;

  // In-flight count + stuck calls. activeCallStates returns a record
  // with `states` array and `byState` aggregates; we count entries in
  // "tool_called" state that aren't yet "confirmed" — Nick reached
  // for a booking/callback tool but the success event never landed.
  const inFlightCount = live.count ?? 0;
  const stuckCount = live.byState?.tool_called ?? 0;

  return (
    <div className="bg-card border border-border/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
          {greeting()} · voice brief
        </span>
        <span className="text-[10px] tracking-wider text-foreground/30">
          today
        </span>
      </div>
      <div className="space-y-1.5">
        {/* Line 1 · velocity */}
        <div className="flex items-center gap-2.5">
          <PhoneCall className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Today · {totalCalls.toLocaleString()} call{totalCalls === 1 ? "" : "s"}
            {inbound > 0 ? ` · ${inbound.toLocaleString()} inbound` : ""}
            {forwarded > 0 ? ` · ${forwarded.toLocaleString()} forwarded to you` : ""}
            {avgSeconds > 0 ? ` · ${formatDuration(avgSeconds)} avg` : ""}
          </span>
        </div>

        {/* Line 2 · live · skip when no calls in flight (clarity-gate) */}
        {inFlightCount > 0 ? (
          <div className="flex items-center gap-2.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0 animate-pulse" />
            <span className="text-[12.5px] text-emerald-300 leading-tight">
              Live · {inFlightCount.toLocaleString()} call{inFlightCount === 1 ? "" : "s"} in flight right now
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <Phone className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
            <span className="text-[12.5px] text-foreground/60 leading-tight">
              Live · no calls in flight · Nick is on standby
            </span>
          </div>
        )}

        {/* Line 3 · action · stuck calls only (clarity-gate hides else) */}
        {stuckCount > 0 ? (
          <button
            type="button"
            onClick={onStuckCallsAction}
            className="flex items-center gap-2.5 w-full text-left hover:bg-amber-500/[0.04] -mx-2 px-2 py-1 rounded transition-colors group"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-300 leading-tight flex-1">
              Action · <span className="font-semibold">{stuckCount}</span> stuck call{stuckCount === 1 ? "" : "s"} · Nick reached for a tool but never confirmed · review the transcript
            </span>
            <span className="text-[10px] text-amber-400/60 tracking-wider group-hover:text-amber-400 transition-colors whitespace-nowrap">
              REVIEW <ArrowRight className="w-3 h-3 inline-block -mt-0.5" />
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

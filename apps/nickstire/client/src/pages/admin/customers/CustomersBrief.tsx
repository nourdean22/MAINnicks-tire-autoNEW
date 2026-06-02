/**
 * CustomersBrief — wave-181.x Customers Phase 2.
 *
 * Mirror of the Today page's MorningBrief pattern · 3-line auto-
 * narrative that lands above the KPI strip so the operator's first
 * eye-grab is "what's the state of the customer base" rather than
 * "what are these 8 stat cards."
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. ROSTER: total tracked + VIPs (3+ visits) + commercial split
 *   2. VALUE: total revenue · avg ticket · with-email coverage
 *   3. ACTION: lapsed cohort with a one-tap link to filter the table
 *
 * DEGRADATION
 *   · No stats yet (DB cold start)         → "Loading customer roster…"
 *   · Zero lapsed customers                → green "all clear" tone
 *   · `stats` undefined for any field      → field omitted from its line
 *
 * NO NEW SERVER WORK · all data composes from the existing
 * `customers.stats` tRPC query that the StatCard grid already uses.
 *
 * COOL FEATURES STOLEN FROM SKILLS
 *   · morning-brief / daily-briefing  · 3-line summary header
 *   · clarity-gate                    · skip lines when no real signal
 *   · kpi-dashboard-design            · the same KpiTile language
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · Loading state → render a short shimmer line · not full skeleton
 *   · Avg ticket math? → totalRevenue / totalCustomers (rough · matches
 *     the StatCard grid's logic). Per-customer math lives on rows.
 *   · "Lapsed" action button → fires the parent's setSegment("lapsed")
 *     via a callback prop · keeps state ownership with CustomersList.
 */
import { trpc } from "@/lib/trpc";
import { Users, Crown, AlertTriangle, ArrowRight, DollarSign } from "lucide-react";

interface CustomersBriefProps {
  /** Click handler for the "View lapsed cohort" CTA · should setSegment("lapsed") */
  onLapsedAction: () => void;
}

function formatCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function CustomersBrief({ onLapsedAction }: CustomersBriefProps) {
  const { data: stats, isLoading } = trpc.customers.stats.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Clarity-gate · loading state · don't render fake numbers
  if (isLoading) {
    return (
      <div className="bg-card border border-border/40 rounded-lg p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading customer roster…
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // wave-181.x · stats payload uses `total` (not `totalCustomers`)
  const totalCustomers = stats.total ?? 0;
  const vipCount = stats.vipCount ?? 0;
  const commercial = stats.commercial ?? 0;
  const lapsed = stats.lapsed ?? 0;
  const totalRevenueCents = stats.totalRevenue ?? 0;
  const withEmail = stats.withEmail ?? 0;
  const avgTicketCents = totalCustomers > 0 ? Math.round(totalRevenueCents / totalCustomers) : 0;
  const emailCoverage = totalCustomers > 0 ? Math.round((withEmail / totalCustomers) * 100) : 0;

  return (
    <div className="bg-card border border-border/40 rounded-lg p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
          {greeting()} · customer brief
        </span>
        <span className="text-[10px] tracking-wider text-foreground/30">
          {totalCustomers.toLocaleString()} tracked
        </span>
      </div>
      <div className="space-y-1.5">
        {/* Line 1 · roster */}
        <div className="flex items-center gap-2.5">
          <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Roster · {totalCustomers.toLocaleString()} customers ·{" "}
            <Crown className="w-3 h-3 text-amber-400 inline-block -mt-0.5" /> {vipCount.toLocaleString()} VIPs (3+ visits)
            {commercial > 0 ? ` · ${commercial.toLocaleString()} commercial` : ""}
          </span>
        </div>

        {/* Line 2 · value · skip when zero revenue */}
        {totalRevenueCents > 0 && (
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              LTV · {formatCents(totalRevenueCents)} across the database
              {avgTicketCents > 0 ? ` · ${formatCents(avgTicketCents)} avg lifetime per customer` : ""}
              {emailCoverage > 0 ? ` · ${emailCoverage}% have email` : ""}
            </span>
          </div>
        )}

        {/* Line 3 · action */}
        {lapsed > 0 ? (
          <button
            type="button"
            onClick={onLapsedAction}
            className="flex items-center gap-2.5 w-full text-left hover:bg-amber-500/[0.04] -mx-2 px-2 py-1 rounded transition-colors group"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-300 leading-tight flex-1">
              Action · {lapsed.toLocaleString()} lapsed customer{lapsed === 1 ? "" : "s"} · win-back opportunity
            </span>
            <span className="text-[10px] text-amber-400/60 tracking-wider group-hover:text-amber-400 transition-colors">
              VIEW <ArrowRight className="w-3 h-3 inline-block -mt-0.5" />
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              Action · zero lapsed customers · roster is healthy
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

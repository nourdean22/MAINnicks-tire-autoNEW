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
 *   3. QUEUE: lapsed regulars to contact now (2026-10-25), from
 *      `stats.lapsedRegulars`: the rule, how many qualify, how many can be
 *      texted, out of the customers with a visit; "View list" filters the
 *      table to the same people, "Open Win-Back" lands on Outreach > Win-Back
 *
 * DEGRADATION
 *   · No stats yet (DB cold start)         → "Loading customer roster…"
 *   · Zero lapsed regulars                 → says so with the rule, Win-Back link only
 *   · `lapsedRegulars` missing (old server) → queue line omitted, never a 0
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
 *   · "View list" → fires the parent's callback (segment lapsed + regulars
 *     only) · keeps state ownership with CustomersList.
 */
import { trpc } from "@/lib/trpc";
import { Users, Crown, Clock, DollarSign } from "lucide-react";
import { VIP_MIN_VISITS, LAPSED_REGULAR_RULE } from "@shared/customerSegments";
import { formatCents } from "../shared/format";
import { navigateToAdminUrl } from "../shared/navigation";

const WINBACK_HREF = "/admin?tab=campaigns&outreachTab=winback";
const fmt = (n: number) => n.toLocaleString("en-US");

interface CustomersBriefProps {
  /** "View list" on the lapsed-regulars queue: filter the table to lapsed AND regulars */
  onLapsedAction: () => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function CustomersBrief({ onLapsedAction }: CustomersBriefProps) {
  const { data: stats, isLoading, isError, fetchStatus } = trpc.customers.stats.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Clarity-gate · loading state · don't render fake numbers
  if (isLoading) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[11px] font-bold text-foreground/30 animate-pulse">
          Loading customer roster…
        </div>
      </div>
    );
  }

  // A failed read must not vanish: an empty header reads as "nothing to say".
  if (isError) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[12.5px] text-amber-300">{"Customer stats couldn't load, state unknown"}</div>
      </div>
    );
  }

  // A paused (offline PWA) read never ran: say so instead of vanishing.
  if (!stats && fetchStatus === "paused") {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[12.5px] text-amber-300">Customer stats not checked (offline)</div>
      </div>
    );
  }

  if (!stats) return null;

  // wave-181.x · stats payload uses `total` (not `totalCustomers`)
  const totalCustomers = stats.total ?? 0;
  const vipCount = stats.vipCount ?? 0;
  const commercial = stats.commercial ?? 0;
  // Missing on an older server: the queue line is omitted, never rendered as 0.
  const lapsedRegulars: { qualifying: number; contactable: number } | undefined = stats.lapsedRegulars;
  const totalRevenueCents = stats.totalRevenue ?? 0;
  const withEmail = stats.withEmail ?? 0;
  const avgTicketCents = totalCustomers > 0 ? Math.round(totalRevenueCents / totalCustomers) : 0;
  const emailCoverage = totalCustomers > 0 ? Math.round((withEmail / totalCustomers) * 100) : 0;

  return (
    <div className="bg-card border border-border/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">
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
            <Crown className="w-3 h-3 text-amber-400 inline-block -mt-0.5" /> {vipCount.toLocaleString()} VIPs ({VIP_MIN_VISITS}+ visits)
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

        {/* Line 3 · queue: who to contact now. No names or phones here; the rows carry them. */}
        {lapsedRegulars && (
          <div data-testid="lapsed-regulars-queue" className="space-y-2 pt-1">
            <div className="flex items-start gap-2.5">
              <Clock className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${lapsedRegulars.qualifying > 0 ? "text-amber-400" : "text-foreground/40"}`} aria-hidden />
              <span className={`text-[12.5px] leading-snug ${lapsedRegulars.qualifying > 0 ? "text-amber-300" : "text-foreground/85"}`}>
                {lapsedRegulars.qualifying > 0
                  ? `Lapsed regulars · ${fmt(lapsedRegulars.qualifying)} qualify (${LAPSED_REGULAR_RULE}) · ${fmt(lapsedRegulars.contactable)} can be texted · of ${fmt(stats.withVisits)} customers with a visit`
                  : `No lapsed regulars right now (${LAPSED_REGULAR_RULE}).`}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {lapsedRegulars.qualifying > 0 && (
                <button
                  type="button"
                  onClick={onLapsedAction}
                  className="min-h-11 px-4 inline-flex items-center justify-center rounded border border-border/60 text-sm font-semibold text-foreground hover:border-primary/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  View list
                </button>
              )}
              <a
                href={WINBACK_HREF}
                onClick={(e) => {
                  if (navigateToAdminUrl(e, WINBACK_HREF, "campaigns")) e.preventDefault();
                }}
                className="min-h-11 px-4 inline-flex items-center justify-center rounded bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Open Win-Back
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

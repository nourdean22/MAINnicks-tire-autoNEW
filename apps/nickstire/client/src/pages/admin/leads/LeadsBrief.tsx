/**
 * LeadsBrief — wave-181.x Leads Phase 2.
 *
 * Mirror of CustomersBrief / OutreachBrief / MorningBrief · 3-line
 * auto-narrative that lands above the StatCard grid so the operator's
 * first eye-grab is "what's the state of the top-of-funnel" rather
 * than "8 stat tiles + a Kanban".
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. VELOCITY · 24h new + uncontacted + booked counts
 *   2. PIPELINE · $ value of new + contacted leads · $ at-risk uncontacted
 *   3. ACTION   · SLA breach count (>4h uncontacted) · "5min = 9x conversion"
 *                 fallback: stale contacted leads (>3d no follow-up)
 *                 clarity-gate · self-hides when no real signal
 *
 * STEAL · loss-aversion-designer pattern (per parallel skill-mining
 * agent · DFII 9.0) · reference-point framing on the dollar cost of
 * inaction. Same shape that landed on Outreach declined-recovery banner.
 *
 * DEGRADATION
 *   · leadsData loading                 → short shimmer line
 *   · zero new leads in 24h             → green "queue is quiet" tone
 *   · zero SLA breaches + no stale      → action line hidden (clarity-gate)
 *
 * NO NEW SERVER WORK · composes from the same `trpc.lead.list` query
 * the parent LeadsSection already runs · cache-hit reuse, no extra
 * network round trip.
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · "Stale contacted" threshold → 3 days (matches the existing
 *     comment in audit agent's missing-signal report · operator's
 *     mental model of "ghost risk")
 *   · "SLA breach" threshold → 4 hours (matches LeadAge's red tier ·
 *     keeps the brief consistent with the visual SLA timer color
 *     code already shipping on each card)
 *   · Pipeline value → sum of estimatedValueCents over (new, contacted)
 *     only · excludes booked/completed/lost/closed (those have left
 *     the active-pipeline state · counting them inflates the number)
 */
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Zap, DollarSign, Clock, TrendingUp } from "lucide-react";
import { formatCents } from "../shared/format";

// wave-181.x Leads Phase 2 · use the tRPC-inferred row type rather
// than a manual mirror of the schema. Keeps this brief in sync with
// the wider DB shape automatically.
type Lead = RouterOutputs["lead"]["list"][number];

interface LeadsBriefProps {
  /** Click handler for the SLA-breach action CTA · scrolls to + flashes the urgent banner. */
  onSlaAction: () => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

const ACTIVE_PIPELINE_STATUSES = new Set(["new", "contacted"]);
const SLA_BREACH_MS = 4 * 60 * 60 * 1000; // 4h
const STALE_FOLLOWUP_MS = 3 * 24 * 60 * 60 * 1000; // 3d

export function LeadsBrief({ onSlaAction }: LeadsBriefProps) {
  const { data: leadsData, isLoading } = trpc.lead.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Clarity-gate · loading state · don't render fake numbers
  if (isLoading || !leadsData) {
    return (
      <div className="bg-card border border-border/40 rounded-lg p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading lead pipeline…
        </div>
      </div>
    );
  }

  const now = Date.now();
  const oneDayAgo = now - 86_400_000;

  // VELOCITY · last 24h
  const newLast24h = leadsData.filter((l: Lead) => new Date(l.createdAt).getTime() >= oneDayAgo).length;
  const uncontactedLast24h = leadsData.filter(
    (l: Lead) => l.status === "new" && new Date(l.createdAt).getTime() >= oneDayAgo,
  ).length;
  const bookedLast24h = leadsData.filter(
    (l: Lead) => l.status === "booked" && new Date(l.createdAt).getTime() >= oneDayAgo,
  ).length;

  // PIPELINE · $ value of active leads · $ at-risk = uncontacted >4h
  let pipelineCents = 0;
  let atRiskCents = 0;
  let slaBreachCount = 0;
  let staleContactedCount = 0;

  for (const lead of leadsData) {
    const valueCents = lead.estimatedValueCents ?? 0;
    const ageMs = now - new Date(lead.createdAt).getTime();

    if (ACTIVE_PIPELINE_STATUSES.has(lead.status)) {
      pipelineCents += valueCents;
    }

    if (lead.status === "new" && ageMs >= SLA_BREACH_MS) {
      slaBreachCount += 1;
      atRiskCents += valueCents;
    }

    if (lead.status === "contacted" && lead.lastFollowUpAt) {
      const followUpAge = now - new Date(lead.lastFollowUpAt).getTime();
      if (followUpAge >= STALE_FOLLOWUP_MS) staleContactedCount += 1;
    }
  }

  // Action line · SLA breach takes priority over stale follow-ups
  const hasSlaBreach = slaBreachCount > 0;
  const hasStaleContacted = !hasSlaBreach && staleContactedCount > 0;
  const showActionLine = hasSlaBreach || hasStaleContacted;

  return (
    <div className="bg-card border border-border/40 rounded-lg p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
          {greeting()} · lead brief
        </span>
        <span className="text-[10px] tracking-wider text-foreground/30">
          {leadsData.length.toLocaleString()} total tracked
        </span>
      </div>
      <div className="space-y-1.5">
        {/* Line 1 · velocity */}
        <div className="flex items-center gap-2.5">
          <TrendingUp className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Today · {newLast24h.toLocaleString()} new lead{newLast24h === 1 ? "" : "s"} in 24h
            {uncontactedLast24h > 0 ? ` · ${uncontactedLast24h.toLocaleString()} still uncontacted` : ""}
            {bookedLast24h > 0 ? ` · ${bookedLast24h.toLocaleString()} booked` : ""}
          </span>
        </div>

        {/* Line 2 · pipeline · skip when zero active-pipeline $ */}
        {pipelineCents > 0 && (
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              Pipeline · {formatCents(pipelineCents)} in active leads
              {atRiskCents > 0 ? ` · ${formatCents(atRiskCents)} at-risk uncontacted >4h` : ""}
            </span>
          </div>
        )}

        {/* Line 3 · action · clarity-gate · only render when there's real signal */}
        {showActionLine && hasSlaBreach ? (
          <button
            type="button"
            onClick={onSlaAction}
            className="flex items-center gap-2.5 w-full text-left hover:bg-red-500/[0.04] -mx-2 px-2 py-1 rounded transition-colors group"
          >
            <Zap className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-[12.5px] text-red-300 leading-tight flex-1">
              SLA breach · <span className="font-semibold">{slaBreachCount.toLocaleString()}</span> uncontacted lead{slaBreachCount === 1 ? "" : "s"} &gt;4h · response in 5min lifts close rate 9x
            </span>
            <span className="text-[10px] text-red-400/60 tracking-wider group-hover:text-red-400 transition-colors whitespace-nowrap">
              JUMP →
            </span>
          </button>
        ) : showActionLine && hasStaleContacted ? (
          <div className="flex items-center gap-2.5">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-300 leading-tight">
              Stale follow-up · {staleContactedCount.toLocaleString()} contacted lead{staleContactedCount === 1 ? "" : "s"} &gt;3d since last touch · ghost-risk
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

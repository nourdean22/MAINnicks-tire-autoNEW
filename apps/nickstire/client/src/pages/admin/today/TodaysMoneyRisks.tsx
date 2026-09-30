/**
 * TodaysMoneyRisks — "what needs attention before it costs us money today?"
 *
 * Sits between the Morning Brief / scoreboard and the NBA action queue on the
 * Today surface. Cash-register protection: surfaces stale uncontacted leads and
 * callbacks left waiting past the 4h SLA, the dollars exposed, and which surface
 * to clear first.
 *
 * DATA · self-queries `adminDashboard.overviewMediumBundle` — the SAME query
 * OverviewSection already runs every 30s, so React Query dedupes to a cache hit
 * (no extra network round-trip). Derivation lives in ./moneyRisks (pure, tested).
 *
 * CLARITY-GATE · renders nothing while loading, or when there is nothing at
 * risk (topItem === null) AND both the leads and callbacks slices were read.
 * No vanity empty card. A failed bundle read is not "nothing at risk": it
 * renders a one-line "status unknown, not clear" warning. The `$ at risk`
 * line shows only when leads carry a real estimate — never a fabricated figure.
 *
 * Q-23 phase 4 · every number wears MEASURED / ESTIMATE / UNMEASURED, and a
 * leads or callbacks slice the bundle could not read renders as UNMEASURED,
 * "unknown, not zero", instead of vanishing into a clean-looking card.
 */
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Clock, DollarSign, Users, PhoneCall, ChevronRight } from "lucide-react";
import { formatCents } from "../shared/format";
import { navigateToAdminSection } from "../shared";
import { ProvenanceTag } from "../shared/ProvenanceTag";
import { deriveMoneyRisks, displayedRiskSeverity, moneyRisksProvenance, unreadableRiskSlices } from "./moneyRisks";

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const SEVERITY_STYLE = {
  high: { border: "border-red-500/40", badge: "text-red-400 bg-red-500/10", icon: "text-red-400", label: "HIGH" },
  medium: { border: "border-amber-500/40", badge: "text-amber-400 bg-amber-500/10", icon: "text-amber-400", label: "MEDIUM" },
  low: { border: "border-border/40", badge: "text-foreground/50 bg-foreground/5", icon: "text-amber-400", label: "LOW" },
} as const;

export function TodaysMoneyRisks() {
  // Same query + cadence as OverviewSection → shared cache, no extra round-trip.
  const { data: bundle, isLoading, isError } = trpc.adminDashboard.overviewMediumBundle.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000,
  });

  if (isLoading) return null;
  // FAILURE is not EMPTY. Under the always-rendered "Money At Risk" header, a
  // null return on a failed bundle read looked identical to "nothing at risk".
  if (isError) {
    return (
      <div className="text-xs text-amber-300/80 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Could not read money-at-risk signals — status unknown, not clear.
      </div>
    );
  }
  if (!bundle) return null;

  const risks = deriveMoneyRisks(bundle.leads, bundle.callbacks, Date.now());
  // A failed slice arrives as null, which the derivation reads as empty. Say so.
  const unread = unreadableRiskSlices(bundle.slices);
  const anyUnread = unread.leads || unread.callbacks;
  const prov = moneyRisksProvenance();

  // Clarity-gate · nothing at risk AND everything was read → render nothing.
  // An unread slice is not "nothing at risk", so it keeps the card on screen.
  if (!anyUnread && (!risks.topItem || risks.totalRisks === 0)) return null;

  const style = SEVERITY_STYLE[displayedRiskSeverity(risks.severity, anyUnread)];
  const primaryIsLeads = risks.primary === "leads";
  // With a slice unread, the item count is a floor, not a total.
  const itemsWord = `${anyUnread ? "at least " : ""}${risks.totalRisks} unresolved item${risks.totalRisks === 1 ? "" : "s"}`;

  return (
    <div className={`bg-card border ${style.border} p-4 space-y-2.5`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/55">
          <AlertTriangle className={`w-3.5 h-3.5 ${style.icon}`} />
          {risks.totalRisks === 0
            ? "Money at risk: could not be read in full."
            : risks.atRiskCents > 0
              ? `Potential money at risk: ${formatCents(risks.atRiskCents)} across ${itemsWord}.`
              : `Potential money at risk across ${itemsWord}.`}
        </span>
        <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>
          {style.label}
        </span>
      </div>

      <div className="space-y-1.5">
        {risks.staleLeadCount > 0 && (
          <div className="flex items-center gap-2.5">
            <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              <span className="font-semibold">{risks.staleLeadCount.toLocaleString()}</span> stale lead{risks.staleLeadCount === 1 ? "" : "s"} &gt;4h uncontacted{" "}
              <ProvenanceTag provenance={prov.staleLeads} />
            </span>
          </div>
        )}

        {risks.callbacksWaitingCount > 0 && (
          <div className="flex items-center gap-2.5">
            <PhoneCall className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              <span className="font-semibold">{risks.callbacksWaitingCount.toLocaleString()}</span> callback{risks.callbacksWaitingCount === 1 ? "" : "s"} waiting &gt;4h{" "}
              <ProvenanceTag provenance={prov.callbacksWaiting} />
            </span>
          </div>
        )}

        {/* $ at risk · only when leads carry a real estimate (never fabricated). */}
        {risks.atRiskCents > 0 && (
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-[12.5px] text-red-300 leading-tight">
              <span className="font-semibold">{formatCents(risks.atRiskCents)}</span> quoted, at risk · 5-min response lifts close rate 9x{" "}
              <ProvenanceTag provenance={prov.atRisk} />
            </span>
          </div>
        )}

        {/* Q-23 phase 4 · a slice the bundle could not read. Unknown, not zero. */}
        {unread.leads && (
          <div className="flex items-center gap-2.5" data-unread="leads">
            <Users className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
            <span className="text-[12.5px] text-foreground/70 leading-tight">
              Stale leads could not be read · unknown, not zero <ProvenanceTag provenance={prov.unreadable} />
            </span>
          </div>
        )}
        {unread.callbacks && (
          <div className="flex items-center gap-2.5" data-unread="callbacks">
            <PhoneCall className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
            <span className="text-[12.5px] text-foreground/70 leading-tight">
              Waiting callbacks could not be read · unknown, not zero <ProvenanceTag provenance={prov.unreadable} />
            </span>
          </div>
        )}

        {/* The single oldest/most-urgent item. */}
        {risks.topItem && (
          <div className="flex items-center gap-2.5">
            <Clock className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
            <span className="text-[12px] text-foreground/60 leading-tight">
              Oldest · {risks.topItem.name} · {risks.topItem.kind === "lead" ? "lead" : "callback"} waiting {formatAge(risks.topItem.ageMs)}
            </span>
          </div>
        )}
      </div>

      {risks.topItem && (
        <button
          type="button"
          onClick={() => navigateToAdminSection(primaryIsLeads ? "leads" : "callTrackingView")}
          className="flex items-center gap-2 w-full text-left hover:bg-foreground/[0.03] -mx-2 px-2 py-1.5 rounded transition-colors group"
        >
          <span className="text-[12px] font-semibold text-primary leading-tight flex-1">
            Check {primaryIsLeads ? "Leads" : "Callbacks"} first
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-primary/60 group-hover:text-primary transition-colors" />
        </button>
      )}
    </div>
  );
}

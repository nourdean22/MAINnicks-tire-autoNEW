/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Now with: VIP badges, churn risk indicators, lifetime value sorting,
 * call buttons, total spent, days since last visit.
 */
import React, { useEffect, useState, lazy, Suspense } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { StatCard, PageHeader, LoadingState, EmptyState, SectionInsightStrip, TabBar, useUrlFilter, FilterChips, formatDate, openCustomerDrawer } from "./shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";

// Inferred from tRPC AppRouter — admin audit §3 follow-up.
type ListedCustomer = NonNullable<RouterOutputs["customers"]["list"]>["customers"][number];
type CustomerHistoryInvoice = NonNullable<RouterOutputs["customers"]["history"]>["invoices"][number];
type CustomerDeclinedEstimate = NonNullable<RouterOutputs["customers"]["history"]>["declinedEstimates"][number];
type CustomerOpenWorkOrder = NonNullable<RouterOutputs["customers"]["history"]>["openWorkOrders"][number];
type TimelineEvent = NonNullable<RouterOutputs["customers"]["timeline"]>[number];
import {
  Users, Search, ChevronLeft, ChevronRight, Phone, Mail,
  MapPin, Calendar, UserCheck, AlertTriangle, Building2,
  ArrowUpDown, Filter, Eye, X, Download, Send, CheckCircle2,
  MessageSquare, StickyNote, RefreshCw, Loader2, Crown,
  ShieldAlert, Clock, ChevronDown, ChevronUp, DollarSign,
  Car, ExternalLink, Hash, Wrench, FileWarning
} from "lucide-react";
import { toast } from "sonner";

const LoyaltyAdminSection = lazy(() => import("./LoyaltyAdminSection"));
const CouponsSection = lazy(() => import("./CouponsSection"));

type CustomerTab = "customers" | "loyalty" | "coupons";

type Segment = "all" | "recent" | "lapsed" | "unknown";
type SortBy = "name" | "visits" | "lastVisit" | "totalSpent";
type SortDir = "asc" | "desc";

// 2026-05-19 Elon-cut · SegmentBadge component + SEGMENT_CONFIG removed.
// StatusBadge (below) is the canonical badge — VIP / LOST / AT RISK.
// SegmentBadge added a 2nd badge per card with duplicate information
// (Recent/Lapsed/Unknown/New maps cleanly to the same axes StatusBadge
// already covers). Segment filtering still works via the `Segment` type.

/** VIP / At-Risk / Lost badge based on metrics */
function StatusBadge({ isVip, churnRisk, daysSinceLastVisit, totalVisits }: {
  isVip?: number | null;
  churnRisk?: string | null;
  daysSinceLastVisit?: number | null;
  totalVisits: number;
}) {
  // VIP: 3+ visits or explicitly flagged
  if (isVip || totalVisits >= 3) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <Crown className="w-2.5 h-2.5" /> VIP
      </span>
    );
  }
  // Lost: 365+ days
  if (daysSinceLastVisit && daysSinceLastVisit > 365) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
        <ShieldAlert className="w-2.5 h-2.5" /> LOST
      </span>
    );
  }
  // At Risk: 90-365 days or high churn
  if ((daysSinceLastVisit && daysSinceLastVisit > 90) || churnRisk === "high") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <AlertTriangle className="w-2.5 h-2.5" /> AT RISK
      </span>
    );
  }
  return null;
}

function daysSinceStr(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

// wave-181.x Customers Phase 1 · DELETED JOURNEY_ICONS const.
// Was an emoji-icon system parallel to the canonical Lucide icons in
// CustomerDrawer.EVENT_CONFIG · only used inside the now-deleted
// CustomerJourney component which was only mounted inside the
// now-deleted CustomerDetail modal. Triple-dead.

// wave-181.x Customers Phase 1 · DELETED 3 dead components below
// (CustomerJourney + CustomerDetail + InlineSms · ~390 lines).
// Why each:
//   · CustomerJourney  — emoji-icon timeline · only mounted inside
//     CustomerDetail · CustomerDrawer.EVENT_CONFIG is the canonical
//     timeline pattern.
//   · CustomerDetail   — 250-line full-screen fixed modal that did the
//     same job as CustomerDrawer (the surviving side-drawer pattern) ·
//     missing the wave-100 DECLINED + BACKLOG tiles that 360Panel has.
//   · InlineSms        — duplicate SMS popover · MessageCustomerLink
//     (the canonical pattern from the wave-181.x SMS-link migration)
//     handles all admin SMS now.
// All entry points migrated:
//   · Eye button → openCustomerDrawer(id)
//   · Row SMS button → <MessageCustomerLink>
// State `selectedId` removed from CustomersList.
// wave-181.x Customers Phase 1 · DELETED 3 dead components in one block:
//   CustomerJourney  (43 lines · emoji timeline · only used by CustomerDetail)
//   CustomerDetail   (250 lines · full-screen modal duplicating CustomerDrawer)
//   InlineSms        (74 lines · SMS popover duplicating MessageCustomerLink)
// Why · the wave-181.92 admin consolidation kept TWO detail patterns
// (full-screen modal + side drawer) for the same job. CustomerDrawer is
// the surviving one (richer · already wired to event-bus from anywhere ·
// includes the wave-100 DECLINED + BACKLOG tiles). MessageCustomerLink
// is the canonical SMS-link primitive from the wave-181.x click-to-
// message migration. JOURNEY_ICONS const was already deleted above.
// All call sites in this file migrated:
//   · Eye button setSelectedId(c.id) → openCustomerDrawer(c.id)
//   · Row InlineSms button           → <MessageCustomerLink>
//   · selectedId state               → removed (drawer manages its own)

/**
 * Wave-102: outbound follow-up call trigger.
 *
 * Operator clicks → fires the VAPI follow-up assistant at the customer.
 * Asks them how the work held up + asks for word-of-mouth referrals.
 * 3-minute hard cap.
 */
function FollowUpButton({ customerName, phone }: {
  customerName: string;
  phone: string;
}) {
  // wave-168: replaced native window.prompt() with an inline expandable input.
  // window.prompt() blocks the JS thread, is suppressed in iOS PWA standalone
  // mode (where Nour operates), and breaks the minimalist admin aesthetic.
  // Same class of native-primitive bug that wave-139 fixed for window.confirm().
  const [expanded, setExpanded] = useState(false);
  const [lastService, setLastService] = useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const mutation = trpc.vapi.makeFollowUpCall.useMutation({
    onSuccess: (result) => {
      if (result.success && result.callId) {
        toast.success(`Follow-up call queued (${result.callId.slice(0, 8)}...). Nick is dialing now.`);
        setExpanded(false);
        setLastService("");
      } else {
        toast.error(`Follow-up failed: ${result.error || "unknown error"}`);
      }
    },
    onError: (err) => toast.error(`Follow-up failed: ${err.message}`),
  });

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const triggerCall = () => {
    mutation.mutate({
      customerName,
      phone,
      lastService: lastService.trim() || "recent visit",
    });
  };

  if (expanded) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={lastService}
          onChange={(e) => setLastService(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") triggerCall();
            if (e.key === "Escape") { setExpanded(false); setLastService(""); }
          }}
          placeholder='Service (e.g. "tires", or blank)'
          aria-label={`Last service for ${customerName.split(" ")[0]} follow-up call`}
          className="px-2 py-1 bg-card border border-emerald-500/30 text-foreground text-[10px] tracking-wider placeholder:text-foreground/30 focus:outline-none focus:border-emerald-400 w-44"
        />
        <button
          onClick={triggerCall}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] tracking-wider hover:bg-emerald-500/25 disabled:opacity-50"
          aria-label="Trigger follow-up call now"
        >
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Phone className="w-3 h-3" aria-hidden="true" />}
          CALL
        </button>
        <button
          onClick={() => { setExpanded(false); setLastService(""); }}
          className="px-2 py-1 text-foreground/40 hover:text-foreground/70 text-[10px]"
          aria-label="Cancel follow-up"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setExpanded(true);
      }}
      disabled={mutation.isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
      title="Trigger Nick's follow-up call (3 min, asks for referrals)"
    >
      {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
      FOLLOW UP
    </button>
  );
}

/** Customer 360 expandable detail panel — lazy-loaded service history.
 *  wave-181.x Customers Phase 1 · removed unused onSmsClick prop ·
 *  was declared but never invoked inside the panel · only existed to
 *  wire setSelectedId on the now-deleted CustomerDetail modal. */
function Customer360Panel({ customer }: {
  customer: ListedCustomer;
}) {
  const { data: historyData, isLoading: historyLoading } = trpc.customers.history.useQuery(
    { phone: customer.phone },
    { enabled: !!customer.phone }
  );

  const daysAgo = customer.daysSinceLastVisit ?? (customer.lastVisitDate
    ? Math.floor((Date.now() - new Date(customer.lastVisitDate).getTime()) / 86400000)
    : null);
  const avgTicket = customer.totalVisits > 0 ? Math.round(customer.totalSpent / customer.totalVisits / 100) : 0;
  const memberSince = customer.firstVisitDate
    ? new Date(customer.firstVisitDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : customer.createdAt
      ? new Date(customer.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "Unknown";

  // Risk assessment
  const getRiskAssessment = () => {
    if (customer.totalVisits >= 3 && customer.totalSpent > 200000) {
      return { label: "VIP CUSTOMER", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" };
    }
    if (daysAgo && daysAgo > 60) {
      return { label: `AT RISK -- ${daysAgo} days since last visit`, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" };
    }
    if (customer.totalVisits === 1) {
      return { label: "NEW -- first visit", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" };
    }
    if (customer.totalVisits >= 2) {
      return { label: "LOYAL CUSTOMER", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
    }
    return null;
  };
  const risk = getRiskAssessment();

  // 2026-05-19 Elon-cut · getSegmentLabel removed (parallel badge system
  // to StatusBadge). Header now uses StatusBadge as the single source of
  // truth. Customers who don't fit VIP / LOST / AT-RISK render no badge —
  // cleaner than rendering a generic "UNKNOWN" badge on every other card.

  return (
    <tr>
      <td colSpan={10} className="p-0">
        <div className="bg-background/50 border-t border-b border-primary/10 px-4 py-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-foreground tracking-tight">
                    {customer.firstName} {customer.lastName || ""}
                  </span>
                  <StatusBadge
                    isVip={customer.isVip}
                    churnRisk={customer.churnRisk}
                    daysSinceLastVisit={daysAgo}
                    totalVisits={customer.totalVisits}
                  />
                </div>
                <span className="text-[10px] text-foreground/40 tracking-wider">
                  Member since {memberSince}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {customer.phone && (
                <>
                  <a
                    href={`tel:${customer.phone}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    <Phone className="w-3 h-3" /> CALL
                  </a>
                  <MessageCustomerLink
                    phone={customer.phone}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                    onClick={() => { /* parent row click is suppressed via Link's own handler chain */ }}
                  >
                    <MessageSquare className="w-3 h-3" /> SMS
                  </MessageCustomerLink>
                </>
              )}
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <Mail className="w-3 h-3" /> EMAIL
                </a>
              )}
              {customer.alsCustomerId && (
                <a
                  href={`https://shopdriver.algauto.com/customers/${customer.alsCustomerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-purple-400 hover:border-purple-400/30 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" /> ALG
                </a>
              )}
              {customer.phone && (
                <FollowUpButton
                  customerName={`${customer.firstName} ${customer.lastName || ""}`.trim()}
                  phone={customer.phone}
                />
              )}
            </div>
          </div>

          {/* Contact Info */}
          <div className="flex items-center gap-4 text-[11px] text-foreground/50 flex-wrap">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-1 hover:text-primary" onClick={e => e.stopPropagation()}>
                <Phone className="w-3 h-3" /> {customer.phone}
              </a>
            )}
            {customer.phone2 && (
              <a href={`tel:${customer.phone2}`} className="flex items-center gap-1 hover:text-primary" onClick={e => e.stopPropagation()}>
                <Phone className="w-3 h-3" /> {customer.phone2}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-1 hover:text-primary" onClick={e => e.stopPropagation()}>
                <Mail className="w-3 h-3" /> {customer.email}
              </a>
            )}
            {(customer.city || customer.address) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ")}
              </span>
            )}
          </div>

          {/* Stats Row — 6 cards (added DECLINED + BACKLOG aggregates) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-card border border-border/20 p-3">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">TOTAL SPENT</span>
              <span className={`font-bold text-xl ${customer.totalSpent > 0 ? "text-emerald-400" : "text-foreground/30"}`}>
                {customer.totalSpent > 0 ? `$${Math.round(customer.totalSpent / 100).toLocaleString()}` : "--"}
              </span>
            </div>
            <div className="bg-card border border-border/20 p-3">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">TOTAL VISITS</span>
              <span className="font-bold text-xl text-foreground">
                {customer.totalVisits || 0}
              </span>
            </div>
            <div className="bg-card border border-border/20 p-3">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">AVG TICKET</span>
              <span className={`font-bold text-xl ${avgTicket > 0 ? "text-blue-400" : "text-foreground/30"}`}>
                {avgTicket > 0 ? `$${avgTicket.toLocaleString()}` : "--"}
              </span>
            </div>
            <div className="bg-card border border-border/20 p-3">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">DAYS SINCE VISIT</span>
              <span className={`font-bold text-xl ${
                daysAgo == null ? "text-foreground/30" :
                daysAgo > 180 ? "text-red-400" :
                daysAgo > 90 ? "text-amber-400" : "text-foreground"
              }`}>
                {daysAgo != null ? daysAgo : "--"}
              </span>
            </div>
            {/* DECLINED — recovery opportunity */}
            <div className={`bg-card border p-3 ${customer.declinedValue > 0 ? "border-amber-500/30" : "border-border/20"}`}>
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">
                <FileWarning className="w-3 h-3 inline mr-1" />DECLINED
              </span>
              {customer.declinedValue > 0 ? (
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-xl text-amber-400">
                    ${Math.round(customer.declinedValue / 100).toLocaleString()}
                  </span>
                  <span className="text-[9px] text-foreground/40 tracking-wider">{customer.declinedCount} EST</span>
                </div>
              ) : (
                <span className="font-bold text-xl text-foreground/30">--</span>
              )}
            </div>
            {/* BACKLOG — open work orders */}
            <div className={`bg-card border p-3 ${customer.backlogValueCents > 0 ? "border-blue-500/30" : "border-border/20"}`}>
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1">
                <Wrench className="w-3 h-3 inline mr-1" />BACKLOG
              </span>
              {customer.backlogValueCents > 0 ? (
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-xl text-blue-400">
                    ${Math.round(customer.backlogValueCents / 100).toLocaleString()}
                  </span>
                  <span className="text-[9px] text-foreground/40 tracking-wider">{customer.backlogCount} OPEN</span>
                </div>
              ) : (
                <span className="font-bold text-xl text-foreground/30">--</span>
              )}
            </div>
          </div>

          {/* Vehicle + Risk in a 2-col layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Vehicle Info */}
            <div className="bg-card border border-border/20 p-3">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1.5">
                <Car className="w-3 h-3 inline mr-1" />VEHICLE
              </span>
              {customer.vehicleMake ? (
                <span className="text-sm text-foreground">
                  {[customer.vehicleYear, customer.vehicleMake, customer.vehicleModel].filter(Boolean).join(" ")}
                </span>
              ) : (
                <span className="text-xs text-foreground/30 italic">No vehicle on file</span>
              )}
            </div>

            {/* Risk Assessment */}
            {risk && (
              <div className={`${risk.bg} border ${risk.border} p-3`}>
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1.5">RISK ASSESSMENT</span>
                <span className={`text-sm font-bold ${risk.color}`}>
                  {risk.label}
                </span>
              </div>
            )}
          </div>

          {/* Service History */}
          <div className="bg-card border border-border/20 p-3">
            <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-2">
              <Hash className="w-3 h-3 inline mr-1" />SERVICE HISTORY (LAST 10)
            </span>
            {historyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </div>
            ) : !historyData?.invoices?.length ? (
              <p className="text-xs text-foreground/30 italic py-2">No invoices found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/20">
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">DATE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">INV #</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">SERVICE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">VEHICLE</th>
                      <th className="text-right py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">AMOUNT</th>
                      <th className="text-left py-1.5 text-[9px] text-foreground/40 tracking-wider">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.invoices.map((inv: CustomerHistoryInvoice) => (
                      <tr key={inv.id} className="border-b border-border/10">
                        <td className="py-1.5 pr-3 text-foreground/50 whitespace-nowrap">
                          {formatDate(inv.invoiceDate)}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/60 font-mono">
                          {inv.invoiceNumber || `#${inv.id}`}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/70 max-w-[200px] truncate">
                          {inv.serviceDescription || "--"}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/50 max-w-[120px] truncate">
                          {inv.vehicleInfo || "--"}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-emerald-400 whitespace-nowrap">
                          ${Math.round(inv.totalAmount / 100).toLocaleString()}
                        </td>
                        <td className="py-1.5">
                          <span className={`text-[9px] tracking-wider font-bold px-1.5 py-0.5 ${
                            inv.paymentStatus === "paid" ? "text-emerald-400 bg-emerald-500/10" :
                            inv.paymentStatus === "pending" ? "text-amber-400 bg-amber-500/10" :
                            inv.paymentStatus === "partial" ? "text-blue-400 bg-blue-500/10" :
                            "text-red-400 bg-red-500/10"
                          }`}>
                            {(inv.paymentStatus || "unknown").toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* DECLINED WORK — unmatched ALG estimates (recovery opportunities) */}
          {historyData?.declinedEstimates && historyData.declinedEstimates.length > 0 && (
            <div className="bg-card border border-amber-500/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[9px] text-amber-400 tracking-wider">
                  <FileWarning className="w-3 h-3 inline mr-1" />
                  DECLINED WORK — RECOVERY OPPORTUNITIES ({historyData.declinedEstimates.length})
                </span>
                <span className="font-mono text-[10px] text-amber-400">
                  ${Math.round(historyData.declinedEstimates.reduce((sum: number, e: CustomerDeclinedEstimate) => sum + e.estimatedAmount, 0) / 100).toLocaleString()} total
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-amber-500/10">
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">DATE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">EST #</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">SERVICE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">VEHICLE</th>
                      <th className="text-right py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">QUOTED</th>
                      <th className="text-left py-1.5 text-[9px] text-foreground/40 tracking-wider">FOLLOW-UP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.declinedEstimates.map((est: CustomerDeclinedEstimate) => (
                      <tr key={est.id} className="border-b border-amber-500/5">
                        <td className="py-1.5 pr-3 text-foreground/50 whitespace-nowrap">
                          {formatDate(est.estimateDate)}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/60 font-mono">
                          {est.externalId}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/70 max-w-[200px] truncate">
                          {est.serviceDescription || "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/50 max-w-[120px] truncate">
                          {est.vehicleInfo || "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-amber-400 whitespace-nowrap">
                          ${Math.round(est.estimatedAmount / 100).toLocaleString()}
                        </td>
                        <td className="py-1.5">
                          {est.followUp30dSent ? (
                            <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-foreground/40 bg-foreground/5">30D SENT</span>
                          ) : est.followUp7dSent ? (
                            <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-blue-400 bg-blue-500/10">7D SENT</span>
                          ) : (
                            <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-red-400 bg-red-500/10">PENDING</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ACTIVE BACKLOG — open work orders */}
          {historyData?.openWorkOrders && historyData.openWorkOrders.length > 0 && (
            <div className="bg-card border border-blue-500/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[9px] text-blue-400 tracking-wider">
                  <Wrench className="w-3 h-3 inline mr-1" />
                  ACTIVE BACKLOG — OPEN WORK ORDERS ({historyData.openWorkOrders.length})
                </span>
                <span className="font-mono text-[10px] text-blue-400">
                  ${Math.round(historyData.openWorkOrders.reduce((sum: number, w: CustomerOpenWorkOrder) => sum + (w.total ? Number(w.total) : 0), 0)).toLocaleString()} total
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-blue-500/10">
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">CREATED</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">WO #</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">SERVICE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">VEHICLE</th>
                      <th className="text-left py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">PROMISED</th>
                      <th className="text-right py-1.5 pr-3 text-[9px] text-foreground/40 tracking-wider">QUOTED</th>
                      <th className="text-left py-1.5 text-[9px] text-foreground/40 tracking-wider">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.openWorkOrders.map((wo: CustomerOpenWorkOrder) => (
                      <tr key={wo.id} className="border-b border-blue-500/5">
                        <td className="py-1.5 pr-3 text-foreground/50 whitespace-nowrap">
                          {formatDate(wo.createdAt)}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/60 font-mono">
                          {wo.orderNumber}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/70 max-w-[200px] truncate">
                          {wo.serviceDescription || "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/50 max-w-[120px] truncate">
                          {[wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/50 whitespace-nowrap text-[10px]">
                          {formatDate(wo.promisedAt)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-blue-400 whitespace-nowrap">
                          {wo.total ? `$${Math.round(Number(wo.total)).toLocaleString()}` : "—"}
                        </td>
                        <td className="py-1.5">
                          <span className="text-[9px] tracking-wider font-bold px-1.5 py-0.5 text-blue-400 bg-blue-500/10">
                            {(wo.status || "draft").replace(/_/g, " ").toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

type SortByExt = "name" | "visits" | "lastVisit" | "totalSpent" | "firstVisit" | "created" | "declined" | "backlog";

// wave-181.27 · format relative age for the metrics-freshness badge.
// Returns "computed Xm ago" / "Xh ago" / "Xd ago" — short form for chip.
function formatMetricsAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "computed —";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `computed ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `computed ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `computed ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `computed ${day}d ago`;
}

export default function CustomersSection() {
  // URL-persistent tab state (matches Settings pattern via ?customersTab=...)
  const [activeTab, setActiveTab] = useState<CustomerTab>(() => {
    if (typeof window === "undefined") return "customers";
    const raw = new URLSearchParams(window.location.search).get("customersTab");
    return raw === "loyalty" || raw === "coupons" ? raw : "customers";
  });

  // Keep URL in sync when tab changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeTab === "customers") url.searchParams.delete("customersTab");
    else url.searchParams.set("customersTab", activeTab);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Loyalty · coupons · customer drawer · spend tiers · churn risk"
        icon={<UserCheck className="w-5 h-5" />}
      />
      <SectionInsightStrip section="customers" />
      <TabBar
        tabs={[
          { id: "customers", label: "Customers", icon: <Users className="w-3.5 h-3.5" /> },
          { id: "loyalty", label: "Loyalty", icon: <Crown className="w-3.5 h-3.5" /> },
          { id: "coupons", label: "Coupons", icon: <Hash className="w-3.5 h-3.5" /> },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "loyalty" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <LoyaltyAdminSection />
        </Suspense>
      )}
      {activeTab === "coupons" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <CouponsSection />
        </Suspense>
      )}
      {activeTab === "customers" && <CustomersList />}
    </div>
  );
}

function CustomersList() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  // URL-persistent ?seg=recent|lapsed|unknown (default all not in URL)
  const [segment, setSegment] = useUrlFilter<Segment>(
    "seg", "all",
    { validate: (v) => (["all", "recent", "lapsed", "unknown"].includes(v) ? (v as Segment) : null) },
  );
  const [sortBy, setSortBy] = useState<SortByExt>("totalSpent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  // wave-181.x Customers Phase 1 · removed selectedId state · was only
  // used to drive the deleted CustomerDetail modal. Detail view now
  // uses openCustomerDrawer (the surviving side-drawer pattern) which
  // manages its own state via the event bus.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pageSize = 25;
  const [exporting, setExporting] = useState(false);
  const [minVisits, setMinVisits] = useState<number | undefined>();
  const [lastVisitDays, setLastVisitDays] = useState<number | undefined>();
  const [hasDeclined, setHasDeclined] = useState(false);
  const [hasBacklog, setHasBacklog] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { data: stats } = trpc.customers.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: listData, isLoading } = trpc.customers.list.useQuery({
    page,
    pageSize,
    search: search || undefined,
    segment,
    sortBy,
    sortDir,
    minVisits,
    lastVisitDays,
    hasDeclined: hasDeclined || undefined,
    hasBacklog: hasBacklog || undefined,
  }, { refetchInterval: 30000 });

  const enrichMutation = trpc.customers.enrich.useMutation({
    onSuccess: (result) => {
      toast.success(`Enriched: ${result.enrichment.details}`);
      utils.customers.list.invalidate();
      utils.customers.stats.invalidate();
    },
    onError: () => toast.error("Enrichment failed"),
  });

  // Wave-100: manual refresh of materialized declined+backlog aggregates.
  // Login auto-fires this — button is for operator's "the numbers look
  // stale, force a recompute" moments. Local DB only, no ALG hit.
  const refreshMetricsMutation = trpc.customers.refreshMetrics.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Recomputed ${result.customersUpdated} customer aggregates · ${result.durationMs}ms`);
        utils.customers.list.invalidate();
        utils.customers.metricsFreshness.invalidate();
      } else {
        toast.error("Metrics refresh failed");
      }
    },
    onError: () => toast.error("Metrics refresh failed"),
  });

  // wave-181.27 · materialized-metrics freshness probe. Refetches
  // every minute so the "computed Xm ago" badge tracks the table
  // state without forcing a manual reload. Auto-invalidated above
  // when the Recompute button succeeds.
  const { data: freshness } = trpc.customers.metricsFreshness.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const retryCampaign = trpc.customers.retryCampaign.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} texts (${result.failed} failed). ${result.remaining} remaining.`);
      utils.customers.campaignStats.invalidate();
    },
    onError: () => toast.error("Campaign retry failed"),
  });

  const totalPages = Math.ceil((listData?.total ?? 0) / pageSize);

  function toggleSort(col: SortByExt) {
    if (sortBy === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Stats Row — wave-127 — clickable filters. 6/8 wire to existing
          server-side filter state (segment + minVisits + sortBy). With Email
          and Commercial stay display-only because the server query has no
          column filter for those — wiring them would require API scope creep. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard
          label="Total Customers"
          value={stats?.total ?? 0}
          icon={<Users className="w-4 h-4" />}
          color="text-foreground"
          onClick={() => {
            setSegment("all");
            setMinVisits(undefined);
            setLastVisitDays(undefined);
            setHasDeclined(false);
            setHasBacklog(false);
            setPage(1);
          }}
        />
        <StatCard
          label="With Visits"
          value={stats?.withVisits ?? 0}
          icon={<UserCheck className="w-4 h-4" />}
          color="text-emerald-400"
          onClick={() => { setSegment("all"); setMinVisits(1); setPage(1); }}
        />
        <StatCard
          label="VIP (3+)"
          value={stats?.vipCount ?? 0}
          icon={<Crown className="w-4 h-4" />}
          color="text-amber-400"
          onClick={() => { setSegment("all"); setMinVisits(3); setSortBy("visits"); setSortDir("desc"); setPage(1); }}
        />
        <StatCard
          label="Total Revenue"
          value={`$${Math.round((stats?.totalRevenue ?? 0) / 100).toLocaleString()}`}
          icon={<span className="text-[14px]">💰</span>}
          color="text-emerald-400"
          onClick={() => { setSegment("all"); setSortBy("totalSpent"); setSortDir("desc"); setPage(1); }}
        />
        <StatCard
          label="Recent"
          value={stats?.recent ?? 0}
          icon={<UserCheck className="w-4 h-4" />}
          color="text-emerald-400"
          onClick={() => { setSegment("recent"); setPage(1); }}
        />
        <StatCard
          label="Lapsed"
          value={stats?.lapsed ?? 0}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="text-amber-400"
          onClick={() => { setSegment("lapsed"); setPage(1); }}
        />
        <StatCard label="With Email" value={stats?.withEmail ?? 0} icon={<Mail className="w-4 h-4" />} color="text-blue-400" />
        {/* wave-181.x bug-fix · was text-purple-400 · purple was DELETED
            from canonical 3-signal palette in wave-181.92. Now uses
            text-foreground/60 (neutral). */}
        <StatCard label="Commercial" value={stats?.commercial ?? 0} icon={<Building2 className="w-4 h-4" />} color="text-foreground/60" />
      </div>

      {/* Campaign Progress + Retry + Export */}
      <div className="flex flex-col sm:flex-row gap-3">
        {campaignStats && (
          <div className="flex-1 bg-card border border-border/30 p-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              <span className="text-[12px] text-foreground/60 tracking-wider">SMS:</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[12px]">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">{campaignStats.sent}</span>
                <span className="text-foreground/30">sent</span>
              </span>
              <span className="flex items-center gap-1 text-[12px]">
                <span className="text-amber-400">{campaignStats.remaining}</span>
                <span className="text-foreground/30">left</span>
              </span>
            </div>
            {campaignStats.total > 0 && (
              <div className="flex-1 bg-foreground/5 h-2 hidden sm:block">
                <div className="bg-primary h-2 transition-all" style={{ width: `${Math.round((campaignStats.sent / campaignStats.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {campaignStats && campaignStats.remaining > 0 && (
          <button
            onClick={async () => {
              // wave-139 — was native confirm(); now ConfirmDialog
              const ok = await confirmDialog({
                title: "Send next batch?",
                message: "Send texts to the next 50 queued customers.",
                confirmLabel: "Send 50",
              });
              if (!ok) return;
              retryCampaign.mutate({ batchSize: 50 });
            }}
            disabled={retryCampaign.isPending}
            className="flex items-center gap-2 bg-primary/10 border border-primary/30 px-4 py-2.5 text-sm text-primary hover:bg-primary/20 transition-colors whitespace-nowrap disabled:opacity-50 rounded-md"
          >
            {retryCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {retryCampaign.isPending ? "Sending..." : "Send Next 50"}
          </button>
        )}

        <button
          onClick={async () => {
            // v1.7 audit follow-up · was raw fetch() of the manually-
            // constructed tRPC URL + hand-unwrapped envelope. Bypassed
            // type-safety, the auth interceptor, and the error
            // transformer; a session expiring mid-export returned 401
            // inside an envelope that was silently swallowed into
            // "Export failed" with no re-auth flow. Now uses the
            // typed tRPC client via utils.fetch.
            setExporting(true);
            try {
              const data = await utils.customers.exportCsv.fetch({ segment });
              if (!data?.csv) { toast.error("Export failed"); return; }
              const blob = new Blob([data.csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `customers-${segment}-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`Exported ${data.count ?? 0} customers`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Export failed");
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting}
          className="flex items-center gap-2 bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              placeholder="Search name, phone, email, city, vehicle..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-card border border-border/30 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-foreground/30" />
            {(["all", "recent", "lapsed", "new", "unknown"] as Segment[]).map(s => (
              <button
                key={s}
                onClick={() => { setSegment(s); setPage(1); }}
                className={`px-3 py-1.5 text-xs tracking-wide transition-colors ${
                  segment === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/30 text-foreground/50 hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`px-3 py-1.5 text-xs tracking-wide transition-colors ${showFilters ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/50 hover:text-foreground"}`}
          >
            Advanced
          </button>
          <button
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide bg-card border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 whitespace-nowrap"
          >
            {enrichMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Sync Data
          </button>
          <button
            onClick={() => refreshMetricsMutation.mutate()}
            disabled={refreshMetricsMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide bg-card border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 whitespace-nowrap"
            title={
              freshness?.lastComputedAt
                ? `Last recomputed ${freshness.lastComputedAt} · ${freshness.rowCount} rows. Click to force a fresh DB scan (no ALG fetch).`
                : "Recompute declined-work + backlog totals from local DB. No ALG fetch. Auto-runs on login."
            }
          >
            {refreshMetricsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Recompute
          </button>
          {/* wave-181.27 · freshness badge — shows when the materialized
              customer_metrics aggregates were last computed. If the
              numbers look wrong, the operator first checks this badge
              to know whether to recompute or look deeper. */}
          {freshness?.lastComputedAt && (
            <span
              className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] font-medium text-foreground/45 bg-card/50 border border-border/25 whitespace-nowrap"
              title={`Materialized aggregates last computed at ${freshness.lastComputedAt} (${freshness.rowCount} rows)`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
              {formatMetricsAge(freshness.lastComputedAt)}
            </span>
          )}
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 bg-card border border-border/30 p-3">
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">LAST VISIT WITHIN</label>
              <select
                value={lastVisitDays ?? ""}
                onChange={e => { setLastVisitDays(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="">Any time</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">6 months</option>
                <option value="365">1 year</option>
                <option value="730">2 years</option>
                <option value="1095">3 years</option>
                <option value="1825">5 years</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">MIN VISITS</label>
              <select
                value={minVisits ?? ""}
                onChange={e => { setMinVisits(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="">Any</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+ (VIP)</option>
                <option value="5">5+</option>
                <option value="10">10+</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">SORT BY</label>
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value as SortByExt); setPage(1); }}
                className="bg-background border border-border/30 px-3 py-1.5 text-xs text-foreground"
              >
                <option value="totalSpent">Total Spent</option>
                <option value="visits">Visit Count</option>
                <option value="lastVisit">Last Visit</option>
                <option value="firstVisit">First Visit</option>
                <option value="declined">Declined Value</option>
                <option value="backlog">Backlog Value</option>
                <option value="name">Name</option>
                <option value="created">Date Added</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-foreground/40 tracking-wider block mb-1">RECOVERY / BACKLOG</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { setHasDeclined(!hasDeclined); setPage(1); }}
                  className={`px-3 py-1.5 text-[10px] tracking-wider transition-colors flex items-center gap-1 ${hasDeclined ? "bg-amber-500/10 text-amber-400 border border-amber-500/30" : "bg-background border border-border/30 text-foreground/50 hover:text-foreground"}`}
                  title="Show only customers with unmatched ALG estimates"
                >
                  <FileWarning className="w-3 h-3" /> HAS DECLINED
                </button>
                <button
                  onClick={() => { setHasBacklog(!hasBacklog); setPage(1); }}
                  className={`px-3 py-1.5 text-[10px] tracking-wider transition-colors flex items-center gap-1 ${hasBacklog ? "bg-blue-500/10 text-blue-400 border border-blue-500/30" : "bg-background border border-border/30 text-foreground/50 hover:text-foreground"}`}
                  title="Show only customers with open work orders"
                >
                  <Wrench className="w-3 h-3" /> HAS BACKLOG
                </button>
              </div>
            </div>
            {(minVisits || lastVisitDays || hasDeclined || hasBacklog) && (
              <button
                onClick={() => { setMinVisits(undefined); setLastVisitDays(undefined); setHasDeclined(false); setHasBacklog(false); setPage(1); }}
                className="self-end px-3 py-1.5 text-xs text-red-400 hover:text-red-300 tracking-wider"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Active Filter Chips — auto-hides when nothing's active */}
        <FilterChips
          chips={[
            { label: "Search", value: search, default: "", onClear: () => { setSearch(""); setPage(1); } },
            { label: "Segment", value: segment, default: "all", onClear: () => { setSegment("all"); setPage(1); } },
            { label: "Min Visits", value: minVisits ? String(minVisits) : "", default: "", onClear: () => { setMinVisits(undefined); setPage(1); }, displayValue: minVisits ? `${minVisits}+` : undefined },
            { label: "Last Visit", value: lastVisitDays ? String(lastVisitDays) : "", default: "", onClear: () => { setLastVisitDays(undefined); setPage(1); }, displayValue: lastVisitDays ? `≤${lastVisitDays}d` : undefined },
            { label: "Has Declined", value: hasDeclined ? "1" : "", default: "", onClear: () => { setHasDeclined(false); setPage(1); }, displayValue: hasDeclined ? "ALG est unmatched" : undefined },
            { label: "Has Backlog", value: hasBacklog ? "1" : "", default: "", onClear: () => { setHasBacklog(false); setPage(1); }, displayValue: hasBacklog ? "Open WOs" : undefined },
            { label: "Sort", value: sortBy, default: "totalSpent", onClear: () => { setSortBy("totalSpent"); setPage(1); }, displayValue: sortBy === "totalSpent" ? undefined : sortBy },
          ]}
          onClearAll={() => {
            setSearch("");
            setSegment("all");
            setMinVisits(undefined);
            setLastVisitDays(undefined);
            setHasDeclined(false);
            setHasBacklog(false);
            setSortBy("totalSpent");
            setSortDir("desc");
            setPage(1);
          }}
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border/30 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground/60">
                  Name <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Phone</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden lg:table-cell">Status</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("totalSpent")} className="flex items-center gap-1 hover:text-foreground/60">
                  Spent <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">
                <button onClick={() => toggleSort("visits")} className="flex items-center gap-1 hover:text-foreground/60">
                  Visits <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell" title="Unmatched ALG estimates — recovery opportunities">
                <button onClick={() => toggleSort("declined")} className="flex items-center gap-1 hover:text-foreground/60">
                  <FileWarning className="w-3 h-3" /> Declined <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden lg:table-cell" title="Open work orders — current backlog">
                <button onClick={() => toggleSort("backlog")} className="flex items-center gap-1 hover:text-foreground/60">
                  <Wrench className="w-3 h-3" /> Backlog <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell">Vehicle</th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden sm:table-cell">
                <button onClick={() => toggleSort("lastVisit")} className="flex items-center gap-1 hover:text-foreground/60">
                  Last Service <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-foreground/30">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : listData?.customers.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-foreground/30 text-[12px]">
                  No customers found
                </td>
              </tr>
            ) : (
              listData?.customers.map((c: ListedCustomer) => {
                const daysAgo = c.daysSinceLastVisit ?? (c.lastVisitDate ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000) : null);
                const isExpanded = expandedId === c.id;
                return (
                  <React.Fragment key={c.id}>
                  <tr
                    className={`border-b border-border/10 hover:bg-foreground/[0.02] transition-colors cursor-pointer ${isExpanded ? "bg-foreground/[0.03]" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  >
                    {/* Name + badges */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-primary shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
                        }
                        <span className="text-foreground font-medium">{c.firstName} {c.lastName || ""}</span>
                        {c.customerType === "commercial" && <Building2 className="w-3 h-3 text-foreground/50" />}
                        {c.notes && <span title="Has notes"><StickyNote className="w-3 h-3 text-amber-400/60" /></span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                        <StatusBadge isVip={c.isVip} churnRisk={c.churnRisk} daysSinceLastVisit={daysAgo} totalVisits={c.totalVisits} />
                      </div>
                    </td>

                    {/* Phone with Call button */}
                    <td className="p-3">
                      <a
                        href={`tel:${c.phone}`}
                        className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-primary transition-colors text-[12px] group"
                        title="Tap to call"
                        onClick={e => e.stopPropagation()}
                      >
                        <Phone className="w-3 h-3 text-primary group-hover:text-primary" />
                        {c.phone}
                      </a>
                    </td>

                    {/* Status */}
                    <td className="p-3 hidden lg:table-cell">
                      {c.churnRisk === "high" ? (
                        <span className="text-red-400 text-[10px] tracking-wider">HIGH RISK</span>
                      ) : c.churnRisk === "medium" ? (
                        <span className="text-amber-400 text-[10px] tracking-wider">MEDIUM</span>
                      ) : (
                        <span className="text-emerald-400 text-[10px] tracking-wider">HEALTHY</span>
                      )}
                    </td>

                    {/* Total Spent */}
                    <td className="p-3">
                      <span className={`font-mono text-[12px] ${c.totalSpent > 0 ? "text-emerald-400" : "text-foreground/30"}`}>
                        {c.totalSpent > 0 ? `$${Math.round(c.totalSpent / 100).toLocaleString()}` : "\u2014"}
                      </span>
                    </td>

                    {/* Visits */}
                    <td className="p-3">
                      <span className={c.totalVisits > 0 ? "text-foreground" : "text-foreground/30"}>
                        {c.totalVisits || "\u2014"}
                      </span>
                    </td>

                    {/* Declined work (ALG unmatched estimates) */}
                    <td className="p-3 hidden md:table-cell" title={c.declinedCount ? `${c.declinedCount} ALG estimate${c.declinedCount === 1 ? "" : "s"} never converted` : "No declined work"}>
                      {c.declinedValue > 0 ? (
                        <div className="flex flex-col">
                          <span className="font-mono text-[12px] text-amber-400">
                            ${Math.round(c.declinedValue / 100).toLocaleString()}
                          </span>
                          <span className="text-[9px] text-foreground/40 tracking-wider">
                            {c.declinedCount} EST
                          </span>
                        </div>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Active backlog (open work orders) */}
                    <td className="p-3 hidden lg:table-cell" title={c.backlogCount ? `${c.backlogCount} open work order${c.backlogCount === 1 ? "" : "s"}` : "No active backlog"}>
                      {c.backlogValueCents > 0 ? (
                        <div className="flex flex-col">
                          <span className="font-mono text-[12px] text-blue-400">
                            ${Math.round(c.backlogValueCents / 100).toLocaleString()}
                          </span>
                          <span className="text-[9px] text-foreground/40 tracking-wider">
                            {c.backlogCount} OPEN
                          </span>
                        </div>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Vehicle */}
                    <td className="p-3 hidden md:table-cell">
                      {c.vehicleMake ? (
                        <span className="text-[11px] text-foreground/50">
                          {[c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ")}
                        </span>
                      ) : (
                        <span className="text-foreground/20 text-[11px]">{"\u2014"}</span>
                      )}
                    </td>

                    {/* Last Service */}
                    <td className="p-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-foreground/30" />
                        <span className={`text-xs ${daysAgo && daysAgo > 180 ? "text-red-400" : daysAgo && daysAgo > 90 ? "text-amber-400" : "text-foreground/50"}`}>
                          {daysSinceStr(daysAgo)}
                        </span>
                      </div>
                    </td>

                    {/* wave-181.x Customers Phase 1 · Actions simplified.
                        WAS: InlineSms (74-line duplicate) + Eye → CustomerDetail
                             modal (250-line stale duplicate of CustomerDrawer).
                        NOW: MessageCustomerLink (canonical SMS entry) + Eye →
                             openCustomerDrawer (the surviving detail pattern). */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 relative" onClick={e => e.stopPropagation()}>
                        {c.phone && (
                          <MessageCustomerLink
                            phone={c.phone}
                            className="text-foreground/30 hover:text-blue-400 transition-colors p-1"
                            ariaLabel={`Text ${c.firstName || c.phone}`}
                            title="Open in-admin SMS chat"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </MessageCustomerLink>
                        )}
                        <button
                          onClick={() => openCustomerDrawer(c.id)}
                          className="text-foreground/30 hover:text-primary transition-colors"
                          title="View full details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <Customer360Panel customer={c} />
                  )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
            {listData?.total ?? 0} CUSTOMERS — PAGE {page} OF {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 bg-card border border-border/30 text-foreground/50 hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 bg-card border border-border/30 text-foreground/50 hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* wave-181.x Customers Phase 1 · CustomerDetail modal mount
          REMOVED. Detail view now opens via openCustomerDrawer (the
          surviving CustomerDrawer side-drawer pattern). */}
    </div>
  );
}

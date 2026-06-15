import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "../shared";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import {
  Phone, Mail, MapPin, MessageSquare, Loader2,
  Car, ExternalLink, Hash, Wrench, FileWarning
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { FollowUpButton } from "./FollowUpButton";
import type {
  ListedCustomer, CustomerHistoryInvoice, CustomerDeclinedEstimate, CustomerOpenWorkOrder,
} from "./format";

/** Customer 360 expandable detail panel — lazy-loaded service history.
 *  wave-181.x Customers Phase 1 · removed unused onSmsClick prop ·
 *  was declared but never invoked inside the panel · only existed to
 *  wire setSelectedId on the now-deleted CustomerDetail modal. */
function GraceButton({ membershipId, onComplete }: { membershipId: number; onComplete: () => void }) {
  const mutation = trpc.memberships.grantGracePeriod.useMutation({
    onSuccess: () => {
      onComplete();
    },
  });

  const [loading, setLoading] = useState(false);

  const handleGrant = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      await mutation.mutateAsync({ membershipId, days: 3 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGrant}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold tracking-wider text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded uppercase transition-colors"
    >
      {loading ? (
        <>
          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Granting...
        </>
      ) : (
        "Grant 3-day Grace Period"
      )}
    </button>
  );
}

export function Customer360Panel({ customer }: {
  customer: ListedCustomer;
}) {
  const [selectedProfile, setSelectedProfile] = useState<string>(
    customer.psychoProfile || "busy_tim"
  );

  const { data: historyData, isLoading: historyLoading, isError: historyError } = trpc.customers.history.useQuery(
    { phone: customer.phone },
    { enabled: !!customer.phone }
  );

  const { data: membershipData, refetch: refetchMembership } = trpc.memberships.lookupByPhone.useQuery(
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
    // C6 · VIP predicate unified with StatusBadge + customers.ts vipCount
    // (`isVip || totalVisits>=3`). The old `>=3 && totalSpent>200000` gate
    // disagreed with the row's VIP badge — a 3-visit/$1500 customer showed
    // the VIP badge but a non-VIP "LOYAL CUSTOMER" risk box in the same row.
    if (customer.isVip || customer.totalVisits >= 3) {
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

          {/* Vehicle + Risk + Membership in a 3-col layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
            <div className={`p-3 border ${risk ? `${risk.bg} ${risk.border}` : "bg-card border-border/20"}`}>
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1.5">RISK ASSESSMENT</span>
              {risk ? (
                <span className={`text-sm font-bold ${risk.color}`}>
                  {risk.label}
                </span>
              ) : (
                <span className="text-xs text-foreground/30 italic">No active risk flags</span>
              )}
            </div>

            {/* Nonstop Nick Membership */}
            {membershipData?.found && membershipData.members ? (
              <div className="bg-card border border-border/20 p-3 flex flex-col justify-between">
                <div>
                  <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1.5">
                    NONSTOP NICK MEMBERSHIP
                  </span>
                  {membershipData.members.map((m) => {
                    const isWarning = m.status === "past_due" || m.status === "incomplete" || m.status === "canceled";
                    return (
                      <div key={m.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-foreground truncate">
                            {m.plan === "nonstop-nick-plus" ? "Plus ($9.99/mo)" : "Base ($7.99/mo)"}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase whitespace-nowrap ${
                            m.isActive
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}>
                            {m.status}
                          </span>
                        </div>
                        {m.currentPeriodEnd && (
                          <div className="text-[10px] text-foreground/50">
                            Period End: {new Date(m.currentPeriodEnd).toLocaleDateString()}
                          </div>
                        )}
                        {isWarning && (
                          <div className="pt-1">
                            <GraceButton membershipId={m.id} onComplete={refetchMembership} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border/20 p-3">
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block mb-1.5">
                  NONSTOP NICK MEMBERSHIP
                </span>
                <span className="text-xs text-foreground/30 italic">No membership on file</span>
              </div>
            )}
          </div>

          {/* NICK AI ASSISTANT DRAWER */}
          <div className="bg-card border border-primary/25 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border/20 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-xs font-bold text-foreground tracking-wider uppercase">
                  Nick AI Cashier Assistant
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-background/50 p-1 border border-border/15 rounded">
                <span className="text-[10px] text-foreground/40 font-mono px-2">OUTREACH PROFILE:</span>
                {[
                  { id: "broke_brenda", label: "Broke Brenda (P1)" },
                  { id: "skeptical_pat", label: "Skeptical Pat (P2)" },
                  { id: "busy_tim", label: "Busy Tim (P3)" }
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProfile(p.id)}
                    className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${
                      selectedProfile === p.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-foreground/60 hover:text-foreground hover:bg-card"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Call Script Column */}
              <div className="bg-background/40 border border-border/10 p-3.5 rounded space-y-2">
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block uppercase">
                  Personalized Call Script
                </span>
                <p className="text-[11.5px] leading-relaxed text-foreground/80 italic">
                  {(() => {
                    const firstName = customer.firstName || "Customer";
                    const declinedSvc = historyData?.declinedEstimates?.[0]?.serviceDescription || "recommended maintenance";
                    
                    if (selectedProfile === "broke_brenda") {
                      return `"Hey ${firstName}, this is the team at Nick's Tire. I was looking over your vehicle's checkup and noticed we recommended some work on ${declinedSvc} that wasn't completed yet. We know budget can be tight, so we offer Snap Finance and easy payment plans to let you pay over time. We can also prioritize just the safety items today. Would you like to check out some payment options?"`;
                    }
                    if (selectedProfile === "skeptical_pat") {
                      return `"Hey ${firstName}, this is the team at Nick's Tire. Just following up on the ${declinedSvc} quote we did. Our work is fully backed by our 24-month warranty, and we guarantee the lowest price in Cleveland. We do a completely transparent digital inspection, so you see exactly what we see. Can we get you set up to take a look?"`;
                    }
                    // default / busy_tim
                    return `"Hey ${firstName}, this is the team at Nick's Tire. Following up on the ${declinedSvc} quote. We know your time is valuable, so we can get this done in under 45 minutes if we schedule an early slot. You can also use our secure drop-off box or we can give you a ride to work. What time this week works best to drop the car off?"`;
                  })()}
                </p>
              </div>

              {/* Objection Rebuttal Column */}
              <div className="bg-background/40 border border-border/10 p-3.5 rounded space-y-3">
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block uppercase">
                  Service Rebuttals (Brakes & Tires)
                </span>
                <div className="space-y-2.5">
                  <div>
                    <span className="text-[10px] font-bold text-amber-400 block mb-0.5">Brakes & Rotors Objection:</span>
                    <p className="text-[11px] text-foreground/60 leading-normal">
                      {selectedProfile === "broke_brenda" && "“I understand it's a stretch. If we just replace the brake pads today, we can get you safe on the road for half the cost, and do the rotors next month.”"}
                      {selectedProfile === "skeptical_pat" && "“All our pads come with a lifetime warranty. We also show you the exact digital measurements (e.g. 2mm left) so you see the wear yourself.”"}
                      {selectedProfile === "busy_tim" && "“We pre-order the exact pad and rotor match based on your VIN so they're in the bay when you arrive. In and out in 45 mins.”"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-blue-400 block mb-0.5">Tire Replacements Objection:</span>
                    <p className="text-[11px] text-foreground/60 leading-normal">
                      {selectedProfile === "broke_brenda" && "“Cleveland winter weather makes bald tires highly dangerous. We have budget brands starting at $65 and instant financing approvals.”"}
                      {selectedProfile === "skeptical_pat" && "“Our tire quotes include free lifetime rotations, flat repairs, and alignment checks. There are no hidden fees or surprise costs.”"}
                      {selectedProfile === "busy_tim" && "“We can mount, balance, and align all four tires in under 35 minutes if you take our first morning slot. You won't miss a meeting.”"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
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
            ) : historyError ? (
              // Distinct from empty — a thrown query must not read as "no data".
              <p className="text-xs text-red-400/70 italic py-2">Couldn't load service history</p>
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
                          {inv.estimateAmount !== undefined && inv.estimateAmount !== null && (
                            (() => {
                              const variance = inv.totalAmount - inv.estimateAmount;
                              const varianceInDollars = Math.round(variance / 100);
                              if (varianceInDollars < 0) {
                                return (
                                  <span 
                                    className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400"
                                    title={`Under estimate by $${Math.abs(varianceInDollars)}. Quoted: $${Math.round(inv.estimateAmount / 100)}`}
                                  >
                                    -${Math.abs(varianceInDollars)}
                                  </span>
                                );
                              } else if (varianceInDollars > 0) {
                                return (
                                  <span 
                                    className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400"
                                    title={`Over estimate by $${varianceInDollars}. Quoted: $${Math.round(inv.estimateAmount / 100)}`}
                                  >
                                    +${varianceInDollars}
                                  </span>
                                );
                              }
                              return null;
                            })()
                          )}
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

          {/* DECLINED WORK — unlinked ALG estimates (recovery opportunities) */}
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

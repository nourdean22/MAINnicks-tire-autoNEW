/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Now with: VIP badges, churn risk indicators, lifetime value sorting,
 * call buttons, total spent, days since last visit.
 */
import React, { useEffect, useState, lazy, Suspense } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { StatCard, PageHeader, LoadingState, EmptyState, SectionInsightStrip, TabBar, useUrlFilter, FilterChips, formatDate } from "./shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

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

const SEGMENT_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  recent: { label: "Recent", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  lapsed: { label: "Lapsed", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  unknown: { label: "Unknown", color: "text-foreground/50", bgColor: "bg-foreground/5" },
  new: { label: "New", color: "text-blue-400", bgColor: "bg-blue-500/10" },
};

function SegmentBadge({ segment }: { segment: string }) {
  const cfg = SEGMENT_CONFIG[segment] || SEGMENT_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] tracking-wider ${cfg.color} ${cfg.bgColor}`}>
      {cfg.label.toUpperCase()}
    </span>
  );
}

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

const JOURNEY_ICONS: Record<string, { icon: string; color: string }> = {
  lead: { icon: "📥", color: "border-blue-500/50" },
  booking: { icon: "📅", color: "border-emerald-500/50" },
  callback: { icon: "📞", color: "border-amber-500/50" },
  call: { icon: "☎️", color: "border-purple-500/50" },
  workorder: { icon: "🔧", color: "border-cyan-500/50" },
  invoice: { icon: "💰", color: "border-green-500/50" },
  review: { icon: "⭐", color: "border-yellow-500/50" },
};

function CustomerJourney({ phone }: { phone: string }) {
  const { data: timeline, isLoading } = trpc.customers.timeline.useQuery(
    { phone },
    { enabled: !!phone }
  );

  if (isLoading) return <div className="py-3 text-center"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  if (!timeline || timeline.length === 0) return <p className="text-xs text-foreground/30 italic py-2">No journey data yet</p>;

  return (
    <div className="space-y-0">
      {timeline.slice(0, 15).map((event: TimelineEvent, i: number) => {
        const cfg = JOURNEY_ICONS[event.type] || { icon: "📌", color: "border-foreground/20" };
        const date = new Date(event.date);
        const isFirst = i === 0;
        return (
          <div key={i} className="flex gap-3 relative">
            {/* Timeline line */}
            <div className="flex flex-col items-center w-6 shrink-0">
              <span className="text-sm">{cfg.icon}</span>
              {i < (timeline as unknown[]).length - 1 && (
                <div className="w-px flex-1 bg-foreground/10 my-1" />
              )}
            </div>
            {/* Content */}
            <div className={`flex-1 pb-3 ${isFirst ? "" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-foreground">{event.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 tracking-wider font-bold ${
                  event.status === "completed" || event.status === "confirmed" ? "text-emerald-400 bg-emerald-500/10" :
                  event.status === "lost" || event.status === "cancelled" ? "text-red-400 bg-red-500/10" :
                  "text-foreground/40 bg-foreground/5"
                }`}>{event.status.toUpperCase()}</span>
              </div>
              {event.detail && <p className="text-[10px] text-foreground/50 mt-0.5">{event.detail}</p>}
              <p className="text-[9px] text-foreground/30 mt-0.5">{date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CustomerDetail({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: customer, isLoading } = trpc.customers.getById.useQuery({ id: customerId });
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState("");

  // v1.7 audit fix · pre-fix used `if (customer && !notesInitialized)`
  // setState-during-render pattern, which triggers React 18+ "Cannot
  // update a component while rendering a different component" warnings
  // and double-renders under React 19 strict mode. Plus the
  // notesInitialized guard prevented re-sync when customer switched.
  // Now syncs on customer.id change via useEffect.
  useEffect(() => {
    if (customer) setNotesText(customer.notes || "");
  }, [customer?.id, customer?.notes]);

  const quickSms = trpc.customers.quickSms.useMutation({
    onSuccess: (result) => {
      if (result.success) { toast.success("SMS sent"); setSmsText(""); setSmsOpen(false); }
      else toast.error(result.error || "Failed");
    },
    onError: () => toast.error("Failed to send SMS"),
  });

  const updateNotes = trpc.customers.updateNotes.useMutation({
    onSuccess: (result) => {
      if (result.success) { toast.success("Notes saved"); utils.customers.getById.invalidate({ id: customerId }); }
      else toast.error("Failed to save notes");
    },
    onError: () => toast.error("Failed to save notes"),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border/30 p-8 max-w-lg w-full">
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border/30 p-8 max-w-lg w-full">
          <p className="text-foreground/50">Customer not found.</p>
          <button onClick={onClose} className="mt-4 text-sm text-primary hover:underline">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border/30 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border/20">
          <div>
            <h3 className="font-bold text-xl text-foreground tracking-tight">
              {customer.firstName} {customer.lastName || ""}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <SegmentBadge segment={customer.segment} />
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-foreground/30 hover:text-foreground/60 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Phone</span>
              <a href={`tel:${customer.phone}`} className="text-sm text-foreground flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-primary" />
                {customer.phone}
              </a>
            </div>
            {customer.phone2 && (
              <div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Phone 2</span>
                <a href={`tel:${customer.phone2}`} className="text-sm text-foreground flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-foreground/30" />
                  {customer.phone2}
                </a>
              </div>
            )}
            {customer.email && (
              <div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Email</span>
                <a href={`mailto:${customer.email}`} className="text-sm text-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-primary" />
                  {customer.email}
                </a>
              </div>
            )}
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Type</span>
              <span className="text-sm text-foreground flex items-center gap-1.5">
                {customer.customerType === "commercial" ? <Building2 className="w-3.5 h-3.5 text-primary" /> : <UserCheck className="w-3.5 h-3.5 text-foreground/30" />}
                {customer.customerType === "commercial" ? "Commercial" : "Individual"}
              </span>
            </div>
          </div>

          {(customer.address || customer.city) && (
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Address</span>
              <p className="text-sm text-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/20">
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Total Visits</span>
              <span className="font-bold text-2xl text-foreground">{customer.totalVisits}</span>
            </div>
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Total Spent</span>
              <span className={`font-bold text-2xl ${customer.totalSpent > 0 ? "text-emerald-400" : "text-foreground/30"}`}>
                {customer.totalSpent > 0 ? `$${Math.round(customer.totalSpent / 100).toLocaleString()}` : "—"}
              </span>
            </div>
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Last Visit</span>
              <span className="text-sm text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-foreground/30" />
                {customer.lastVisitDate ? formatDate(customer.lastVisitDate) : "Unknown"}
              </span>
            </div>
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">First Visit</span>
              <span className="text-sm text-foreground/60">
                {formatDate(customer.firstVisitDate)}
              </span>
            </div>
          </div>

          {/* Vehicle Info */}
          {customer.vehicleMake && (
            <div className="pt-2 border-t border-border/20">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Primary Vehicle</span>
              <span className="text-sm text-foreground">
                {[customer.vehicleYear, customer.vehicleMake, customer.vehicleModel].filter(Boolean).join(" ")}
              </span>
            </div>
          )}

          {/* SMS Campaign Status */}
          <div className="pt-2 border-t border-border/20">
            <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Campaign Status</span>
            {customer.smsCampaignSent ? (
              <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Texted {customer.smsCampaignDate ? formatDate(customer.smsCampaignDate) : ""}
              </span>
            ) : (
              <span className="text-xs text-foreground/40">Not yet texted</span>
            )}
          </div>

          {customer.alsCustomerId && (
            <div className="pt-2 border-t border-border/20">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">ALS Customer ID</span>
              <span className="text-sm text-foreground/60">{customer.alsCustomerId}</span>
            </div>
          )}

          {/* Notes Section */}
          <div className="pt-2 border-t border-border/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide flex items-center gap-1">
                <StickyNote className="w-3 h-3" /> Notes
              </span>
              {!notesOpen && (
                <button onClick={() => setNotesOpen(true)} className="text-[10px] text-primary hover:text-primary/80 tracking-wider">
                  {customer.notes ? "EDIT" : "ADD NOTE"}
                </button>
              )}
            </div>
            {notesOpen ? (
              <div className="space-y-2">
                <textarea value={notesText} onChange={e => setNotesText(e.target.value)}
                  placeholder="Add internal notes about this customer..."
                  className="w-full bg-background border border-border/30 p-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
                  rows={3} maxLength={5000} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { updateNotes.mutate({ id: customer.id, notes: notesText }); setNotesOpen(false); }}
                    disabled={updateNotes.isPending}
                    className="px-3 py-1.5 bg-primary text-primary-foreground text-xs tracking-wider hover:bg-primary/90 disabled:opacity-50"
                  >
                    {updateNotes.isPending ? "SAVING..." : "SAVE"}
                  </button>
                  <button onClick={() => { setNotesOpen(false); setNotesText(customer.notes || ""); }}
                    className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground tracking-wider">CANCEL</button>
                </div>
              </div>
            ) : customer.notes ? (
              <p className="text-sm text-foreground/60 whitespace-pre-wrap">{customer.notes}</p>
            ) : (
              <p className="text-xs text-foreground/30 italic">No notes yet</p>
            )}
          </div>

          {/* Customer Journey Timeline */}
          <div className="pt-2 border-t border-border/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide">CUSTOMER JOURNEY</span>
            </div>
            <CustomerJourney phone={customer.phone} />
          </div>

          {/* Quick SMS */}
          <div className="pt-2 border-t border-border/20">
            {!smsOpen ? (
              <button onClick={() => setSmsOpen(true)} aria-label="Send text message" className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 tracking-wider">
                <MessageSquare className="w-3.5 h-3.5" /> QUICK TEXT
              </button>
            ) : (
              <div className="space-y-2">
                <span className="font-mono text-[10px] text-foreground/40 tracking-wide block">
                  Send SMS to {customer.firstName}
                </span>
                <textarea value={smsText} onChange={e => setSmsText(e.target.value)}
                  placeholder="Type your message..."
                  className="w-full bg-background border border-border/30 p-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
                  rows={3} maxLength={500} />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-foreground/30">{smsText.length}/500</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setSmsOpen(false); setSmsText(""); }}
                      className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground tracking-wider">CANCEL</button>
                    <button
                      onClick={() => quickSms.mutate({ customerId: customer.id, message: smsText })}
                      disabled={!smsText.trim() || quickSms.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs tracking-wider hover:bg-primary/90 disabled:opacity-50"
                    >
                      {quickSms.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {quickSms.isPending ? "SENDING..." : "SEND"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inline SMS Sender for customer rows ──────────────────
function InlineSms({ customerId, firstName }: { customerId: number; firstName: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  const quickSms = trpc.customers.quickSms.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setSent(true);
        setText("");
        setTimeout(() => { setSent(false); setOpen(false); }, 1500);
      } else {
        toast.error(result.error || "Failed to send");
      }
    },
    onError: () => toast.error("Failed to send SMS"),
  });

  if (sent) {
    return (
      <span className="text-emerald-400" title="Sent!">
        <CheckCircle2 className="w-4 h-4" />
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); setText(`Hi ${firstName || "there"}! Nick's Tire & Auto here. `); }}
        className="text-foreground/30 hover:text-blue-400 transition-colors"
        title="Quick SMS"
      >
        <MessageSquare className="w-4 h-4" />
      </button>
    );
  }

  return (
    /* wave-119 — was `right-0 top-0 w-72` absolute. On a 390px phone
       viewport with the card inset, no guarantee right-edge stayed on-
       screen. Now: clamps width to viewport-minus-margin and pulls back
       from the right with `max-w-[calc(100vw-2rem)]` so it never overflows
       on small viewports. Added `right-2` for breathing room from the edge. */
    <div className="absolute right-2 top-0 z-30 bg-card border border-primary/30 shadow-lg p-3 w-72 max-w-[calc(100vw-2rem)]" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-foreground/50 tracking-wider">SMS TO {(firstName || "").toUpperCase()}</span>
        <button onClick={() => setOpen(false)} aria-label="Close" className="text-foreground/30 hover:text-foreground">
          <X className="w-3 h-3" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        className="w-full bg-background border border-border/30 p-2 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
        rows={2}
        maxLength={500}
        autoFocus
      />
      <div className="flex items-center justify-between mt-1.5">
        {/* wave-120 — 9px is below iOS legibility threshold; bumped to 11px */}
        <span className="text-[11px] text-foreground/40">{text.length}/500</span>
        <button
          onClick={() => quickSms.mutate({ customerId, message: text })}
          disabled={!text.trim() || quickSms.isPending}
          className="flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground text-[10px] tracking-wider hover:bg-primary/90 disabled:opacity-50"
        >
          {quickSms.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {quickSms.isPending ? "..." : "SEND"}
        </button>
      </div>
    </div>
  );
}

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
  const mutation = trpc.vapi.makeFollowUpCall.useMutation({
    onSuccess: (result) => {
      if (result.success && result.callId) {
        toast.success(`Follow-up call queued (${result.callId.slice(0, 8)}...). Nick is dialing now.`);
      } else {
        toast.error(`Follow-up failed: ${result.error || "unknown error"}`);
      }
    },
    onError: (err) => toast.error(`Follow-up failed: ${err.message}`),
  });

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const last = prompt(
          `Call ${customerName.split(" ")[0]} for a post-repair follow-up?\n\nWhat was their last service? (e.g. "tires", "brake job", "oil change", or leave blank for "recent visit")`,
          ""
        );
        if (last === null) return; // cancelled
        mutation.mutate({
          customerName,
          phone,
          lastService: last.trim() || "recent visit",
        });
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

/** Customer 360 expandable detail panel — lazy-loaded service history */
function Customer360Panel({ customer, onSmsClick }: {
  customer: ListedCustomer;
  onSmsClick: (id: number) => void;
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

  // Segment badge for header
  const getSegmentLabel = () => {
    if (customer.totalVisits >= 3 && customer.totalSpent > 200000) return { label: "VIP", color: "text-amber-400", bg: "bg-amber-500/10" };
    if (customer.totalVisits >= 3) return { label: "LOYAL", color: "text-emerald-400", bg: "bg-emerald-500/10" };
    if (daysAgo && daysAgo > 60) return { label: "AT-RISK", color: "text-red-400", bg: "bg-red-500/10" };
    if (customer.totalVisits === 1) return { label: "NEW", color: "text-blue-400", bg: "bg-blue-500/10" };
    if (daysAgo && daysAgo > 365) return { label: "LAPSED", color: "text-amber-400", bg: "bg-amber-500/10" };
    return { label: customer.segment?.toUpperCase() || "UNKNOWN", color: "text-foreground/50", bg: "bg-foreground/5" };
  };
  const seg = getSegmentLabel();

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
                  <span className={`inline-flex items-center px-2 py-0.5 text-[9px] tracking-wider font-bold ${seg.color} ${seg.bg}`}>
                    {seg.label}
                  </span>
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
                  <a
                    href={`sms:${customer.phone}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    <MessageSquare className="w-3 h-3" /> SMS
                  </a>
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
      } else {
        toast.error("Metrics refresh failed");
      }
    },
    onError: () => toast.error("Metrics refresh failed"),
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
        <StatCard label="Commercial" value={stats?.commercial ?? 0} icon={<Building2 className="w-4 h-4" />} color="text-purple-400" />
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
            title="Recompute declined-work + backlog totals from local DB. No ALG fetch. Auto-runs on login."
          >
            {refreshMetricsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Recompute
          </button>
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
                        {c.customerType === "commercial" && <Building2 className="w-3 h-3 text-purple-400" />}
                        {c.notes && <span title="Has notes"><StickyNote className="w-3 h-3 text-amber-400/60" /></span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                        <SegmentBadge segment={c.segment} />
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

                    {/* Actions: SMS + View */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 relative" onClick={e => e.stopPropagation()}>
                        {c.phone && (
                          <InlineSms customerId={c.id} firstName={c.firstName || ""} />
                        )}
                        <button
                          onClick={() => setSelectedId(c.id)}
                          className="text-foreground/30 hover:text-primary transition-colors"
                          title="View full details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <Customer360Panel customer={c} onSmsClick={(id) => setSelectedId(id)} />
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

      {selectedId && <CustomerDetail customerId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

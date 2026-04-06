/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Now with: VIP badges, churn risk indicators, lifetime value sorting,
 * call buttons, total spent, days since last visit.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard } from "./shared";
import {
  Users, Search, ChevronLeft, ChevronRight, Phone, Mail,
  MapPin, Calendar, UserCheck, AlertTriangle, Building2,
  ArrowUpDown, Filter, Eye, X, Download, Send, CheckCircle2,
  MessageSquare, StickyNote, RefreshCw, Loader2, Crown,
  ShieldAlert, Clock
} from "lucide-react";
import { toast } from "sonner";

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
      {(timeline as any[]).slice(0, 15).map((event: any, i: number) => {
        const cfg = JOURNEY_ICONS[event.type] || { icon: "📌", color: "border-foreground/20" };
        const date = new Date(event.date);
        const isFirst = i === 0;
        return (
          <div key={i} className="flex gap-3 relative">
            {/* Timeline line */}
            <div className="flex flex-col items-center w-6 shrink-0">
              <span className="text-sm">{cfg.icon}</span>
              {i < (timeline as any[]).length - 1 && (
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
  const [notesInitialized, setNotesInitialized] = useState(false);

  if (customer && !notesInitialized) {
    setNotesText(customer.notes || "");
    setNotesInitialized(true);
  }

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
          <button onClick={onClose} className="text-foreground/30 hover:text-foreground/60 transition-colors">
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
              <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Last Visit</span>
              <span className="text-sm text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-foreground/30" />
                {customer.lastVisitDate ? new Date(customer.lastVisitDate).toLocaleDateString() : "Unknown"}
              </span>
            </div>
          </div>

          {/* SMS Campaign Status */}
          <div className="pt-2 border-t border-border/20">
            <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Campaign Status</span>
            {customer.smsCampaignSent ? (
              <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Texted {customer.smsCampaignDate ? new Date(customer.smsCampaignDate).toLocaleDateString() : ""}
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
              <button onClick={() => setSmsOpen(true)} className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 tracking-wider">
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

export default function CustomersSection() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [sortBy, setSortBy] = useState<SortBy>("totalSpent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pageSize = 25;
  const [exporting, setExporting] = useState(false);

  const { data: stats } = trpc.customers.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: listData, isLoading } = trpc.customers.list.useQuery({
    page,
    pageSize,
    search: search || undefined,
    segment,
    sortBy,
    sortDir,
  }, { refetchInterval: 30000 });

  const retryCampaign = trpc.customers.retryCampaign.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} texts (${result.failed} failed). ${result.remaining} remaining.`);
      utils.customers.campaignStats.invalidate();
    },
    onError: () => toast.error("Campaign retry failed"),
  });

  const totalPages = Math.ceil((listData?.total ?? 0) / pageSize);

  function toggleSort(col: SortBy) {
    if (sortBy === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Customers" value={stats?.total ?? 0} icon={<Users className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="Recent" value={stats?.recent ?? 0} icon={<UserCheck className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Lapsed" value={stats?.lapsed ?? 0} icon={<AlertTriangle className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="Unknown" value={stats?.unknown ?? 0} icon={<Users className="w-4 h-4" />} color="text-foreground/50" />
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
            onClick={() => { if (confirm(`Send texts to next 50?`)) retryCampaign.mutate({ batchSize: 50 }); }}
            disabled={retryCampaign.isPending}
            className="flex items-center gap-2 bg-primary/10 border border-primary/30 px-4 py-2.5 text-sm text-primary hover:bg-primary/20 transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {retryCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {retryCampaign.isPending ? "Sending..." : "Send Next 50"}
          </button>
        )}

        <button
          onClick={async () => {
            setExporting(true);
            try {
              const result = await fetch(`/api/trpc/customers.exportCsv?input=${encodeURIComponent(JSON.stringify({ segment }))}`, { credentials: "include" }).then(r => r.json());
              const data = result?.result?.data?.json ?? result?.result?.data;
              const csvData = data?.csv;
              if (!csvData) { toast.error("Export failed"); return; }
              const blob = new Blob([csvData], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `customers-${segment}-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`Exported ${data?.count ?? 0} customers`);
            } catch { toast.error("Export failed"); } finally { setExporting(false); }
          }}
          disabled={exporting}
          className="flex items-center gap-2 bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            type="text"
            placeholder="Search name, phone, email, city..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-card border border-border/30 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-foreground/30" />
          {(["all", "recent", "lapsed", "unknown"] as Segment[]).map(s => (
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
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden sm:table-cell">
                <button onClick={() => toggleSort("lastVisit")} className="flex items-center gap-1 hover:text-foreground/60">
                  Last Service <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide w-10"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-foreground/30">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : listData?.customers.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-foreground/30 text-[12px]">
                  No customers found
                </td>
              </tr>
            ) : (
              listData?.customers.map((c: any) => {
                const daysAgo = c.daysSinceLastVisit ?? (c.lastVisitDate ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86400000) : null);
                return (
                  <tr key={c.id} className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors">
                    {/* Name + badges */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-foreground font-medium">{c.firstName} {c.lastName || ""}</span>
                        {c.customerType === "commercial" && <Building2 className="w-3 h-3 text-purple-400" />}
                        {c.notes && <span title="Has notes"><StickyNote className="w-3 h-3 text-amber-400/60" /></span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
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
                      <span className="font-mono text-foreground/60 text-[12px]">
                        {c.totalRevenue ? `$${c.totalRevenue.toLocaleString()}` : "—"}
                      </span>
                    </td>

                    {/* Visits */}
                    <td className="p-3 text-foreground/60">{c.totalVisits}</td>

                    {/* Last Service */}
                    <td className="p-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-foreground/30" />
                        <span className={`text-xs ${daysAgo && daysAgo > 180 ? "text-red-400" : daysAgo && daysAgo > 90 ? "text-amber-400" : "text-foreground/50"}`}>
                          {daysSinceStr(daysAgo)}
                        </span>
                      </div>
                    </td>

                    {/* View */}
                    <td className="p-3">
                      <button
                        onClick={() => setSelectedId(c.id)}
                        className="text-foreground/30 hover:text-primary transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
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

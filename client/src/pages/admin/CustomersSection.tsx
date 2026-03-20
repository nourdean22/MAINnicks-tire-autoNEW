/**
 * Customer Database Admin Section
 * View, search, filter, and manage imported customer records.
 * Supports segment filtering, search, pagination, individual customer details,
 * quick SMS, notes, and bulk campaign retry.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard } from "./shared";
import {
  Users, Search, ChevronLeft, ChevronRight, Phone, Mail,
  MapPin, Calendar, UserCheck, AlertTriangle, Building2,
  ArrowUpDown, Filter, Eye, X, Download, Send, CheckCircle2,
  MessageSquare, StickyNote, RefreshCw, Loader2
} from "lucide-react";
import { toast } from "sonner";

type Segment = "all" | "recent" | "lapsed" | "unknown";
type SortBy = "name" | "visits" | "lastVisit";
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
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono tracking-wider ${cfg.color} ${cfg.bgColor}`}>
      {cfg.label.toUpperCase()}
    </span>
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

  // Initialize notes text when customer loads
  if (customer && !notesInitialized) {
    setNotesText(customer.notes || "");
    setNotesInitialized(true);
  }

  const quickSms = trpc.customers.quickSms.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("SMS sent successfully");
        setSmsText("");
        setSmsOpen(false);
      } else {
        toast.error(result.error || "Failed to send SMS");
      }
    },
    onError: () => toast.error("Failed to send SMS"),
  });

  const updateNotes = trpc.customers.updateNotes.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Notes saved");
        utils.customers.getById.invalidate({ id: customerId });
      } else {
        toast.error("Failed to save notes");
      }
    },
    onError: () => toast.error("Failed to save notes"),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border/30 p-8 max-w-lg w-full">
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin" />
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
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/20">
          <div>
            <h3 className="font-heading font-bold text-xl text-foreground tracking-tight">
              {customer.firstName} {customer.lastName || ""}
            </h3>
            <SegmentBadge segment={customer.segment} />
          </div>
          <button onClick={onClose} className="text-foreground/30 hover:text-foreground/60 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Details */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Phone</span>
              <a href={`tel:${customer.phone}`} className="text-sm text-foreground flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-primary" />
                {customer.phone}
              </a>
            </div>
            {customer.phone2 && (
              <div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Phone 2</span>
                <a href={`tel:${customer.phone2}`} className="text-sm text-foreground flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-foreground/30" />
                  {customer.phone2}
                </a>
              </div>
            )}
            {customer.email && (
              <div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Email</span>
                <a href={`mailto:${customer.email}`} className="text-sm text-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-primary" />
                  {customer.email}
                </a>
              </div>
            )}
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Type</span>
              <span className="text-sm text-foreground flex items-center gap-1.5">
                {customer.customerType === "commercial" ? <Building2 className="w-3.5 h-3.5 text-primary" /> : <UserCheck className="w-3.5 h-3.5 text-foreground/30" />}
                {customer.customerType === "commercial" ? "Commercial" : "Individual"}
              </span>
            </div>
          </div>

          {(customer.address || customer.city) && (
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Address</span>
              <p className="text-sm text-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/20">
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Total Visits</span>
              <span className="font-heading font-bold text-2xl text-foreground">{customer.totalVisits}</span>
            </div>
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Last Visit</span>
              <span className="text-sm text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-foreground/30" />
                {customer.lastVisitDate ? new Date(customer.lastVisitDate).toLocaleDateString() : "Unknown"}
              </span>
            </div>
          </div>

          {/* SMS Campaign Status */}
          <div className="pt-2 border-t border-border/20">
            <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">Campaign Status</span>
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
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block mb-1">ALS Customer ID</span>
              <span className="text-sm text-foreground/60 font-mono">{customer.alsCustomerId}</span>
            </div>
          )}

          {/* Notes Section */}
          <div className="pt-2 border-t border-border/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase flex items-center gap-1">
                <StickyNote className="w-3 h-3" /> Notes
              </span>
              {!notesOpen && (
                <button
                  onClick={() => setNotesOpen(true)}
                  className="text-[10px] font-mono text-primary hover:text-primary/80 tracking-wider"
                >
                  {customer.notes ? "EDIT" : "ADD NOTE"}
                </button>
              )}
            </div>
            {notesOpen ? (
              <div className="space-y-2">
                <textarea
                  value={notesText}
                  onChange={e => setNotesText(e.target.value)}
                  placeholder="Add internal notes about this customer..."
                  className="w-full bg-background border border-border/30 p-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
                  rows={3}
                  maxLength={5000}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      updateNotes.mutate({ id: customer.id, notes: notesText });
                      setNotesOpen(false);
                    }}
                    disabled={updateNotes.isPending}
                    className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-mono tracking-wider hover:bg-primary/90 disabled:opacity-50"
                  >
                    {updateNotes.isPending ? "SAVING..." : "SAVE"}
                  </button>
                  <button
                    onClick={() => { setNotesOpen(false); setNotesText(customer.notes || ""); }}
                    className="px-3 py-1.5 text-xs font-mono text-foreground/50 hover:text-foreground tracking-wider"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : customer.notes ? (
              <p className="text-sm text-foreground/60 whitespace-pre-wrap">{customer.notes}</p>
            ) : (
              <p className="text-xs text-foreground/30 italic">No notes yet</p>
            )}
          </div>

          {/* Quick SMS */}
          <div className="pt-2 border-t border-border/20">
            {!smsOpen ? (
              <button
                onClick={() => setSmsOpen(true)}
                className="flex items-center gap-2 text-xs font-mono text-primary hover:text-primary/80 tracking-wider"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                QUICK TEXT
              </button>
            ) : (
              <div className="space-y-2">
                <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase block">
                  Send SMS to {customer.firstName}
                </span>
                <textarea
                  value={smsText}
                  onChange={e => setSmsText(e.target.value)}
                  placeholder="Type your message..."
                  className="w-full bg-background border border-border/30 p-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
                  rows={3}
                  maxLength={500}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-foreground/30">{smsText.length}/500</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSmsOpen(false); setSmsText(""); }}
                      className="px-3 py-1.5 text-xs font-mono text-foreground/50 hover:text-foreground tracking-wider"
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={() => quickSms.mutate({ customerId: customer.id, message: smsText })}
                      disabled={!smsText.trim() || quickSms.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-mono tracking-wider hover:bg-primary/90 disabled:opacity-50"
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
  const [sortBy, setSortBy] = useState<SortBy>("lastVisit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pageSize = 25;

  const [exporting, setExporting] = useState(false);

  const { data: stats } = trpc.customers.stats.useQuery();
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: listData, isLoading } = trpc.customers.list.useQuery({
    page,
    pageSize,
    search: search || undefined,
    segment,
    sortBy,
    sortDir,
  });

  const retryCampaign = trpc.customers.retryCampaign.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} texts (${result.failed} failed). ${result.remaining} remaining.`);
      utils.customers.campaignStats.invalidate();
    },
    onError: () => toast.error("Campaign retry failed — check Twilio balance"),
  });

  const totalPages = Math.ceil((listData?.total ?? 0) / pageSize);

  function toggleSort(col: SortBy) {
    if (sortBy === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
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
              <span className="font-mono text-xs text-foreground/60 tracking-wider">SMS CAMPAIGN:</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-mono text-xs">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">{campaignStats.sent}</span>
                <span className="text-foreground/30">sent</span>
              </span>
              <span className="flex items-center gap-1 font-mono text-xs">
                <span className="text-amber-400">{campaignStats.remaining}</span>
                <span className="text-foreground/30">remaining</span>
              </span>
            </div>
            {campaignStats.total > 0 && (
              <div className="flex-1 bg-foreground/5 h-2 hidden sm:block">
                <div className="bg-primary h-2 transition-all" style={{ width: `${Math.round((campaignStats.sent / campaignStats.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Retry Campaign Button */}
        {campaignStats && campaignStats.remaining > 0 && (
          <button
            onClick={() => {
              if (confirm(`Send thank you + review texts to the next 50 untexted customers?`)) {
                retryCampaign.mutate({ batchSize: 50 });
              }
            }}
            disabled={retryCampaign.isPending}
            className="flex items-center gap-2 bg-primary/10 border border-primary/30 px-4 py-2.5 text-sm text-primary hover:bg-primary/20 transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {retryCampaign.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {retryCampaign.isPending ? "Sending..." : "Send Next 50"}
          </button>
        )}

        <button
          onClick={async () => {
            setExporting(true);
            try {
              const result = await fetch(`/api/trpc/customers.exportCsv?input=${encodeURIComponent(JSON.stringify({ segment }))}`, {
                credentials: "include",
              }).then(r => r.json());
              const csvData = result?.result?.data?.csv;
              if (!csvData) { toast.error("Export failed"); return; }
              const blob = new Blob([csvData], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `customers-${segment}-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`Exported ${result?.result?.data?.count ?? 0} customers`);
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
            placeholder="Search by name, phone, email, or city..."
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
              className={`px-3 py-1.5 text-xs font-mono tracking-wider uppercase transition-colors ${
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
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase">
                <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground/60">
                  Name <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase">Phone</th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase hidden md:table-cell">City</th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase">Segment</th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase">
                <button onClick={() => toggleSort("visits")} className="flex items-center gap-1 hover:text-foreground/60">
                  Visits <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase hidden sm:table-cell">
                <button onClick={() => toggleSort("lastVisit")} className="flex items-center gap-1 hover:text-foreground/60">
                  Last Visit <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase w-16">SMS</th>
              <th className="text-left p-3 font-mono text-[10px] text-foreground/40 tracking-wider uppercase w-10"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-foreground/30">
                  <div className="w-5 h-5 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : listData?.customers.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-foreground/30 font-mono text-xs">
                  No customers found
                </td>
              </tr>
            ) : (
              listData?.customers.map((c: any) => (
                <tr key={c.id} className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors">
                  <td className="p-3">
                    <span className="text-foreground font-medium">{c.firstName} {c.lastName || ""}</span>
                    {c.customerType === "commercial" && (
                      <Building2 className="w-3 h-3 text-purple-400 inline ml-1.5" />
                    )}
                    {c.notes && (
                      <span title="Has notes"><StickyNote className="w-3 h-3 text-amber-400/60 inline ml-1" /></span>
                    )}
                  </td>
                  <td className="p-3">
                    <a href={`tel:${c.phone}`} className="text-foreground/60 hover:text-primary transition-colors font-mono text-xs">
                      {c.phone}
                    </a>
                  </td>
                  <td className="p-3 text-foreground/50 hidden md:table-cell">{c.city || "—"}</td>
                  <td className="p-3"><SegmentBadge segment={c.segment} /></td>
                  <td className="p-3 text-foreground/60 font-mono">{c.totalVisits}</td>
                  <td className="p-3 text-foreground/50 text-xs hidden sm:table-cell">
                    {c.lastVisitDate ? new Date(c.lastVisitDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3">
                    {c.smsCampaignSent ? (
                      <span title="Texted"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /></span>
                    ) : (
                      <span className="w-3.5 h-3.5 block rounded-full border border-foreground/20" />
                    )}
                  </td>
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
              ))
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

      {/* Customer Detail Modal */}
      {selectedId && (
        <CustomerDetail customerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

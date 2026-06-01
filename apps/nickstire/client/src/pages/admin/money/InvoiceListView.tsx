import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, FileText, Search,
  MessageSquare, ChevronUp, ChevronDown,
  Car, Phone, ExternalLink, Hash, Calendar, DollarSign,
} from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import { formatCents, type InvoiceItem } from "./revenueFormat";

// ─── INVOICE LIST VIEW ──────────────────────────────────
export function InvoiceListView({ onCreateNew }: { onCreateNew: () => void }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = trpc.invoices.list.useQuery({ search: search || undefined, limit: 50 });
  const utils = trpc.useUtils();

  const deleteInvoice = trpc.invoices.delete.useMutation({
    onSuccess: () => { utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); toast.success("Invoice deleted"); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    return [...data.items].sort((a: InvoiceItem, b: InvoiceItem) => {
      if (sortField === "date") {
        const diff = new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      const diff = (a.totalAmount ?? 0) - (b.totalAmount ?? 0);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [data?.items, sortField, sortDir]);

  const SortIcon = ({ field }: { field: "date" | "amount" }) => {
    if (sortField !== field) return <ChevronDown className="w-2.5 h-2.5 text-foreground/15 inline ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-2.5 h-2.5 text-primary inline ml-0.5" />
      : <ChevronDown className="w-2.5 h-2.5 text-primary inline ml-0.5" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices by name, number, or service..."
            className="w-full bg-card border border-border/30 pl-10 pr-4 py-2 text-[12px] text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wider flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> CREATE
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <div className="bg-card border border-border/30 p-12 text-center">
          <FileText className="w-8 h-8 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-bold text-foreground tracking-[-0.01em] mb-2">NO INVOICES</h3>
          <p className="text-[12px] text-foreground/40 mb-4">Create your first invoice to start tracking revenue.</p>
          <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wider">CREATE INVOICE</button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header — sortable columns */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] text-foreground/30 tracking-wide">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-2">Service</div>
            <div className="col-span-1">Method</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1 cursor-pointer select-none hover:text-foreground/60" role="button" aria-label="Sort by amount" onClick={() => toggleSort("amount")}>
              Amount <SortIcon field="amount" />
            </div>
            <div className="col-span-1 cursor-pointer select-none hover:text-foreground/60" role="button" aria-label="Sort by date" onClick={() => toggleSort("date")}>
              Date <SortIcon field="date" />
            </div>
            <div className="col-span-2"></div>
          </div>
          {sortedItems.map((inv: InvoiceItem, _iIdx: number) => {
            const isExpanded = expandedId === inv.id;
            const total = inv.totalAmount ?? inv.total ?? 0;
            const parts = inv.partsCost ?? 0;
            const labor = inv.laborCost ?? 0;
            const tax = inv.taxAmount ?? 0;
            const partsPct = total > 0 ? Math.round((parts / total) * 100) : 0;
            const laborPct = total > 0 ? Math.round((labor / total) * 100) : 0;
            const taxPct = total > 0 ? Math.round((tax / total) * 100) : 0;
            return (
            <React.Fragment key={inv.id}>
            <div
              className={`stagger-in grid grid-cols-12 gap-2 items-center px-4 py-3 bg-card border ${isExpanded ? "border-primary/30" : "border-border/20 hover:border-border/40"} transition-colors cursor-pointer`}
              style={{ animationDelay: `${_iIdx * 40}ms` }}
              onClick={() => setExpandedId(isExpanded ? null : inv.id)}
            >
              <div className="col-span-1 text-[10px] text-foreground/30 flex items-center gap-1">
                {isExpanded
                  ? <ChevronUp className="w-3 h-3 text-primary shrink-0" />
                  : <ChevronDown className="w-3 h-3 text-foreground/20 shrink-0" />
                }
                {inv.invoiceNumber || inv.id}
              </div>
              <div className="col-span-3">
                <span className="font-bold text-xs text-foreground block truncate">{inv.customerName}</span>
                {inv.customerPhone && <span className="font-mono text-[9px] text-foreground/30">{inv.customerPhone}</span>}
              </div>
              <div className="col-span-2 text-[10px] text-foreground/50 truncate">{inv.serviceDescription || "—"}</div>
              <div className="col-span-1">
                <span className="font-mono text-[9px] text-foreground/40 uppercase">{inv.paymentMethod}</span>
              </div>
              <div className="col-span-1">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 ${
                  inv.paymentStatus === "paid" ? "bg-emerald-500/20 text-emerald-400" :
                  inv.paymentStatus === "pending" ? "bg-amber-500/20 text-amber-400" :
                  inv.paymentStatus === "partial" ? "bg-red-500/20 text-red-400" :
                  inv.paymentStatus === "refunded" ? "bg-red-500/20 text-red-400" :
                  "bg-blue-500/20 text-blue-400"
                }`}>
                  {inv.paymentStatus?.toUpperCase()}
                </span>
              </div>
              <div className="col-span-1 font-bold text-sm text-primary">{formatCents(total)}</div>
              <div className="col-span-1 text-[9px] text-foreground/30">
                {new Date(inv.invoiceDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
              <div className="col-span-2 flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                {(inv.paymentStatus === "pending" || inv.paymentStatus === "partial") && inv.customerPhone && (
                  <MessageCustomerLink
                    phone={inv.customerPhone}
                    body={`Hi ${inv.customerName?.split(" ")[0] || ""}, this is Nick's Tire & Auto. Your invoice of ${formatCents(total)} is still outstanding. Reply or call us to settle. Thanks!`}
                    className="p-1 text-foreground/20 hover:text-blue-400 transition-colors inline-flex items-center"
                    title="SMS follow-up via in-admin chat"
                    ariaLabel="Send invoice follow-up SMS"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </MessageCustomerLink>
                )}
                <button
                  onClick={async () => {
                    // confirmDialog not native confirm() — native confirm()
                    // is suppressed in iOS PWA standalone mode, so the
                    // operator's delete-invoice tap silently did nothing
                    // on their phone (the same bug class wave-139 fixed
                    // for the rest of the admin).
                    const ok = await confirmDialog({
                      title: "Delete invoice?",
                      message: `${inv.invoiceNumber || `Invoice #${inv.id}`} — ${inv.customerName || "this customer"}. This cannot be undone.`,
                      confirmLabel: "Delete",
                      tone: "danger",
                    });
                    if (ok) deleteInvoice.mutate({ id: inv.id });
                  }}
                  className="p-1 text-foreground/20 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Expanded detail panel — shows breakdown we capture from ALG */}
            {isExpanded && (
              <div className="stagger-in bg-background/40 border-l-2 border-primary/30 px-6 py-4 -mt-1 mb-1 space-y-3">
                {/* Vehicle + Customer secondary info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Car className="w-3 h-3 inline mr-1" />VEHICLE
                    </span>
                    <span className="text-xs text-foreground">
                      {inv.vehicleInfo || <span className="italic text-foreground/30">No vehicle on invoice</span>}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Hash className="w-3 h-3 inline mr-1" />SOURCE
                    </span>
                    <span className="text-xs text-foreground/70 uppercase">
                      {inv.source || "manual"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Calendar className="w-3 h-3 inline mr-1" />DATE
                    </span>
                    <span className="text-xs text-foreground/70">
                      {new Date(inv.invoiceDate).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                </div>

                {/* Cost breakdown */}
                <div>
                  <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-2">
                    <DollarSign className="w-3 h-3 inline mr-1" />COST BREAKDOWN
                  </span>
                  {(parts > 0 || labor > 0 || tax > 0) ? (
                    <div className="space-y-2">
                      {/* Visual proportion bar */}
                      <div className="flex h-2 bg-foreground/5 overflow-hidden">
                        {parts > 0 && <div className="bg-blue-500/60" style={{ width: `${partsPct}%` }} title={`Parts ${partsPct}%`} />}
                        {labor > 0 && <div className="bg-emerald-500/60" style={{ width: `${laborPct}%` }} title={`Labor ${laborPct}%`} />}
                        {tax > 0 && <div className="bg-amber-500/60" style={{ width: `${taxPct}%` }} title={`Tax ${taxPct}%`} />}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">PARTS</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-blue-400">{parts > 0 ? formatCents(parts) : "—"}</span>
                            {parts > 0 && <span className="text-[9px] text-foreground/40">{partsPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">LABOR</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-emerald-400">{labor > 0 ? formatCents(labor) : "—"}</span>
                            {labor > 0 && <span className="text-[9px] text-foreground/40">{laborPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">TAX</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-amber-400">{tax > 0 ? formatCents(tax) : "—"}</span>
                            {tax > 0 && <span className="text-[9px] text-foreground/40">{taxPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-primary/30 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">TOTAL</span>
                          <span className="font-bold text-base text-primary">{formatCents(total)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-foreground/40 italic">
                      No parts/labor breakdown on this invoice. (ALG returns rolled-up totals only — for the full job/tire breakdown, click "OPEN IN ALG" below.)
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/10">
                  {inv.customerPhone && (
                    <>
                      <a
                        href={`tel:${inv.customerPhone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors"
                      >
                        <Phone className="w-3 h-3" /> CALL
                      </a>
                      <MessageCustomerLink
                        phone={inv.customerPhone}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                        title="Open in-admin SMS chat"
                      >
                        <MessageSquare className="w-3 h-3" /> SMS
                      </MessageCustomerLink>
                    </>
                  )}
                  <a
                    href={inv.algTicketId
                      ? `https://secure.autolaborexperts.com/ticket/${inv.algTicketId}`
                      : "https://secure.autolaborexperts.com/recent"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-purple-500/20 text-purple-400 hover:bg-purple-500/5 transition-colors"
                    title={inv.algTicketId
                      ? "Opens this ticket directly in ALG (full job/labor/parts breakdown)"
                      : "Opens ALG Recent Tickets — search for this invoice number"}
                  >
                    <ExternalLink className="w-3 h-3" /> OPEN IN ALG
                  </a>
                </div>
              </div>
            )}
            </React.Fragment>
            );
          })}
          <div className="text-center py-2">
            <span className="font-mono text-[9px] text-foreground/20">{data?.total ?? 0} total invoices</span>
          </div>
        </div>
      )}
    </div>
  );
}

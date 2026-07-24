/**
 * UnpaidInvoicesSection — actionable queue of issued invoices still awaiting
 * payment (pending / partial), highest balance first. Read-only surface:
 * call or text the customer. Pairs with the #241 moneySummary fix that made
 * `unpaidInvoicesSum` real — this turns that number into a worklist.
 *
 * Intentionally NO automated outreach here (that's a separate, flag-gated
 * step). CALL/SMS are operator-initiated per row, mirroring DeclinedEstimates.
 */
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { StatCard, LoadingState } from "../shared";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import { DollarSign, Phone, MessageSquare, Clock, Receipt } from "lucide-react";

type UnpaidInvoice = RouterOutputs["invoices"]["unpaidList"]["items"][number];

export default function UnpaidInvoicesSection() {
  const { data, isLoading, isError, error } = trpc.invoices.unpaidList.useQuery();
  const items = data?.items ?? [];
  const totalOwed = Math.round((data?.totalCents ?? 0) / 100);
  const count = items.length;
  const avg = count > 0 ? Math.round(totalOwed / count) : 0;
  /**
   * UNKNOWN IS NOT ZERO. A failed read used to fall through `?? []` / `?? 0`
   * into "$0 owed · Everything issued has been paid" — the single worst
   * false-green in this admin: money you are owed, reported as collected,
   * exactly when the system can't see it.
   */
  const unknown = isError;

  return (
    <div className="space-y-6">
      {unknown && (
        <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
          <strong>Unpaid invoices could not be read.</strong> The numbers below are unknown — NOT zero, and nothing here means you have been paid. {error?.message}
        </div>
      )}
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="UNPAID INVOICES"
          value={unknown ? "—" : count}
          icon={<Receipt className="w-4 h-4" />}
          color={count > 0 ? "text-amber-400" : "text-foreground"}
        />
        <StatCard
          label="TOTAL OWED"
          value={unknown ? "—" : `$${totalOwed.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
          color={unknown ? "text-amber-400" : "text-emerald-400"}
        />
        <StatCard
          label="AVG INVOICE"
          value={unknown ? "—" : `$${avg.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-bold text-xl text-foreground tracking-wider">UNPAID INVOICES</h2>
        <span className="text-[11px] text-foreground/40">Highest balance first · pending + partial</span>
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState label="Loading unpaid invoices..." />
      ) : unknown ? (
        <div className="text-center py-12 text-amber-400/80">
          <p className="text-[13px]">The worklist is unavailable — retry before trusting any collection state.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Receipt className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No unpaid invoices. Everything issued has been paid.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((inv: UnpaidInvoice) => {
            const daysOld = Math.floor(
              (Date.now() - new Date(inv.invoiceDate).getTime()) / (1000 * 60 * 60 * 24),
            );
            const amount = Math.round((inv.totalAmount || 0) / 100);
            const isPartial = inv.paymentStatus === "partial";
            const isStale = daysOld >= 30;
            const firstName = inv.customerName?.split(" ")[0] || "";

            return (
              <div
                key={inv.id}
                className={`bg-card border p-4 flex items-center gap-4 flex-wrap transition-colors ${
                  isStale ? "border-red-500/20" : "border-border/30"
                }`}
              >
                {/* Customer + meta */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-sm tracking-wider">
                      {inv.customerName}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 font-semibold ${
                        isPartial ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {isPartial ? "PARTIAL" : "PENDING"}
                    </span>
                    {isStale && (
                      <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 font-semibold">
                        30D+ OVERDUE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-foreground/40 text-xs flex-wrap">
                    {inv.customerPhone && (
                      <a
                        href={`tel:${inv.customerPhone}`}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        <Phone className="w-3 h-3" />
                        {inv.customerPhone}
                      </a>
                    )}
                    {inv.invoiceNumber && <span>#{inv.invoiceNumber}</span>}
                    {inv.vehicleInfo && <span>{inv.vehicleInfo}</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {daysOld === 0 ? "Today" : `${daysOld}d ago`}
                    </span>
                  </div>
                  {inv.serviceDescription && (
                    <p className="text-[12px] text-foreground/30 mt-1 line-clamp-1">
                      {inv.serviceDescription}
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <span className="font-bold text-lg text-foreground">${amount.toLocaleString()}</span>
                  <p className="text-[10px] text-foreground/30">{isPartial ? "balance" : "owed"}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {inv.customerPhone && (
                    <a
                      href={`tel:${inv.customerPhone}`}
                      aria-label="Call customer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold tracking-wide border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      CALL
                    </a>
                  )}
                  {inv.customerPhone && (
                    <MessageCustomerLink
                      phone={inv.customerPhone}
                      body={`Hi ${firstName}, this is Nick's Tire & Auto. We have an open balance on your invoice${inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ""}. You can take care of it over the phone at (216) 862-0005 or stop by anytime — thanks!`}
                      ariaLabel="Send text message via in-admin SMS chat"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-[11px] font-bold tracking-wide border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                    >
                      <MessageSquare className="w-3 h-3" />
                      SMS
                    </MessageCustomerLink>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

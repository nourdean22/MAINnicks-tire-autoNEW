/**
 * SnapDashboardSection — Snap Finance application manager.
 *
 * Lists recent applications (submitted via POST /api/snap/application).
 * Shows status pills, amount, customer info, link to Snap portal.
 * Status history timeline per row.
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PageHeader, LoadingState, ErrorState } from "../shared";
import { timeAgoShort as timeAgo } from "../shared/format";
// wave-181.x Money Phase 1 · H1 fix · confirmDialog gate on Snap
// submission. Real $-affecting external API call (triggers Snap
// credit pull · shop is charged per app · cannot be undone).
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  CreditCard, ExternalLink, CheckCircle2, XCircle, Clock,
  User, Phone, Car, DollarSign, Plus, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  approved:  { color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" />, label: "APPROVED" },
  declined:  { color: "text-red-400",     bgColor: "bg-red-500/10 border-red-500/30",         icon: <XCircle className="w-3 h-3" />,      label: "DECLINED" },
  rejected:  { color: "text-red-400",     bgColor: "bg-red-500/10 border-red-500/30",         icon: <XCircle className="w-3 h-3" />,      label: "DECLINED" },
  pending:   { color: "text-amber-400",   bgColor: "bg-amber-500/10 border-amber-500/30",     icon: <Clock className="w-3 h-3" />,         label: "PENDING" },
};

function statusCfg(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
}

export default function SnapDashboardSection() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.snap.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const summary = trpc.snap.summary.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    amount: "",
    vehicle: "",
    service: "",
  });

  const submit = trpc.snap.submit.useMutation({
    onSuccess: (r) => {
      toast.success(r.proxyUsed
        ? `Submitted to Snap (${r.externalApplicationId ?? "pending id"})`
        : "Logged locally (Snap API not configured)");
      setShowForm(false);
      setForm({ customerName: "", customerPhone: "", customerEmail: "", amount: "", vehicle: "", service: "" });
      // wave-143 — invalidate cache instead of refetch() so any sibling
      // component subscribed to snap.list/summary also updates (cache
      // coherence). Pattern used everywhere else in the codebase.
      void utils.snap.list.invalidate();
      void utils.snap.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // wave-181.x Money Phase 1 · M5 fix · Number("1.2.3") = NaN slips
    // past the truthy check on form.amount. iOS paste can bypass
    // type="number" so guard explicitly. NaN serializes to null
    // mid-flight and corrupts the Snap payload.
    let parsedAmount: number | undefined;
    if (form.amount) {
      const n = Number(form.amount);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Invalid amount · enter a positive number");
        return;
      }
      parsedAmount = n;
    }

    // wave-181.x Money Phase 1 · H1 fix · code-review agent flagged
    // this as critical. Snap submission fires a real external API
    // call · triggers a credit pull on the customer · shop is
    // charged per submitted app. One-tap fat-finger on a touch
    // device was un-gated. confirmDialog is iOS-PWA-safe.
    const ok = await confirmDialog({
      title: `Submit Snap application for ${form.customerName || "this customer"}?`,
      message: `This sends a REAL application to Snap Finance · triggers a credit pull · cannot be undone. ${parsedAmount ? `Amount: $${parsedAmount.toLocaleString()}.` : ""}`,
      confirmLabel: "Submit to Snap",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;

    submit.mutate({
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerEmail: form.customerEmail || undefined,
      amount: parsedAmount,
      vehicle: form.vehicle || undefined,
      service: form.service || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Snap Finance"
        subtitle="Lease-to-own application dashboard. Submit, track, link to Snap portal."
        icon={<CreditCard className="w-5 h-5" />}
        badge={summary.data ? {
          label: `${summary.data.approved} approved · ${summary.data.pending} pending · ${summary.data.declined} declined`,
          variant: summary.data.pending > 0 ? "warning" : "neutral",
        } : undefined}
        actions={
          <>
            <a
              href="https://portal.snapfinance.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Snap Portal
            </a>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-bold"
            >
              <Plus className="w-3.5 h-3.5" />
              {showForm ? "Cancel" : "New Application"}
            </button>
          </>
        }
      />

      {/* Summary cards */}
      {summary.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="border border-border/30 bg-card/50 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total</div>
            <div className="font-mono font-black text-2xl text-foreground">{summary.data.total}</div>
          </div>
          <div className="border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">Pending</div>
            <div className="font-mono font-black text-2xl text-amber-400">{summary.data.pending}</div>
          </div>
          <div className="border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-widest text-emerald-400">Approved</div>
            <div className="font-mono font-black text-2xl text-emerald-400">{summary.data.approved}</div>
            <div className="text-[10px] text-emerald-400/70 font-mono mt-0.5">
              ${summary.data.totalApprovedAmount.toLocaleString()}
            </div>
          </div>
          <div className="border border-red-500/30 bg-red-500/5 p-3">
            <div className="text-[10px] uppercase tracking-widest text-red-400">Declined</div>
            <div className="font-mono font-black text-2xl text-red-400">{summary.data.declined}</div>
          </div>
        </div>
      )}

      {/* Submission form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border border-border/30 bg-card/50 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Customer name *"
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="Phone *"
                  value={form.customerPhone}
                  onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={form.customerEmail}
                  onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="1"
                  min="0"
                  placeholder="Amount requested ($)"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Vehicle (year make model)"
                  value={form.vehicle}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Service"
                  value={form.service}
                  onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                  className="bg-background/50 border border-border/30 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-xs px-3 py-2 bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submit.isPending}
                  className="text-xs px-4 py-2 bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {submit.isPending ? "Submitting…" : "Submit Application"}
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Applications list */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message="Couldn't load Snap applications" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <div className="border border-border/30 bg-card/50 p-10 text-center">
          <CreditCard className="w-8 h-8 mx-auto mb-3 text-muted-foreground/60" />
          <h3 className="text-sm font-bold">No Snap applications yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Submit one above or route customers through the Snap Finance flow.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((app) => {
            const cfg = statusCfg(app.status);
            return (
              <div key={app.id} className={`border bg-card/50 p-4 ${cfg.bgColor}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${cfg.color}`}>
                    {cfg.icon}
                    {cfg.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 font-bold text-sm text-foreground">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        {app.customerName}
                      </span>
                      <a
                        href={`tel:${app.customerPhone}`}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="w-3 h-3" />
                        {app.customerPhone}
                      </a>
                      {app.amount && (
                        <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                          <DollarSign className="w-3 h-3" />
                          {app.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      {app.vehicle && (
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" /> {app.vehicle}
                        </span>
                      )}
                      {app.service && <span>· {app.service}</span>}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo(app.submittedAt)}
                      </span>
                      {app.externalApplicationId && (
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                          #{app.externalApplicationId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {app.statusHistory.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                      Status history ({app.statusHistory.length})
                    </summary>
                    <ul className="mt-2 space-y-1 text-[11px] pl-4">
                      {app.statusHistory.map((h, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${statusCfg(h.status).color}`}>
                            {statusCfg(h.status).label}
                          </span>
                          <span className="text-muted-foreground">{timeAgo(h.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

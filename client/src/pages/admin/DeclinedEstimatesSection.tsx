/**
 * DeclinedEstimatesSection — Recovery pipeline for estimates that didn't convert.
 * Shows pending invoices (walked-away customers), total recoverable revenue,
 * and one-click follow-up actions.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard } from "./shared";
import {
  Loader2, AlertTriangle, DollarSign, Phone, MessageSquare,
  TrendingUp, Clock, Filter,
} from "lucide-react";

type TimeFilter = "7" | "30" | "all";

export default function DeclinedEstimatesSection() {
  const [filter, setFilter] = useState<TimeFilter>("30");
  const days = filter === "all" ? 365 : Number(filter);

  const { data, isLoading } = trpc.invoices.declined.useQuery({ days });
  const utils = trpc.useUtils();

  const markFollowUp = trpc.invoices.markFollowUp.useMutation({
    onSuccess: () => {
      utils.invoices.declined.invalidate();
      toast.success("Follow-up scheduled");
    },
    onError: (err) => toast.error(err.message),
  });

  const estimates = data?.estimates ?? [];
  const total = data?.total ?? 0;
  const recoverable = data?.recoverable ?? 0;
  const recoveryRate = data?.recoveryRate ?? 0;
  const avgEstimate = total > 0 ? Math.round(recoverable / total) : 0;

  return (
    <div className="space-y-6">
      {/* Urgency Banner */}
      <div className="bg-amber-500/10 border border-amber-500/20 px-5 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-300 text-sm tracking-wide">RECOVERY PIPELINE</p>
            <p className="text-foreground/60 text-[13px] mt-1 leading-relaxed">
              Car problems rarely stay the same. They usually get worse.
              Every estimate below is a customer who left with a known problem. Follow up before they go somewhere else.
            </p>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="DECLINED ESTIMATES"
          value={total}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={total > 0 ? "text-amber-400" : "text-foreground"}
        />
        <StatCard
          label="RECOVERABLE REVENUE"
          value={`$${recoverable.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
          color="text-emerald-400"
        />
        <StatCard
          label="RECOVERY RATE"
          value={`${recoveryRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          color={recoveryRate >= 30 ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard
          label="AVG ESTIMATE"
          value={`$${avgEstimate.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Filter + Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">DECLINED WORK</h2>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-foreground/40" />
          {(["7", "30", "all"] as TimeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/5 text-foreground/50 hover:text-foreground"
              }`}
            >
              {f === "7" ? "7 DAYS" : f === "30" ? "30 DAYS" : "ALL"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : estimates.length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <DollarSign className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No declined estimates in this period. Every estimate converted.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {estimates.map((est: any) => {
            const daysOld = Math.floor(
              (Date.now() - new Date(est.invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
            );
            const amount = Math.round((est.totalAmount || 0) / 100);
            const isFollowUp = est.paymentStatus === "partial";
            const isUrgent = daysOld <= 7;
            const isStale = daysOld >= 21;

            return (
              <div
                key={est.id}
                className={`bg-card border p-4 flex items-center gap-4 flex-wrap ${
                  isUrgent
                    ? "border-amber-500/30"
                    : isStale
                    ? "border-red-500/20"
                    : "border-border/30"
                }`}
              >
                {/* Customer Info */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-sm tracking-wider">
                      {est.customerName}
                    </span>
                    {isFollowUp && (
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 font-semibold">
                        FOLLOW-UP
                      </span>
                    )}
                    {isUrgent && !isFollowUp && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 font-semibold">
                        HOT LEAD
                      </span>
                    )}
                    {isStale && (
                      <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 font-semibold">
                        GOING COLD
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-foreground/40 text-xs flex-wrap">
                    {est.customerPhone && (
                      <a
                        href={`tel:${est.customerPhone}`}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        <Phone className="w-3 h-3" />
                        {est.customerPhone}
                      </a>
                    )}
                    {est.vehicleInfo && <span>{est.vehicleInfo}</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {daysOld === 0 ? "Today" : `${daysOld}d ago`}
                    </span>
                  </div>
                  {est.serviceDescription && (
                    <p className="text-[12px] text-foreground/30 mt-1 line-clamp-1">
                      {est.serviceDescription}
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <span className="font-bold text-lg text-foreground">${amount.toLocaleString()}</span>
                  <p className="text-[10px] text-foreground/30">estimated</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {est.customerPhone && (
                    <a
                      href={`tel:${est.customerPhone}`}
                      aria-label="Call customer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold tracking-wide border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      CALL
                    </a>
                  )}
                  {est.customerPhone && (
                    <a
                      href={`sms:${est.customerPhone}?body=Hi ${est.customerName?.split(" ")[0] || ""}, this is Nick's Tire %26 Auto following up on your recent estimate. Car problems usually get worse over time - ready to take care of it? Call us at (216) 862-0005 or just stop by.`}
                      aria-label="Send text message"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-[11px] font-bold tracking-wide border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                    >
                      <MessageSquare className="w-3 h-3" />
                      SMS
                    </a>
                  )}
                  {!isFollowUp && (
                    <button
                      onClick={() => markFollowUp.mutate({ id: est.id })}
                      disabled={markFollowUp.isPending}
                      aria-label="Mark follow-up"
                      className="px-3 py-1.5 bg-primary/10 text-primary text-[11px] font-bold tracking-wide border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      MARK FOLLOW-UP
                    </button>
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

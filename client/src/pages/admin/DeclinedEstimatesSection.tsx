/**
 * DeclinedEstimatesSection — Recovery pipeline for estimates that didn't convert.
 * Shows pending invoices (walked-away customers), total recoverable revenue,
 * and one-click follow-up actions.
 */
import { useState, useMemo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";

type DeclinedEstimate = NonNullable<RouterOutputs["invoices"]["declined"]>["estimates"][number];
import { StatCard, PageHeader, SectionInsightStrip, useUrlFilter, FilterChips } from "./shared";
import {
  Loader2, AlertTriangle, DollarSign, Phone, MessageSquare,
  TrendingUp, Clock, Filter, Flame,
} from "lucide-react";

type TimeFilter = "7" | "30" | "all";
type SortMode = "amount" | "date" | "score";

/**
 * Recovery score: rank declined estimates by composite signal.
 * Higher score = higher priority follow-up target.
 *
 * Components:
 *  - Amount: bigger $$$ = more upside (logarithmic so $1K isn't 100x $10)
 *  - Age decay: newer = warmer prospect (linear decay over 60 days)
 *  - Follow-up state: not-yet-followed-up gets a boost
 *  - Days till stale: 7d-21d window is the sweet spot
 */
function recoveryScore(est: DeclinedEstimate): number {
  const amount = (est.totalAmount || 0) / 100;
  const daysOld = Math.floor(
    (Date.now() - new Date(est.invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Amount weight: log scale so $200 estimate isn't drowned by $2000
  const amountScore = Math.log10(Math.max(amount, 10)) * 30;

  // Age decay: 100 at day 0, drops to 0 at day 60
  const ageScore = Math.max(0, 100 - (daysOld * 100) / 60);

  // Sweet spot bonus: 7d-21d follow-up window
  const sweetSpotBonus = daysOld >= 7 && daysOld <= 21 ? 25 : 0;

  // Not-yet-followed-up boost
  const status = est.paymentStatus;
  const notFollowedBonus = status === "pending" ? 30 : 0;
  const stalePenalty = status === "30d-sent" ? -40 : 0;

  return amountScore + ageScore + sweetSpotBonus + notFollowedBonus + stalePenalty;
}

export default function DeclinedEstimatesSection() {
  // URL-persistent ?range=7|30|all (default 30 not written to URL)
  const [filter, setFilter] = useUrlFilter<TimeFilter>(
    "range", "30",
    { validate: (v) => (v === "7" || v === "30" || v === "all" ? v : null) },
  );
  const days = filter === "all" ? 365 : Number(filter);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [minAmount, setMinAmount] = useState<number>(0);

  const { data, isLoading } = trpc.invoices.declined.useQuery({ days });
  const utils = trpc.useUtils();

  const markFollowUp = trpc.invoices.markFollowUp.useMutation({
    onSuccess: () => {
      utils.invoices.declined.invalidate();
      toast.success("Follow-up scheduled");
    },
    onError: (err) => toast.error(err.message),
  });

  const rawEstimates = data?.estimates ?? [];
  const total = data?.total ?? 0;
  const recoverable = data?.recoverable ?? 0;
  const recoveryRate = data?.recoveryRate ?? 0;
  const avgEstimate = total > 0 ? Math.round(recoverable / total) : 0;

  // Wave-100: sort + amount-threshold filter for high-leverage targeting
  const estimates = useMemo(() => {
    const minCents = minAmount * 100;
    const filtered = minCents > 0
      ? rawEstimates.filter((e: DeclinedEstimate) => (e.totalAmount ?? 0) >= minCents)
      : rawEstimates;
    if (sortMode === "amount") {
      return filtered.slice().sort((a: DeclinedEstimate, b: DeclinedEstimate) =>
        (b.totalAmount ?? 0) - (a.totalAmount ?? 0)
      );
    }
    if (sortMode === "score") {
      return filtered.slice().sort((a: DeclinedEstimate, b: DeclinedEstimate) =>
        recoveryScore(b) - recoveryScore(a)
      );
    }
    return filtered; // date order from backend
  }, [rawEstimates, sortMode, minAmount]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Declined Work"
        subtitle="ALG estimates that didn't convert + work-order line items the customer said no to. Recovery pipeline targets these via 7d/30d SMS."
        icon={<AlertTriangle className="w-5 h-5" />}
      />
      <SectionInsightStrip section="declinedEstimates" />
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

      {/* Filter + Sort + Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-bold text-xl text-foreground tracking-wider">DECLINED WORK</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Time range */}
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-foreground/30 mr-0.5" />
            {(["7", "30", "all"] as TimeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-bold tracking-wide transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-foreground/5 text-foreground/50 hover:text-foreground"
                }`}
              >
                {f === "7" ? "7D" : f === "30" ? "30D" : "ALL"}
              </button>
            ))}
          </div>
          {/* Sort mode */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-foreground/30 tracking-wider uppercase mr-0.5">Sort</span>
            {(["score", "amount", "date"] as SortMode[]).map((s) => (
              <button
                key={s}
                onClick={() => setSortMode(s)}
                className={`px-2.5 py-1 text-[10px] font-bold tracking-wide transition-colors ${
                  sortMode === s
                    ? s === "score" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : s === "amount" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "bg-foreground/5 text-foreground/50 hover:text-foreground"
                }`}
              >
                {s === "score" ? "🔥 SCORE" : s === "amount" ? "$ AMT" : "DATE"}
              </button>
            ))}
          </div>
          {/* Min amount */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-foreground/30 tracking-wider uppercase mr-0.5">Min $</span>
            {[0, 250, 500, 1000].map((m) => (
              <button
                key={m}
                onClick={() => setMinAmount(m)}
                className={`px-2.5 py-1 text-[10px] font-bold tracking-wide transition-colors ${
                  minAmount === m
                    ? "bg-foreground/10 text-foreground border border-foreground/20"
                    : "bg-foreground/5 text-foreground/50 hover:text-foreground"
                }`}
              >
                {m === 0 ? "ANY" : `$${m}+`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter result counter */}
      {(minAmount > 0 || sortMode !== "date") && (
        <div className="text-[10px] text-foreground/40 tracking-wider">
          Showing {estimates.length} of {rawEstimates.length} declined estimates
          {sortMode === "score" && " · sorted by recovery score (amount × age × not-followed-up bonus)"}
          {sortMode === "amount" && " · sorted by amount descending"}
          {minAmount > 0 && ` · filtered to $${minAmount}+`}
        </div>
      )}

      {/* Active Filter Chips — auto-hides when range is at default */}
      <FilterChips
        chips={[
          {
            label: "Range",
            value: filter,
            default: "30",
            onClear: () => setFilter("30"),
            displayValue: filter === "7" ? "7 days" : filter === "all" ? "All time" : "30 days",
          },
        ]}
        onClearAll={() => setFilter("30")}
      />

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
          {estimates.map((est: DeclinedEstimate) => {
            const daysOld = Math.floor(
              (Date.now() - new Date(est.invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
            );
            const amount = Math.round((est.totalAmount || 0) / 100);
            const isFollowUp = est.paymentStatus === "partial";
            const isUrgent = daysOld <= 7;
            const isStale = daysOld >= 21;
            const score = Math.round(recoveryScore(est));
            const isHotPriority = sortMode === "score" && score >= 150;

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
                    {isHotPriority && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 font-semibold border border-amber-500/30 flex items-center gap-1" title="High recovery score — prioritize this lead">
                        <Flame className="w-2.5 h-2.5" /> SCORE {score}
                      </span>
                    )}
                    {!isHotPriority && sortMode === "score" && (
                      <span className="text-[10px] bg-foreground/5 text-foreground/40 px-1.5 py-0.5 font-mono">
                        {score}
                      </span>
                    )}
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

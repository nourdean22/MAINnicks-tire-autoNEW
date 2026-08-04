/**
 * DeclinedEstimatesSection — Recovery pipeline for estimates that didn't convert.
 * Shows pending invoices (walked-away customers), total recoverable revenue,
 * and one-click follow-up actions.
 */
import { useState, useMemo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";

type DeclinedEstimate = NonNullable<RouterOutputs["invoices"]["declined"]>["estimates"][number];
import { StatCard, PageHeader, SectionInsightStrip, useUrlFilter, FilterChips, LoadingState } from "../shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
// wave-181.x Money Phase 2 · shared daily-burn helpers · code-review
// agent M4 fix (DAILY_DECAY_RATE was duplicated between MoneyBrief
// and this file) + #3 fix (anchor burn on aged ≥7d-old estimates only).
import { agedRecoverableDollars, dailyBurnDollars } from "./moneyMath";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import {
  Loader2, AlertTriangle, DollarSign, Phone, MessageSquare,
  TrendingUp, Clock, Filter, Flame, CheckSquare, Square, Send, Zap, X,
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
    { validate: (v: string) => (v === "7" || v === "30" || v === "all" ? (v as TimeFilter) : null) },
  );
  const days = filter === "all" ? 365 : Number(filter);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [minAmount, setMinAmount] = useState<number>(0);

  // Wave-101: bulk SMS multi-select
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data, isLoading, isError, error } = trpc.invoices.declined.useQuery({ days });
  /**
   * ROS-083 · UNKNOWN IS NOT ZERO.
   *
   * A failed read fell through `?? 0` into "$0 RECOVERABLE" on an emerald card,
   * while the aged-money banner below SELF-HID (it returns null on
   * `agedDollars <= 0`). So the surface actively asserted "there is no declined
   * money to chase" at exactly the moment it could not see any. Same idiom as
   * money/UnpaidInvoicesSection.tsx:29 — em dash on the cards, amber banner
   * above, and the genuine `0` (a real counted zero) left alone.
   */
  const unknown = isError;
  const utils = trpc.useUtils();

  const bulkFollowUpMutation = trpc.invoices.bulkFollowUp.useMutation({
    onSuccess: (result) => {
      const failedReasons = result.results
        .filter(r => !r.sent)
        .reduce((acc: Record<string, number>, r) => {
          const k = r.reason || "unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
      const reasonStr = Object.entries(failedReasons).map(([k, v]) => `${v} ${k}`).join(", ");
      if (result.killSwitchOn) {
        toast.error(`SMS_KILL_SWITCH is on — 0 sent. Flip the env var on Railway when Twilio is back.`);
      } else if (result.sentCount > 0) {
        toast.success(`Sent ${result.sentCount} of ${result.sentCount + result.failedCount}${reasonStr ? ` (${reasonStr})` : ""}`);
      } else {
        toast.error(`0 sent · failures: ${reasonStr}`);
      }
      setSelectedIds(new Set());
      setBulkMode(false);
      utils.invoices.declined.invalidate();
    },
    onError: (err) => toast.error(`Bulk SMS failed: ${err.message}`),
  });

  const markFollowUp = trpc.invoices.markFollowUp.useMutation({
    onSuccess: () => {
      utils.invoices.declined.invalidate();
      toast.success("Follow-up scheduled");
    },
    onError: (err) => toast.error(err.message),
  });

  // wave-181.79 · "FIRE ALL ELIGIBLE NOW" trigger.
  // Calls runDeclinedWorkRecovery() server-side with operator-driven
  // opts (bypasses business-hours + dry-run-flag gates · the per-message
  // sending-hours guard in sms.ts still queues out-of-window). Pre-fix
  // the operator had to either SSH into Railway to run the script or
  // flip FEATURE_DECLINED_RECOVERY=1 and wait for the daily cron.
  // Now: one click + confirm modal · 60-90s to drain.
  const runRecoveryNow = trpc.invoices.runDeclinedRecoveryNow.useMutation({
    onSuccess: (result) => {
      if (result.killSwitchOn) {
        toast.error("SMS_KILL_SWITCH=true — aborted before any sends. Flip it on Railway to enable.");
      } else if (result.recordsProcessed > 0) {
        toast.success(`Recovery fired · ${result.recordsProcessed} attempted · ${result.details || "see admin logs"}`);
      } else {
        toast.info(`Recovery ran · 0 sent · ${result.details || "nothing eligible right now"}`);
      }
      utils.invoices.declined.invalidate();
    },
    onError: (err) => toast.error(`Recovery trigger failed: ${err.message}`),
  });

  // wave-115b — permanent dismiss for declined estimates the operator
  // has worked through (customer said no for good, vehicle sold, etc.).
  // Stored in shop_settings JSON so it persists across syncs without
  // a schema migration.
  const dismissEstimate = trpc.invoices.dismissEstimate.useMutation({
    onSuccess: () => {
      utils.invoices.declined.invalidate();
      toast.success("Estimate dismissed — won't appear in the queue again");
    },
    onError: (err) => toast.error(err.message.slice(0, 120)),
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

  // wave-admin-audit D2 — the "🔥 SCORE" hot badge fired on ~85% of rows
  // because the absolute >=150 cut sat below the live 130-225 score band,
  // so almost everything lit up (no signal). Relative top-quartile cut
  // instead: only the highest-scoring 25% of the *visible* rows get the
  // flame. Self-adjusts as the distribution drifts (no magic constant to
  // re-tune). Only meaningful when sorted by score; 0 rows → no threshold.
  const hotScoreThreshold = useMemo(() => {
    if (sortMode !== "score" || estimates.length === 0) return Infinity;
    const scores = estimates
      .map((e: DeclinedEstimate) => recoveryScore(e))
      .sort((a: number, b: number) => b - a);
    // 75th percentile — index into the descending-sorted scores.
    const idx = Math.floor(scores.length * 0.25);
    return scores[Math.min(idx, scores.length - 1)];
  }, [estimates, sortMode]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Declined Work"
        subtitle="ALG estimates that didn't convert + work-order line items the customer said no to. Recovery pipeline targets these via 7d/30d SMS."
        icon={<AlertTriangle className="w-5 h-5" />}
      />
      <SectionInsightStrip section="declinedEstimates" />
      {/* wave-181.x Money Phase 2 · loss-aversion-designer steal
       * (DFII 9.0 per skill-mining agent). Quantitative daily-burn
       * banner replaces the qualitative "car problems get worse"
       * urgency block. 30-day half-life implies ~2.28% per-day
       * recovery-probability decay · loss-aversion-designer rule
       * "verify the scarcity is real" — so we anchor on AGED
       * estimates (≥7d old) only · fresh leads don't decay yet ·
       * including them was alarmist (code-review agent #3 catch).
       * Banner self-hides when no aged work pending (clarity-gate). */}
      {unknown && (
        <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
          <strong>Declined work could not be read.</strong> The numbers below are unknown — NOT zero, and nothing here means there is no money to recover. {error?.message}
        </div>
      )}

      {(() => {
        // Never render the aged-money urgency block off an unknown read — its
        // self-hiding null IS the false all-clear, so the banner above covers it.
        if (unknown) return null;
        const agedDollars = agedRecoverableDollars(rawEstimates);
        if (agedDollars <= 0) return null;
        const burn = dailyBurnDollars(agedDollars);
        return (
          <div className="bg-amber-500/10 border border-amber-500/20 px-5 py-4 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-300 text-sm tracking-wide">
                  ${agedDollars.toLocaleString()} idle in ≥7d-old declined work
                </p>
                <p className="text-foreground/60 text-[13px] mt-1 leading-relaxed">
                  Burning ~<span className="text-amber-300 font-semibold">${burn.toLocaleString()}/day</span> in recovery probability at a 30-day half-life.
                  Each aged estimate below is a customer who left with a known problem · the longer it sits the colder it gets.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stat Cards — wave-127 — clickable filters. DECLINED → all
          (clears time filter), RECOVERABLE → sort by $, AVG → sort by $.
          Recovery Rate stays display-only (it's an aggregate readout,
          not a filterable dimension). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="DECLINED ESTIMATES"
          value={unknown ? "—" : total}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={!unknown && total > 0 ? "text-amber-400" : "text-foreground"}
          onClick={() => { setFilter("all"); setSortMode("date"); setMinAmount(0); }}
        />
        <StatCard
          label="RECOVERABLE REVENUE"
          value={unknown ? "—" : `$${recoverable.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
          // Emerald on an unreadable value is the false-green itself.
          color={unknown ? "text-foreground" : "text-emerald-400"}
          onClick={() => { setFilter("all"); setSortMode("amount"); }}
        />
        <StatCard
          label="RECOVERY RATE"
          value={unknown ? "—" : `${recoveryRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          color={unknown ? "text-foreground" : recoveryRate >= 30 ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard
          label="AVG ESTIMATE"
          value={unknown ? "—" : `$${avgEstimate.toLocaleString()}`}
          icon={<DollarSign className="w-4 h-4" />}
          onClick={() => setSortMode("amount")}
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
                className={`px-3 py-2 text-[11px] font-bold tracking-wide transition-colors ${
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
                className={`px-3 py-2 text-[11px] font-bold tracking-wide transition-colors ${
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
                className={`px-3 py-2 text-[11px] font-bold tracking-wide transition-colors ${
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

      {/* Wave-101: bulk action toolbar
          wave-181.79 · added FIRE ALL ELIGIBLE NOW button (left of
          BULK SELECT) · operator one-click trigger for the cron flow */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-card border border-border/30 px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Fire declined-recovery NOW?",
                message:
                  "Runs the same logic as the daily cron · attempts up to 100 sends · " +
                  "at-most-once protected · TCPA opt-out enforced · 8AM-8PM ET window guard " +
                  "queues out-of-window sends. Typically completes in 60-90 seconds. " +
                  "Skips the FEATURE_DECLINED_RECOVERY env flag (operator click = explicit consent).",
                confirmLabel: "Fire recovery",
                tone: "danger",
              });
              if (!ok) return;
              runRecoveryNow.mutate({ maxSends: 100 });
            }}
            disabled={runRecoveryNow.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider font-bold bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
            title="One-click: fire the daily cron's recovery flow right now (skips the env gate)"
          >
            {runRecoveryNow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flame className="w-3 h-3" />}
            {runRecoveryNow.isPending ? "FIRING..." : "🔥 FIRE ALL ELIGIBLE NOW"}
          </button>
          <button
            onClick={() => {
              setBulkMode(!bulkMode);
              if (bulkMode) setSelectedIds(new Set());
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider font-bold transition-colors ${
              bulkMode
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-foreground/5 text-foreground/60 border border-border/30 hover:text-foreground"
            }`}
          >
            {bulkMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            {bulkMode ? "EXIT BULK" : "BULK SELECT"}
          </button>
          {bulkMode && (
            <>
              <button
                onClick={() => {
                  // Auto-select top 10 by current sort (which defaults to SCORE)
                  const top10 = estimates.slice(0, 10).map((e: DeclinedEstimate) => e.id);
                  setSelectedIds(new Set(top10));
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider font-bold bg-foreground/5 text-foreground/60 border border-border/30 hover:text-foreground"
              >
                <Zap className="w-3 h-3" /> SELECT TOP 10
              </button>
              <button
                onClick={() => setSelectedIds(new Set(estimates.slice(0, 25).map((e: DeclinedEstimate) => e.id)))}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider font-bold bg-foreground/5 text-foreground/60 border border-border/30 hover:text-foreground"
              >
                <Zap className="w-3 h-3" /> TOP 25
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-[10px] tracking-wider font-bold text-foreground/40 hover:text-foreground/70"
              >
                CLEAR
              </button>
            </>
          )}
        </div>
        {bulkMode && selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-foreground/50">
              {selectedIds.size} selected · ${estimates
                .filter((e: DeclinedEstimate) => selectedIds.has(e.id))
                .reduce((s: number, e: DeclinedEstimate) => s + Math.round((e.totalAmount || 0) / 100), 0)
                .toLocaleString()} potential recovery
            </span>
            <button
              onClick={async () => {
                // wave-139 — was native confirm(); now ConfirmDialog
                // (operator hits this on bulk recovery flows)
                const ok = await confirmDialog({
                  title: `Send 7-day SMS to ${selectedIds.size} customers?`,
                  message: "Twilio rate-limit handling is built in. SMS_KILL_SWITCH is respected.",
                  confirmLabel: "Send SMS batch",
                });
                if (!ok) return;
                bulkFollowUpMutation.mutate({ ids: Array.from(selectedIds), tier: "7d" });
              }}
              disabled={bulkFollowUpMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] tracking-[0.15em] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50 rounded-md"
            >
              {bulkFollowUpMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              SEND 7D SMS
            </button>
          </div>
        )}
        {bulkMode && selectedIds.size === 0 && (
          <span className="text-[10px] text-foreground/30 tracking-wider">
            Tap cards to select · or use SELECT TOP 10/25 above
          </span>
        )}
      </div>

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
        <LoadingState label="Loading declined estimates..." />
      ) : unknown ? (
        // Before the empty state, never after: "Every estimate converted" is the
        // single most confident sentence on this page and it was rendered off a
        // read that failed.
        <div className="text-center py-12 text-amber-400/80">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-[13px]">Declined estimates could not be read — this list is unknown, not empty.</p>
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
            const isHotPriority = sortMode === "score" && recoveryScore(est) >= hotScoreThreshold;
            const isSelected = selectedIds.has(est.id);

            return (
              <div
                key={est.id}
                onClick={() => {
                  if (!bulkMode) return;
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(est.id)) next.delete(est.id);
                    else next.add(est.id);
                    return next;
                  });
                }}
                className={`bg-card border p-4 flex items-center gap-4 flex-wrap transition-colors ${
                  bulkMode
                    ? isSelected
                      ? "border-emerald-500/50 bg-emerald-500/5 cursor-pointer"
                      : "border-border/30 cursor-pointer hover:border-foreground/20"
                    : isUrgent
                    ? "border-amber-500/30"
                    : isStale
                    ? "border-red-500/20"
                    : "border-border/30"
                }`}
              >
                {/* Bulk-mode checkbox */}
                {bulkMode && (
                  <div className="shrink-0">
                    {isSelected
                      ? <CheckSquare className="w-4 h-4 text-emerald-400" />
                      : <Square className="w-4 h-4 text-foreground/30" />
                    }
                  </div>
                )}

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
                      // wave-187 — `isFollowUp` (paymentStatus==="partial") means
                      // the 7-day recovery SMS was ALREADY sent. The old "FOLLOW-UP"
                      // label read as a to-do CTA, so the operator couldn't tell
                      // never-contacted from already-contacted. Past-tense "7D SENT"
                      // matches Customer360Panel's wording.
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 font-semibold">
                        7D SENT
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
                        // wave-181.x Money Phase 1 · audit agent caught
                        // a phantom-click hazard · the row-card has an
                        // onClick toggling bulk-select when bulkMode is
                        // on. Without stopPropagation here, tapping
                        // the phone link both placed the call AND
                        // toggled the selection set silently.
                        onClick={(e) => e.stopPropagation()}
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

                {/* Actions — stopPropagation so they don't trigger card-select */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                    <MessageCustomerLink
                      phone={est.customerPhone}
                      body={`Hi ${est.customerName?.split(" ")[0] || ""}, this is Nick's Tire & Auto following up on your recent estimate. Car problems usually get worse over time — ready to take care of it? Call us at (216) 862-0005 or just stop by.`}
                      ariaLabel="Send text message via in-admin SMS chat"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-[11px] font-bold tracking-wide border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                    >
                      <MessageSquare className="w-3 h-3" />
                      SMS
                    </MessageCustomerLink>
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
                  {/* wave-115b — permanent dismiss (customer said no, vehicle sold, etc.)
                      wave-119 — bumped p-1.5 → p-2.5 + min target so it's
                      tappable on phone (was 20x20, now ~36x36 — close to the
                      44px Apple HIG; balanced against keeping the dismiss
                      visually subordinate to MARK FOLLOW-UP).
                  */}
                  <button
                    onClick={async () => {
                      // wave-181.59 · was native confirm() — broken on iOS
                      // (synchronous-modal freezes React); the rest of this
                      // file already uses confirmDialog (wave-139). This
                      // button was missed in that sweep.
                      const ok = await confirmDialog({
                        title: "Dismiss this estimate?",
                        message: `${est.customerName} · $${Math.round((est.totalAmount ?? 0) / 100)}\n\nIt will be removed from the recovery queue and won't reappear. Use this when the customer has said no for good, the vehicle was sold, or it's a duplicate.`,
                        confirmLabel: "Dismiss permanently",
                        cancelLabel: "Cancel",
                        tone: "danger",
                      });
                      if (ok) {
                        dismissEstimate.mutate({ id: est.id });
                      }
                    }}
                    disabled={dismissEstimate.isPending}
                    aria-label="Dismiss estimate permanently"
                    title="Permanently remove from the recovery queue"
                    className="p-2.5 text-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

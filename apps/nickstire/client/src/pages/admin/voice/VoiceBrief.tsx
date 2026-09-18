import { trpc } from "@/lib/trpc";
import { classifyEvaluationLag } from "./format";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Phone,
  PhoneCall,
  SearchCheck,
  Clock,
  ShieldAlert,
} from "lucide-react";

interface VoiceBriefProps {
  onStuckCallsAction: () => void;
}

function startOfTodayIso(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function formatRate(rate: { numerator: number; denominator: number; percent: number | null }): string {
  return rate.percent == null
    ? `${rate.numerator}/${rate.denominator} · not enough denominator`
    : `${rate.percent}% · ${rate.numerator}/${rate.denominator}`;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function VoiceBrief({ onStuckCallsAction }: VoiceBriefProps) {
  const sinceISO = startOfTodayIso();
  const { data: scorecard, isLoading: scorecardLoading } = trpc.revenueOps.voiceScorecard.useQuery(
    { sinceISO },
    { staleTime: 60_000, refetchInterval: 60_000 },
  );
  const { data: attribution } = trpc.revenueAttribution.leadRevenueSummary.useQuery(
    { sinceISO },
    { staleTime: 60_000, refetchInterval: 60_000 },
  );
  const { data: callReview } = trpc.revenueAttribution.callInvoiceReview.useQuery(
    { sinceISO, maxDays: 14 },
    { staleTime: 60_000, refetchInterval: 60_000 },
  );
  const { data: live, isError: liveError } = trpc.vapi.activeCallStates.useQuery(
    { maxAgeMinutes: 10 },
    { staleTime: 10_000 },
  );

  // A failed live-call query must not pin the whole brief on the shimmer
  // forever (after retries exhaust, `live` stays undefined). Block only
  // while genuinely loading; an errored live slice renders as an explicit
  // "unknown" note in the footer instead.
  if (scorecardLoading || (!live && !liveError)) {
    return (
      <div className="border border-border/40 bg-card p-4">
        <div className="animate-pulse text-[11px] font-bold uppercase tracking-[0.18em] text-foreground/30">
          Loading evidence-backed voice scorecard…
        </div>
      </div>
    );
  }

  if (!scorecard) {
    return (
      <div className="border border-amber-400/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        Voice measurement is unavailable. Legacy conversion cards below may use older definitions.
      </div>
    );
  }

  const counts = scorecard.counts;
  const liveUnknown = liveError || !live;
  const inFlightCount = live?.count ?? 0;
  const stuckCount = live?.byState?.tool_called ?? 0;
  const noVersionedData = counts.versionedCalls === 0;

  /**
   * "Not scored yet" and "not scored, and the job is stuck" are the same zero.
   *
   * They are separated here by the age of the oldest unscored call against the
   * cadence the server reports. Under two full cycles is PENDING and expected;
   * beyond that the pipeline is BEHIND and the amber alarm is earned.
   *
   * `null` cadence or a missing timestamp resolves to "behind" rather than
   * "pending" on purpose: an unreadable state must never render as the
   * reassuring one.
   */
  const evaluation = scorecard?.evaluation;
  const oldestUnversionedHours = evaluation?.oldestUnversionedAt
    ? Math.floor((Date.now() - new Date(evaluation.oldestUnversionedAt).getTime()) / 3_600_000)
    : null;
  const evaluationLag = classifyEvaluationLag({
    oldestUnversionedAt: evaluation?.oldestUnversionedAt,
    evalCadenceHours: evaluation?.evalCadenceHours,
  });
  // null = query has no data — renders "—" (house pattern, see the verified
  // revenue tile), never a fabricated 0.
  const manualReviewCount = callReview == null
    ? null
    : (callReview.counts.manual_review ?? 0) + (callReview.counts.ambiguous ?? 0);

  return (
    <section className="space-y-3 border border-border/40 bg-card p-4" aria-label="Revenue operations voice scorecard">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground/45">
            Voice revenue operations · today
          </div>
          <p className="mt-1 text-xs text-foreground/50">
            Version {scorecard.metricDefinitionVersion} · source {scorecard.source} · refreshed {scorecard.dataAsOf ? new Date(scorecard.dataAsOf).toLocaleTimeString() : "not available"}
          </p>
        </div>
        {noVersionedData && evaluationLag === "pending" ? (
          /* EXPECTED, NOT BROKEN — so it does not wear the alarm colour.
             This panel is pinned to TODAY, and `vapi-call-eval` is a 24-hour
             tier job that further defers a call until VAPI analysis is ready or
             the call is 24h old. Today's calls therefore cannot be scored
             today. Showing a permanent amber warning for a guaranteed state is
             how a real alarm gets trained away. */
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground/55"
            title="Calls are scored by a daily job, and each call waits for its provider analysis. Today's calls are evaluated on the next cycle."
          >
            <Clock className="h-3 w-3" /> Scored on the next daily cycle
          </span>
        ) : noVersionedData ? (
          /* GENUINELY BEHIND. An unscored call older than two full cycles is a
             stalled pipeline, not a pending one, and it keeps the alarm. */
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <ShieldAlert className="h-3 w-3" /> Evaluations behind · oldest {oldestUnversionedHours}h
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Versioned data
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border/30 bg-background/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Inbound records</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{counts.totalInboundRecords}</p>
          {/* "LEGACY EXCLUDED" WAS THE WRONG WORD FOR TODAY'S CALLS. It reads
              as "these predate the metric and never will be counted", when the
              truth for a same-day call is "these have not been scored yet and
              will be". The count is identical; the meaning is opposite, and the
              operator acts differently on each. */}
          <p className="text-[11px] text-foreground/45">
            {counts.versionedCalls} v1 · {counts.legacyUnversioned}{" "}
            {evaluationLag === "pending" ? "awaiting scoring" : "unscored"}
          </p>
        </div>
        <div className="border border-border/30 bg-background/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Qualified inquiries</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{counts.qualifiedServiceInquiries}</p>
          <p className="text-[11px] text-foreground/45">classifier-v2 · inferred</p>
        </div>
        <div className="border border-border/30 bg-background/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Verified capture</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{counts.leadsCreated + counts.callbacksCreated + counts.bookingsCreated}</p>
          <p className="text-[11px] text-foreground/45">{counts.leadsCreated} leads · {counts.callbacksCreated} callbacks · {counts.bookingsCreated} bookings</p>
        </div>
        <div className="border border-border/30 bg-background/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Conversation quality</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{scorecard.quality.average ?? "—"}</p>
          <p className="text-[11px] text-foreground/45">{scorecard.quality.scoredCalls} scored · outcome-independent</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="border border-emerald-400/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
            <CircleDollarSign className="h-3.5 w-3.5" /> Verified attributed revenue
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums">
            {attribution ? formatCurrency(attribution.totals.verifiedRevenueCents) : "—"}
          </p>
          <p className="text-[11px] text-foreground/45">
            {attribution ? attribution.totals.uniquelyLinkedPaidInvoices : "—"} uniquely linked paid invoice{attribution?.totals.uniquelyLinkedPaidInvoices === 1 ? "" : "s"}
          </p>
        </div>
        <div className="border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            <SearchCheck className="h-3.5 w-3.5" /> Attribution review
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums">{manualReviewCount ?? "—"}</p>
          <p className="text-[11px] text-foreground/45">phone/time/service matches remain inferred</p>
        </div>
        <div className="border border-border/30 bg-background/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Excluded from revenue</p>
          <p className="mt-1 text-xl font-bold tabular-nums">
            {attribution ? (attribution.totals.ambiguousInvoiceCount ?? 0) + (attribution.totals.unpaidOrMissingInvoiceLinks ?? 0) : "—"}
          </p>
          <p className="text-[11px] text-foreground/45">ambiguous, unpaid, refunded, partial, or missing links</p>
        </div>
      </div>

      <div className="grid gap-2 text-xs text-foreground/70 md:grid-cols-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-3.5 w-3.5 text-blue-400" />
          Qualified → lead: {formatRate(scorecard.rates.qualifiedToLead)}
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          Qualified → booking: {formatRate(scorecard.rates.qualifiedToBooking)}
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
          Technical failures: {formatRate(scorecard.rates.technicalFailure)}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 pt-3">
        <div className="flex items-center gap-2 text-xs text-foreground/60">
          {liveUnknown ? (
            /* Errored live query — say "unknown", never fabricate "no calls in flight". */
            <span className="text-amber-300/80">live-call state unknown</span>
          ) : (
            <>
              {inFlightCount > 0 ? <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-400" /> : <Phone className="h-3.5 w-3.5" />}
              {inFlightCount > 0 ? `${inFlightCount} call${inFlightCount === 1 ? "" : "s"} live` : "No calls in flight"}
            </>
          )}
          <span>·</span>
          <span>{counts.walkInsDirected} walk-ins directed, not arrivals</span>
          <span>·</span>
          <span>{counts.paidInvoicesVerified} call records directly verified to paid invoices</span>
        </div>
        {!liveUnknown && stuckCount > 0 ? (
          <button
            type="button"
            onClick={onStuckCallsAction}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
          >
            Review {stuckCount} stuck call{stuckCount === 1 ? "" : "s"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

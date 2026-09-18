/**
 * VoiceReceptionistSection — admin dashboard for the VAPI AI
 * receptionist (line +1 216 424 9249, "Nick" assistant).
 *
 * Surfaces today's call activity:
 *   · KPI tiles (total / forwarded / customer-ended / Nick-ended / talk time)
 *   · End-reasons breakdown (chart)
 *   · Recent calls table with click-to-drawer for transcript + tool calls
 *
 * Built 2026-05-07 (wave-86) per operator request to put VAPI numbers
 * + transcripts + callbacks "all in admin, nice and informative."
 *
 * Data: trpc.vapi.todayMetrics + trpc.vapi.todayCalls + trpc.vapi.callDetails.
 * Server-side memo'd 60s; client polls every 60s.
 */
import { useState } from "react";
import { compileRecoverySms, type CompiledSms, type ObservedCallFacts } from "@shared/smsFactCompiler";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  PageHeader,
  StatCard,
  Panel,
  MetricGrid,
  EmptyState,
  SearchInput,
} from "./shared";
import { AttributionReviewCard } from "./voice/AttributionReviewCard";
import {
  PhoneCall,
  PhoneForwarded,
  Clock,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Settings,
  TrendingUp,
  UserCheck,
  Clipboard,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Check,
  HelpCircle,
} from "lucide-react";
import {
  SkeletonKpiGrid,
  SkeletonTable,
} from "@/components/admin/AdminSkeletons";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CHART_THEME } from "./shared";
// wave-181.x Voice Phase 2 · 3-line auto-narrative.
import { VoiceBrief } from "./voice/VoiceBrief";
import {
  SortMode,
  SORT_LABELS,
  RangePreset,
  rangeToISO,
  defaultDateString,
  fmtDuration,
  fmtTime,
  fmtPhone,
  prettyReason,
  maskPhone,
  prettyOutcome,
  EXCLUSION_LABELS,
} from "./voice/format";
import { DateRangeSelector } from "./voice/DateRangeSelector";
import { FilterChip } from "./voice/FilterChip";
import { TransferDestinationCard } from "./voice/TransferDestinationCard";
import { FollowUpTransferCard } from "./voice/FollowUpTransferCard";
import { LiveCallsCard } from "./voice/LiveCallsCard";
import { CallDetailsDrawer } from "./voice/CallDetailsDrawer";
import { VoiceAchievements } from "./voice/VoiceAchievements";
import VapiPanel from "./settings/VapiPanel";

// ─── Section ────────────────────────────────────────────────
export default function VoiceReceptionistSection() {
  const [showDevSettings, setShowDevSettings] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  // Wave-89 — sort + filter state
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string | null>(null); // null = "all"

  const [activeTab, setActiveTab] = useState<"performance" | "queue">("performance");
  const [queueStatusFilter, setQueueStatusFilter] = useState<"pending" | "reviewed" | "converted" | "came_in" | "ignored">("pending");

  // Wave-91 — date range state.
  // wave-181.x Voice Phase 1 · audit agent cleanup #10 · customSince
  // defaulted to 7 days back · clicking "Custom" fresh silently
  // double-counted with the "Last 7 days" preset. Default to TODAY
  // so "Custom" is opt-in narrowing, not duplicate widening.
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  const [customSince, setCustomSince] = useState<string>(() => defaultDateString(0));
  const [customUntil, setCustomUntil] = useState<string>(() => defaultDateString(0));

  const range = rangeToISO(rangePreset, customSince, customUntil);
  const queryInput = { sinceISO: range.sinceISO, untilISO: range.untilISO };

  const { data: metrics, isLoading: metricsLoading, isError: metricsError, refetch: refetchMetrics, isFetching: metricsFetching } = trpc.vapi.todayMetrics.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false, // only auto-poll for "today"
  });
  // Honest ROI — measured conversions × real avg paid ticket, shown as an estimate range.
  const { data: roi } = trpc.vapi.receptionistRoi.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false,
  });
  // revenue-ops-v1 scorecard (Wave 2 closure, PR #679-681) — the versioned,
  // row-grounded replacement for todayMetrics' unlabeled Legacy/Revised
  // pair. Additive: todayMetrics stays wired for outcome/intent charts and
  // warm-transfer, which this scorecard doesn't cover.
  const { data: scorecard } = trpc.revenueOps.voiceScorecard.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false,
  });
  const { data: calls, isLoading: callsLoading, refetch: refetchCalls, isFetching: callsFetching } = trpc.vapi.todayCalls.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false,
  });

  // No `enabled: activeTab === "queue"` gate: the tab badge now reports this
  // query's real contents, so it must load on mount — a badge that only knows
  // the truth after you've already visited the tab alerts nobody.
  const { data: queueItems, isLoading: queueLoading, isError: queueError, refetch: refetchQueue, isFetching: queueFetching } = trpc.vapi.getMissedRevenueQueue.useQuery({
    status: queueStatusFilter,
  }, {
    staleTime: 60_000,
  });

  // The tab badge must count PENDING work regardless of which roster filter
  // is on screen — after viewing 'reviewed' the badge used to count history
  // (or show nothing while pending items waited). React Query dedupes this
  // against the roster query whenever the filter IS 'pending'.
  const { data: pendingQueue, isError: pendingQueueError } = trpc.vapi.getMissedRevenueQueue.useQuery({
    status: "pending",
  }, {
    staleTime: 60_000,
  });

  /**
   * The denominators the wall never showed.
   *
   * "1,118 pending" was rendered as missed revenue while being, in large part,
   * a census of calls that were ANSWERED. This returns the same population
   * decomposed by lane and by stated exclusion reason, so "where did the other
   * rows go" has an answer on screen instead of becoming a support question.
   */
  const {
    data: queueSummary,
    isError: queueSummaryError,
    isLoading: queueSummaryLoading,
  } = trpc.vapi.getRecoveryQueueSummary.useQuery({ days: 90 }, { staleTime: 60_000 });

  const updateQueueMutation = trpc.vapi.updateQueueStatus.useMutation({
    onSuccess: () => {
      void refetchQueue();
      void refetchMetrics();
      void refetchCalls();
    },
  });

  // wave-111 — manual refresh for non-"today" ranges (auto-poll off there).
  const handleManualRefresh = () => {
    void refetchMetrics();
    void refetchCalls();
    if (activeTab === "queue") {
      void refetchQueue();
    }
  };
  const refreshing = metricsFetching || callsFetching || (activeTab === "queue" && queueFetching);
  const { data: vapiStatus } = trpc.vapi.status.useQuery(undefined, { staleTime: 5 * 60_000 });

  const rawCalls = calls ?? [];
  const m = metrics ?? null;

  // Wave-89 — apply filters + sort to derive the rendered list
  const callsList = (() => {
    let list = [...rawCalls];

    // Reason filter
    if (reasonFilter) {
      list = list.filter((c) => c.endedReason === reasonFilter);
    }

    // Search filter (caller phone, customer name, summary)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const num = (c.customerNumber || "").toLowerCase();
        const name = (c.customerName || "").toLowerCase();
        const summary = (c.summary || "").toLowerCase();
        return num.includes(q) || name.includes(q) || summary.includes(q);
      });
    }

    // Sort
    if (sortMode === "longest") {
      list.sort((a, b) => b.durationSeconds - a.durationSeconds);
    } else if (sortMode === "shortest") {
      list.sort((a, b) => a.durationSeconds - b.durationSeconds);
    } else {
      list.sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      );
    }
    return list;
  })();

  const [editingNotes, setEditingNotes] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = (id: number, text: string) => {
    // The promise was fire-and-forget: "Copied!" showed even when the write
    // rejected (iOS clipboard permissions do reject). Confirm only on success.
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      },
      () => toast.error("Copy failed — long-press the text to copy it manually."),
    );
  };

  /**
   * 2026-09-18 · replaced eight hardcoded paragraphs with the fact compiler.
   *
   * The previous implementation selected among eight literal strings by intent
   * flag and interpolated NOTHING — not the caller's name, vehicle, tire size,
   * quantity or urgency, all of which the assistant had already heard. Worse,
   * the strings made claims the shop cannot verify from a React component:
   * "we stock all major brands", "flat repairs are done while you wait",
   * "free battery and alternator test", and a hardcoded "before 6 PM today"
   * that was false every Sunday, when the shop closes at 4.
   *
   * `compileRecoverySms` lives in `shared/`, so this preview is the EXACT
   * string the server would send — a preview that differs from the send is not
   * a preview. It states only observed facts, canonical shop facts (address,
   * phone, TODAY'S real hours) and asks, and it reports what it refused to
   * claim so the operator can see the restraint.
   */
  const buildSmsDraft = (item: {
    demand?: Partial<ObservedCallFacts> | null;
    customerName?: string | null;
    transferFailed?: boolean;
    evalOutcome?: string;
    intents?: string[];
  }): CompiledSms => {
    const d = item.demand ?? {};
    return compileRecoverySms(
      {
        customerName: item.customerName ?? null,
        tireSize: d.tireSize ?? null,
        vehicle: d.vehicle ?? null,
        quantity: d.quantity ?? null,
        condition: d.condition ?? null,
        urgency: d.urgency ?? null,
        transferFailed: item.transferFailed === true,
        callbackRequested: item.evalOutcome === "callback_needed",
      },
      { now: new Date(), isFirstInThread: true },
    );
  };

  const reasonsChart = m
    ? Object.entries(m.endReasons).map(([reason, count]) => ({
        name: prettyReason(reason).label,
        value: count,
      })).sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Voice Receptionist"
        subtitle={`AI line +1 216 424 9249 · "Nick" assistant`}
        icon={<PhoneCall className="w-5 h-5" />}
        badge={
          /* A FAILED metrics read used to land in the "QUIET DAY" branch —
             the calmest possible words, produced by knowing nothing. Unknown
             gets its own state; QUIET DAY requires a successful read. */
          metricsError
            ? { label: "METRICS UNREADABLE", variant: "danger" }
            : m && !m.ok
            ? { label: "VAPI UNREACHABLE", variant: "danger" }
            : m && m.total > 0
            ? { label: `${m.total} CALLS · ${range.shortLabel.toUpperCase()}`, variant: "success" }
            : m
            ? { label: rangePreset === "today" ? "QUIET DAY" : `0 CALLS · ${range.shortLabel.toUpperCase()}`, variant: "neutral" }
            : { label: "LOADING…", variant: "neutral" }
        }
        /* wave-181.x Voice Phase 5 ELON cut · VapiDashboardLinks
         * chips removed · they sent the operator out of the admin.
         * CallDetailsDrawer keeps a single inline "Open in VAPI"
         * link for the rare per-call deep-dive case. */
      />

      {/* wave-181.x Voice Phase 2 · VoiceBrief 3-line auto-narrative
       * lands above the routing cards so the operator's first eye-
       * grab is "what's happening with Nick today" rather than the
       * transfer-destination + live-calls + outbound-trigger stack.
       * Stuck-calls action CTA scrolls to LiveCallsCard. */}
      <VoiceBrief
        onStuckCallsAction={() => {
          const el = document.getElementById("voice-live-calls");
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-amber-400/50");
            setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/50"), 1200);
          }
        }}
      />

      {/* 2026-09-01 (audit, artifact 4 §2.6): the call ↔ invoice attribution
       * review queue and its `resolve` ruling existed on the server with no
       * door anywhere. This is the door. */}
      <AttributionReviewCard />

      {/* ─── wave-181.67: Live in-flight calls (Phase 4 state machine) ──
          Real-time roster of calls the agent is currently handling +
          their position in the 5-state flow (greeted → intent → tool →
          confirmed → ended). 5s refetch interval. Hides itself when
          zero calls are in flight so quiet hours stay clean.

          2026-09-18 · PROMOTED above routing config and gamification. A
          customer talking to Nick RIGHT NOW outranks a configuration card and
          an XP gauge; it previously rendered below both. The card already
          hides itself when nothing is in flight, so promoting it costs a quiet
          day nothing. */}
      <LiveCallsCard onSelectCall={setSelectedCallId} />

      {/* ─── Transfer destination quick-control ─────── */}
      <TransferDestinationCard />

      {/* ─── wave-114: Follow-Up Caller transfer destination ──
          Compact sub-card. Lives below the receptionist card so the
          operator sees both phone-routing surfaces at a glance. */}
      <FollowUpTransferCard />

      {/* wave-181.x Voice Phase 5 ELON cut · OutboundCallCard deleted
       * (~102 LOC inline + ~5 KB of UI). Per audit agent HIGH-confidence
       * delete: it was a free-form "dial any number" power-tool with
       * one confirmDialog gate but NO TCPA consent check · NO quiet-
       * hours guard · NO daily-cap on the client. Foot-gun masquerading
       * as a feature. Operator can dial a customer from their own cell
       * or the shop landline · the F25e SMS gateway covers the SMS path.
       * Server-side vapi.makeFollowUpCall procedure stays (other crons
       * may use it · or it can ship in a future op-gated cron with proper
       * TCPA/quiet-hours plumbing per the design plan). */}

      {/* ─── Date range selector (wave-91 + wave-111 manual refresh) ─ */}
      <DateRangeSelector
        preset={rangePreset}
        onPresetChange={setRangePreset}
        customSince={customSince}
        customUntil={customUntil}
        onCustomSinceChange={setCustomSince}
        onCustomUntilChange={setCustomUntil}
        onRefresh={handleManualRefresh}
        refreshing={refreshing}
      />

      {/* ─── Navigation Tabs ─────────────────────────────────── */}
      <div className="flex border-b border-border/20 gap-4 mb-4">
        <button
          onClick={() => setActiveTab("performance")}
          className={`pb-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "performance"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Performance Dashboard
        </button>
        <button
          onClick={() => setActiveTab("queue")}
          className={`pb-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "queue"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Needs Attention
          {/* The old pill rendered on `activeTab !== "queue"` alone — a
              permanent red badge with zero connection to queue contents. A
              badge that is always on trains the operator to ignore red
              badges everywhere. It now reflects what the queue query
              actually returned, and shows "?" when that read failed. */}
          {activeTab !== "queue" && pendingQueueError && (
            <span className="bg-amber-500/15 text-amber-500 text-[10px] px-1.5 py-0.5 rounded-full font-bold" title="Queue could not be read">
              ?
            </span>
          )}
          {activeTab !== "queue" && !pendingQueueError && (pendingQueue?.length ?? 0) > 0 && (
            <span className="bg-rose-500/15 text-rose-500 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {pendingQueue!.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "performance" ? (
        <div className="space-y-6">
          {/* ─── KPI Tiles ──────────────────────────────────── */}
          {metricsError ? (
            /* `metricsLoading || !m` rendered the skeleton FOREVER on a failed
               read — loading ends, m stays null, the shimmer never resolves. */
            <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
              <strong>Call metrics could not be read.</strong> These numbers are unknown, not zero.{" "}
              <button type="button" className="underline" onClick={() => refetchMetrics()}>Retry</button>
            </div>
          ) : metricsLoading || !m ? (
            <SkeletonKpiGrid cols={4} />
          ) : (
            <MetricGrid cols={4}>
              <StatCard
                label="Valid Conversations"
                value={m.validConversationsCount ?? 0}
                icon={<PhoneCall className="w-4 h-4" />}
                color="text-foreground"
                trendLabel={m.total > 0 ? `${Math.round(((m.validConversationsCount ?? 0) / m.total) * 100)}% of total calls` : undefined}
              />
              <StatCard
                label={scorecard ? "Verified Demand Capture" : "Hard Conversions"}
                value={
                  scorecard
                    ? scorecard.counts.leadsCreated + scorecard.counts.callbacksCreated + scorecard.counts.bookingsCreated
                    : m.hardConversionsCount ?? 0
                }
                icon={<TrendingUp className="w-4 h-4" />}
                color="text-emerald-400"
                trendLabel={
                  scorecard
                    ? `${scorecard.rates.qualifiedToLead.percent ?? 0}% of ${scorecard.rates.qualifiedToLead.denominator} qualified calls → lead · verified (leadId/callbackId/bookingId row exists)`
                    : m.total > 0
                      ? `Legacy: ${m.legacyConversionRate}%, Revised: ${m.revisedHardConversionRate}%`
                      : undefined
                }
              />
              <StatCard
                label="Actionable Outcome Rate"
                value={`${m.actionableRate ?? 0}%`}
                icon={<UserCheck className="w-4 h-4" />}
                color="text-blue-400"
                trendLabel={`${m.actionableOutcomesCount ?? 0} actionable calls`}
              />
              <StatCard
                label="Forwarded / Walk-In Directed"
                value={(m.forwarded || 0) + (m.walkInDirectedCount || 0)}
                icon={<PhoneForwarded className="w-4 h-4" />}
                color="text-amber-400"
                trendLabel={`Forwarded: ${m.forwarded || 0}, Walk-ins: ${m.walkInDirectedCount || 0}`}
              />
              {/* Redial EVIDENCE, not answer-proof: a same-phone call within
                  15min of a forward means the forward didn't resolve. The VAPI
                  leg ends at the hand-off, so no duration-based "connected" is
                  measurable (the old inferred tile was removed for that
                  reason). LOWER is better. "—" until >=10 classifiable. */}
              <StatCard
                label="Forward Redials ≤15m (14d)"
                value={m.transferEvidence?.reliable ? `${m.transferEvidence.redialRate}%` : "—"}
                icon={<UserCheck className="w-4 h-4" />}
                color="text-cyan-400"
                trendLabel={
                  m.transferEvidence?.reliable
                    ? `${m.transferEvidence.redialed}/${m.transferEvidence.classifiable} redialed · ${m.transferEvidence.quiet} quiet · ${m.transferEvidence.failedTransfers} failed hand-offs`
                    : `${m.transferEvidence?.forwards ?? 0} forwards (14d) · need 10+ classifiable for a rate`
                }
              />
            </MetricGrid>
          )}

          {/* ─── Voice Receptionist ROI (honest estimate) ──── */}
          {roi?.ok && roi.hardConversions > 0 && (
            <Panel
              title="Voice Receptionist ROI (estimate)"
              subtitle="Measured conversions × your average paid ticket. An estimate, not billed revenue — no bookings are fabricated."
              padding="md"
            >
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 font-bold">Est. recovered revenue</p>
                  <p className="text-3xl font-bold text-emerald-400 tabular-nums">
                    ${(roi.estLowCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}–${(roi.estHighCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[11px] text-foreground/40 mt-0.5">
                    this window · assuming {Math.round(roi.captureLow * 100)}–{Math.round(roi.captureHigh * 100)}% of committed calls become paid jobs
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 font-bold">Conversions</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{roi.hardConversions}</p>
                  <p className="text-[11px] text-foreground/40 mt-0.5">hard conversions · {roi.convertingCalls} incl. intents</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 font-bold">Avg paid ticket</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    ${(roi.avgTicketCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[11px] text-foreground/40 mt-0.5">from {roi.invoiceSampleSize.toLocaleString()} paid invoices (180d)</p>
                </div>
              </div>
              <p className="text-[11px] text-foreground/40 mt-4 leading-relaxed max-w-3xl">
                Honest math: {roi.hardConversions} measured conversions × ${(roi.avgTicketCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} avg ticket × a {Math.round(roi.captureLow * 100)}–{Math.round(roi.captureHigh * 100)}% close assumption. Conversions and ticket value are real; the close rate is the estimate.
              </p>
            </Panel>
          )}

          {/* ─── Outcome & Intent Charts ───────────────────── */}
          {m && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title="Outcome Taxonomy Breakdown" subtitle="Distribution of evaluated call outcomes" padding="md">
                {Object.keys(m.outcomeBreakdown || {}).length === 0 ? (
                  <EmptyState
                    icon={<PhoneCall className="w-8 h-8" />}
                    title="No outcomes evaluated yet"
                    subtitle="Daily evaluation job will populate outcome categories."
                  />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={Object.entries(m.outcomeBreakdown || {}).map(([outcome, count]) => ({
                        name: prettyOutcome(outcome).label,
                        value: count,
                      })).sort((a, b) => b.value - a.value)}
                      layout="vertical"
                      margin={{ left: 50, right: 12, top: 8, bottom: 8 }}
                    >
                      <XAxis type="number" stroke={CHART_THEME.axis} fontSize={10} />
                      <YAxis type="category" dataKey="name" stroke={CHART_THEME.axis} fontSize={10} width={130} />
                      <Tooltip contentStyle={CHART_THEME.tooltip} />
                      <Bar dataKey="value" fill={CHART_THEME.primary} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Panel>

              <Panel title="Service Intent Distribution" subtitle="Customer requests extracted by AI classifier" padding="md">
                {!m.intentDistribution || m.intentDistribution.length === 0 ? (
                  <EmptyState
                    icon={<Search className="w-8 h-8" />}
                    title="No intents detected yet"
                    subtitle="Customer service mentions will populate this list."
                  />
                ) : (
                  <div className="max-h-[220px] overflow-y-auto space-y-2.5 pr-1">
                    {m.intentDistribution.slice(0, 10).map((item: any, idx: number) => (
                      <div key={item.intent} className="flex items-center justify-between text-xs">
                        <span className="capitalize font-medium text-foreground/80 w-28 truncate">
                          {item.intent.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-2 flex-1 mx-3">
                          <div className="h-2 rounded bg-foreground/5 flex-1 overflow-hidden">
                            <div 
                              className="h-full bg-primary rounded" 
                              style={{ width: `${(item.count / m.intentDistribution[0].count) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="font-mono text-foreground/60 w-6 text-right">{item.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}

          {/* ─── Recent calls table — wave-89 sort + filter controls ───── */}
          <Panel
            title={rangePreset === "today" ? "Today's Calls" : `Calls · ${range.shortLabel}`}
            subtitle={
              searchQuery || reasonFilter
                ? `Showing ${callsList.length} of ${rawCalls.length} calls · click any row to see transcript`
                : "Click any row to see transcript + tool calls"
            }
            padding="none"
          >
            {/* Sort + filter controls */}
            {rawCalls.length > 0 && (
              <div className="px-4 py-3 border-b border-border/20 bg-foreground/[0.01] space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search */}
                  <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search number / name / summary"
                    size="compact"
                    className="flex-1 min-w-[180px] max-w-[280px]"
                  />

                  {/* Sort dropdown */}
                  <div className="relative inline-flex items-center gap-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5 text-foreground/40" />
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="bg-background border border-border/30 rounded px-2 py-1.5 text-[12px] text-foreground focus:border-primary/50 focus:outline-none"
                    >
                      {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                        <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>
                      ))}
                    </select>
                  </div>

                  {/* Reset chip — show only when something is filtered */}
                  {(searchQuery || reasonFilter) && (
                    <button
                      onClick={() => { setSearchQuery(""); setReasonFilter(null); }}
                      className="text-[11px] text-foreground/50 hover:text-foreground border border-border/30 hover:border-primary/40 rounded px-2 py-1.5 transition-colors"
                    >
                      Reset filters
                    </button>
                  )}
                </div>

                {/* Reason filter chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/45 mr-1">Filter:</span>
                  <FilterChip
                    label="All"
                    count={rawCalls.length}
                    active={reasonFilter === null}
                    onClick={() => setReasonFilter(null)}
                    tone="neutral"
                  />
                  {m && Object.entries(m.endReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => {
                    const pretty = prettyReason(reason);
                    return (
                      <FilterChip
                        key={reason}
                        label={pretty.label}
                        count={count}
                        active={reasonFilter === reason}
                        onClick={() => setReasonFilter(reasonFilter === reason ? null : reason)}
                        tone={reason}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {callsLoading ? (
              <SkeletonTable rows={6} cells={5} />
            ) : callsList.length === 0 && rawCalls.length === 0 ? (
              <EmptyState
                icon={<PhoneCall className="w-8 h-8" />}
                title="No calls yet today"
                subtitle="Calls appear here within ~60 seconds of ending."
              />
            ) : callsList.length === 0 ? (
              <EmptyState
                icon={<Search className="w-8 h-8" />}
                title="No calls match the filter"
                subtitle="Try clearing the search or selecting a different reason."
              />
            ) : (
              <div className="divide-y divide-border/20">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-foreground/[0.02] text-[11px] font-medium tracking-[0.15em] uppercase text-foreground/40">
                  <span className="w-16">Time</span>
                  <span className="flex-1">Caller</span>
                  <span className="w-20 text-right">Duration</span>
                  <span className="w-32">Outcome Category</span>
                  <span className="w-6"></span>
                </div>
                {callsList.map((c: any) => {
                  const outcome = prettyOutcome(c.evalOutcome || c.successEvaluation);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCallId(c.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-foreground/[0.03] transition-colors"
                    >
                      <span className="w-16 text-[12px] font-mono text-foreground/60 tabular-nums">
                        {fmtTime(c.createdAt)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {c.customerName || maskPhone(c.customerNumber)}
                        </div>
                        {c.summary && (
                          <div className="text-[11px] text-foreground/40 truncate mt-0.5">
                            {c.summary.slice(0, 80)}
                          </div>
                        )}
                      </span>
                      <span className="w-20 text-right text-[12px] font-mono text-foreground/70 tabular-nums">
                        {fmtDuration(c.durationSeconds)}
                      </span>
                      <span className={`w-32 text-[11px] font-medium ${outcome.color}`}>
                        {outcome.label}
                      </span>
                      <span className="w-6 text-foreground/30 text-xs">›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        /* ─── Needs Attention Tab ────────────────────────────────
             Renamed 2026-09-18. "Missed Revenue" asserted that every row was
             money the shop lost — a claim the data never supported, and which
             this wave measured as substantially false: a large share were calls
             that had been ANSWERED. The label now states what the operator is
             being asked to do, which is the only thing the row can prove. */
        <div className="space-y-4">
          {/*
            WHERE THE ROWS WENT. The operator used to face a 1,118-row wall
            labelled "Missed Revenue" — a number that was never a count of
            recoverable demand. Rows are now episodes (one customer, one need),
            and everything NOT in the recovery lane is accounted for here under
            a stated reason rather than silently filtered away. A queue that
            shrinks without explaining itself is a queue nobody trusts.
          */}
          {queueSummaryLoading ? (
            <div className="bg-card border border-border/20 rounded-lg p-4 text-xs text-muted-foreground">
              Loading the call population…
            </div>
          ) : queueSummaryError ? (
            /* Unknown, never zero — the same contract as the queue read above. */
            <div className="bg-card border border-amber-500/30 rounded-lg p-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Call population unreadable — the breakdown below is{" "}
                <span className="text-amber-400 font-medium">unknown, not empty</span>. The roster
                itself may still be accurate; this panel is not.
              </p>
            </div>
          ) : queueSummary ? (
            <div className="bg-card border border-border/20 rounded-lg p-4 space-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Needs attention
                </span>
                <span className="text-2xl font-semibold text-foreground tabular-nums">
                  {queueSummary.needsAttention}
                </span>
                {queueSummary.slaBreached > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                    {queueSummary.slaBreached} past its response target
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  from {queueSummary.sourceCallCount.toLocaleString()} call records ·{" "}
                  {queueSummary.windowDays}d
                </span>
              </div>

              {Object.keys(queueSummary.exclusionCounts).length > 0 && (
                <div className="pt-2 border-t border-border/10">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Not an obligation, and why
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(queueSummary.exclusionCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => (
                        <span key={reason} className="text-xs text-muted-foreground">
                          <span className="text-foreground font-medium tabular-nums">{count}</span>{" "}
                          {EXCLUSION_LABELS[reason] ?? reason.replace(/_/g, " ")}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {queueSummary.transferConnect.attempted > 0 && (
                /*
                  DID THE TRANSFER REACH A HUMAN — the question no metric here
                  could answer until now. Derived from the provider's own
                  per-attempt status, never from `assistant-forwarded-call`,
                  which means the transfer was INITIATED: a call that rang an
                  empty counter carries that reason too.

                  Coverage is printed FIRST and the rate renders "—" without it.
                  VAPI gates blind-transfer outcome detection per organisation,
                  so 0% coverage is a real and likely answer — and it must read
                  as "we are not being told", not as a transfer problem or a
                  clean bill of health.
                */
                <div className="pt-2 border-t border-border/10">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Transfers — did they reach a human
                  </p>
                  {queueSummary.transferConnect.coveragePct === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-amber-400 font-medium">Not reported.</span> The phone
                      provider returned no outcome for any of the{" "}
                      <span className="text-foreground tabular-nums">
                        {queueSummary.transferConnect.attempted}
                      </span>{" "}
                      transfer attempts, so connect rate is{" "}
                      <span className="text-amber-400">unknown</span> — not good, not bad.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        <span className="text-emerald-400 font-medium tabular-nums">
                          {queueSummary.transferConnect.connected}
                        </span>{" "}
                        reached a human
                      </span>
                      <span className="text-muted-foreground">
                        <span className="text-red-400 font-medium tabular-nums">
                          {queueSummary.transferConnect.notConnected}
                        </span>{" "}
                        reached nobody
                      </span>
                      {queueSummary.transferConnect.unknown > 0 && (
                        <span className="text-muted-foreground">
                          <span className="text-amber-400 font-medium tabular-nums">
                            {queueSummary.transferConnect.unknown}
                          </span>{" "}
                          not reported
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto">
                        {queueSummary.transferConnect.connectRate === null
                          ? "rate withheld — too few resolved to be meaningful"
                          : `${queueSummary.transferConnect.connectRate}% connected, over ${queueSummary.transferConnect.coveragePct}% coverage`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {queueSummary.unclassified > 0 && (
                /*
                  UNKNOWN is its own state. These are calls whose speaker could
                  not be attributed — mostly rows written before the customer
                  speech record existed. Folding them into "no demand" would be
                  asserting a measurement that was never taken.
                */
                <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/10">
                  <span className="text-amber-400 font-medium tabular-nums">
                    {queueSummary.unclassified}
                  </span>{" "}
                  could not be read well enough to classify — not measured, not &ldquo;no
                  demand&rdquo;.
                </p>
              )}
            </div>
          ) : null}

          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs text-muted-foreground mr-1">Roster Status:</span>
            {(["pending", "reviewed", "converted", "came_in", "ignored"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setQueueStatusFilter(status)}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${
                  queueStatusFilter === status
                    ? "bg-primary/10 border-primary text-primary font-medium"
                    : "bg-background border-border/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                {status.toUpperCase().replace("_", " ")}
              </button>
            ))}
          </div>

          {queueLoading ? (
            <SkeletonTable rows={4} cells={4} />
          ) : queueError ? (
            /* "All Caught Up!" over a failed read is the same lie as the $0
               unpaid-invoices banner — celebration born from blindness. */
            <EmptyState
              icon={<AlertTriangle className="w-10 h-10 text-amber-400" />}
              title="Queue unreadable"
              subtitle="Missed opportunities could not be loaded — this is unknown, NOT caught up. Retry before trusting it."
            />
          ) : !queueItems || queueItems.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="w-10 h-10 text-emerald-400" />}
              title="All Caught Up!"
              subtitle={`No missed opportunities currently classified as "${queueStatusFilter}".`}
            />
          ) : (
            <div className="space-y-4">
              {queueItems.map((item: any) => {
                const outcome = prettyOutcome(item.evalOutcome);
                const smsDraft = buildSmsDraft(item);
                const smsText = smsDraft.body;
                const recAction = 
                  item.evalOutcome === "callback_needed" ? "Call customer back immediately to schedule service." :
                  item.evalOutcome === "lost_opportunity" ? "Reach out to recover the repair/tire opportunity." :
                  item.evalOutcome === "walk_in_directed" ? "Check if customer arrived at Euclid Ave shop. Mark 'Came In' if they did." :
                  "Contact customer to verify if technical disconnect prevented booking.";

                return (
                  <div key={item.id} className="bg-card border border-border/20 rounded-lg p-4 space-y-3 shadow-sm hover:border-primary/20 transition-all flex flex-col md:flex-row md:gap-6 justify-between items-start">
                    
                    {/* Left Column: Call Info */}
                    <div className="flex-1 space-y-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">
                          {item.customerName || maskPhone(item.phoneNumber)}
                        </span>
                        
                        {/* The old badge read "Repeat Caller (+3)" and fired on
                            any number seen twice in NINETY DAYS - brakes in June
                            and tires in September scored as urgency - and each
                            call was its own row, so the badge inflated the very
                            backlog it described. A row is now one EPISODE (same
                            caller, same unresolved need, inside a day), so this
                            states the contact count as a fact and claims no score. */}
                        {item.contactCount > 1 && (
                          <span className="bg-rose-500/15 text-rose-400 text-[10px] px-2 py-0.5 rounded font-bold border border-rose-500/20">
                            Called {item.contactCount}x about this
                          </span>
                        )}
                        {item.slaBreached && (
                          <span className="bg-red-500/15 text-red-400 text-[10px] px-2 py-0.5 rounded font-bold border border-red-500/20">
                            Past response target
                          </span>
                        )}

                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${outcome.bg} ${outcome.color}`}>
                          {outcome.label}
                        </span>

                        <span className="text-xs text-muted-foreground font-mono">
                          Priority Score: {item.priorityScore}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {item.intents.map((intent: string) => (
                          <span key={intent} className="text-[10px] px-2 py-0.5 bg-foreground/5 rounded text-foreground/75 border border-border/10 font-medium">
                            {intent.replace(/_/g, " ")}
                          </span>
                        ))}
                        {item.intents.length === 0 && (
                          <span className="text-[10px] italic text-muted-foreground">No specific intent tags</span>
                        )}
                      </div>

                      {item.aiSummary && (
                        <div className="text-xs text-foreground/80 bg-foreground/[0.01] border border-border/10 p-2.5 rounded">
                          <strong className="text-foreground/70 block mb-0.5">AI Summary:</strong>
                          {item.aiSummary}
                        </div>
                      )}

                      <div className="text-xs">
                        <span className="text-amber-400 font-semibold">Recommended Action:</span>{" "}
                        <span className="text-foreground/70">{recAction}</span>
                        {/* 2026-09-18 - the priority score is now the SUM of
                            these stated reasons, so the operator can audit the
                            ranking instead of trusting it. An opaque number is a
                            number nobody trusts and nobody can debug. */}
                        {Array.isArray(item.priorityReasons) && item.priorityReasons.length > 0 && (
                          <span className="block mt-1 text-[11px] text-muted-foreground">
                            Why it ranks here:{" "}
                            {item.priorityReasons
                              .map((r: { label: string; delta: number }) =>
                                r.label + " (" + (r.delta > 0 ? "+" : "") + r.delta + ")")
                              .join(" · ")}
                          </span>
                        )}
                      </div>

                      {/* SMS Draft Sub-Panel */}
                      <div className="border border-border/15 bg-background rounded p-3 space-y-2 mt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">SMS Follow-Up Draft</span>
                          <button
                            onClick={() => handleCopy(item.id, smsText)}
                            className="flex items-center gap-1 text-[11px] bg-foreground/5 hover:bg-foreground/10 text-foreground border border-border/20 px-2 py-0.5 rounded transition-colors font-medium"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Clipboard className="w-3 h-3" />
                                Copy Draft
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] text-foreground/75 leading-relaxed bg-foreground/[0.01] p-2 rounded border border-border/5 font-mono select-all">
                          {smsText}
                        </p>
                      </div>
                    </div>

                    {/* Right Column: Workflow Actions */}
                    <div className="w-full md:w-56 shrink-0 space-y-2.5 pt-3 md:pt-0 border-t md:border-t-0 md:border-l border-border/15 md:pl-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Staff Notes</label>
                        <textarea
                          value={editingNotes[item.id] !== undefined ? editingNotes[item.id] : item.notes}
                          onChange={(e) => setEditingNotes({ ...editingNotes, [item.id]: e.target.value })}
                          placeholder="Outcome notes..."
                          className="w-full text-xs p-2 bg-background border border-border/30 rounded focus:outline-none focus:border-primary/50 text-foreground resize-none h-14"
                        />
                        <button
                          onClick={() => {
                            updateQueueMutation.mutate({
                              id: item.id,
                              status: item.queueStatus,
                              notes: editingNotes[item.id] !== undefined ? editingNotes[item.id] : item.notes,
                            });
                          }}
                          className="text-[10px] px-2.5 py-1 bg-foreground/5 hover:bg-foreground/10 text-foreground rounded font-medium border border-border/20 transition-colors w-full"
                        >
                          Save Notes
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Mark Status</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(["reviewed", "converted", "came_in", "ignored"] as const).map((status) => (
                            <button
                              key={status}
                              onClick={() => {
                                updateQueueMutation.mutate({
                                  id: item.id,
                                  status,
                                  notes: editingNotes[item.id] !== undefined ? editingNotes[item.id] : item.notes,
                                });
                              }}
                              className="text-[10px] py-1 border border-border/20 hover:border-primary/30 rounded hover:bg-primary/5 text-foreground capitalize transition-all"
                            >
                              {status.replace("_", " ")}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── System & Developer Settings (Collapsible) ─── */}
      <div className="space-y-4">
        <button
          onClick={() => setShowDevSettings(!showDevSettings)}
          className="flex items-center justify-between w-full bg-card border border-border/20 px-4 py-3 hover:bg-foreground/[0.02] transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-foreground/60" />
            <span className="font-bold text-sm text-foreground">System & Developer Settings</span>
          </div>
          {showDevSettings ? (
            <ChevronUp className="w-4 h-4 text-foreground/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-foreground/50" />
          )}
        </button>

        {showDevSettings && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <VapiPanel />
          </div>
        )}
      </div>

      {/* 2026-09-18 · DEMOTED, and this time actually to the bottom.
          XP, levels and badges reward call VOLUME, not outcomes, and return no
          time, money or decision quality to the operator — while occupying the
          vertical space above a customer who is on the phone right now. Kept
          rather than deleted (harmless here, and the operator may enjoy it),
          but it no longer outranks live demand.

          THE FIRST ATTEMPT MOVED IT AND THEN OVERSTATED THE MOVE. It went below
          Live Calls but stayed ABOVE the date range, the tabs, the Performance
          Dashboard and the whole call list — while the comment and the shipped
          completion evidence both said "to the bottom of the page". Caught by
          loading the deployed page and reading the render order, not by any
          gate. A wave about the UI making claims it cannot support should not
          leave one in its own source. */}
      <VoiceAchievements />

      {/* ─── Drawer: full transcript + tool calls ────── */}
      {selectedCallId && (
        <CallDetailsDrawer
          callId={selectedCallId}
          onClose={() => setSelectedCallId(null)}
        />
      )}
    </div>
  );
}

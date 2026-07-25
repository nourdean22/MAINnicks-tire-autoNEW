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

  const getSmsDraft = (intents: string[], outcome: string): string => {
    if (intents.includes("used_tire") || intents.includes("tire_size_request")) {
      return "Thanks for calling Nick’s Tire & Auto. Used tire availability changes quickly. Stop by 17625 Euclid Ave and we’ll check available options for your vehicle.";
    }
    if (intents.includes("new_tire")) {
      return "Thanks for calling Nick’s Tire & Auto. We stock all major brands of new tires. Stop by 17625 Euclid Ave and we'll show you options and give you a written quote.";
    }
    if (intents.includes("flat_tire") || intents.includes("tire_leak")) {
      return "Thanks for calling Nick’s Tire & Auto. Bring your vehicle by 17625 Euclid Ave and we'll inspect the tire leak. Flat repairs are done while you wait.";
    }
    if (intents.includes("brakes") || intents.includes("suspension") || intents.includes("exhaust")) {
      return "Thanks for calling Nick’s Tire & Auto. You can bring the vehicle in or drop it off at 17625 Euclid Ave and we’ll inspect it before any work is approved.";
    }
    if (intents.includes("diagnostics") || intents.includes("check_engine")) {
      return "Thanks for calling Nick’s Tire & Auto. Bring the vehicle in for a free diagnostic light check and quote before 6 PM today.";
    }
    if (intents.includes("battery") || intents.includes("alternator") || intents.includes("starter")) {
      return "Thanks for calling Nick’s Tire & Auto. Stop by 17625 Euclid Ave for a free battery and alternator test. We can replace batteries on the spot.";
    }
    if (intents.includes("oil_change") || intents.includes("alignment")) {
      return "Thanks for calling Nick’s Tire & Auto. Oil changes and alignments are handled on a first-come, first-served basis. Swing by the shop at your convenience.";
    }
    // 2026-07-20 · never apologize for missing a call we may well have taken —
    // this is the no-intent-matched fallback and fires regardless of whether the
    // caller reached a human. Keep it neutral and forward-looking.
    return "Thanks for calling Nick’s Tire & Auto. Let us know what you need, or stop by 17625 Euclid Ave.";
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

      <VoiceAchievements />

      {/* ─── Transfer destination quick-control ─────── */}
      <TransferDestinationCard />

      {/* ─── wave-114: Follow-Up Caller transfer destination ──
          Compact sub-card. Lives below the receptionist card so the
          operator sees both phone-routing surfaces at a glance. */}
      <FollowUpTransferCard />

      {/* ─── wave-181.67: Live in-flight calls (Phase 4 state machine) ──
          Real-time roster of calls the agent is currently handling +
          their position in the 5-state flow (greeted → intent → tool →
          confirmed → ended). 5s refetch interval. Hides itself when
          zero calls are in flight so quiet hours stay clean. */}
      <LiveCallsCard onSelectCall={setSelectedCallId} />

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
          Missed Revenue Queue
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
              {/* Inferred from call duration (VAPI exposes no "human answered"
                  bit); 14d window; "—" until >=10 forwards make a % meaningful. */}
              <StatCard
                label="Warm-Transfer Connect (14d)"
                value={m.warmTransferConnect?.reliable ? `${m.warmTransferConnect.rate}%` : "—"}
                icon={<UserCheck className="w-4 h-4" />}
                color="text-cyan-400"
                trendLabel={
                  m.warmTransferConnect?.reliable
                    ? `inferred · ${m.warmTransferConnect.connected}/${m.warmTransferConnect.attempted} likely connected · ${m.warmTransferConnect.failed} failed`
                    : `${m.warmTransferConnect?.attempted ?? 0} forwards (14d) · need 10+ for a rate`
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
        /* ─── Missed Revenue Queue Tab ──────────────────────── */
        <div className="space-y-4">
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
                const smsText = getSmsDraft(item.intents, item.evalOutcome);
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
                        
                        {item.isRepeatCaller && (
                          <span className="bg-rose-500/15 text-rose-400 text-[10px] px-2 py-0.5 rounded font-bold border border-rose-500/20">
                            Repeat Caller (+3)
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

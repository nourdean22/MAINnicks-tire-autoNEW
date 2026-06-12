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

  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics, isFetching: metricsFetching } = trpc.vapi.todayMetrics.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false, // only auto-poll for "today"
  });
  const { data: calls, isLoading: callsLoading, refetch: refetchCalls, isFetching: callsFetching } = trpc.vapi.todayCalls.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false,
  });
  // wave-111 — manual refresh for non-"today" ranges (auto-poll off there).
  const handleManualRefresh = () => {
    void refetchMetrics();
    void refetchCalls();
  };
  const refreshing = metricsFetching || callsFetching;
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
          m && !m.ok
            ? { label: "VAPI UNREACHABLE", variant: "danger" }
            : m && m.total > 0
            ? { label: `${m.total} CALLS · ${range.shortLabel.toUpperCase()}`, variant: "success" }
            : { label: rangePreset === "today" ? "QUIET DAY" : `0 CALLS · ${range.shortLabel.toUpperCase()}`, variant: "neutral" }
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

      {/* ─── KPI Tiles ────────────────────────────────────
       * wave-181.x Voice Phase 5 ELON cut · 5→3 tiles · per audit
       * agent: Caller-Ended + Nick-Closed are redundantly shown in
       * the "Why calls ended" BarChart below (L552+) · classic AI-
       * slop 5-tile symmetry pattern (same kill we did on Today +
       * Money). Three tiles · Calls · Forwarded · Total Talk Time ·
       * fits cleanly on mobile without horizontal scroll. */}
      {metricsLoading || !m ? (
        // SkeletonKpiGrid `cols` prop only accepts 4|5|6 · pass 4 for
        // the closest match to the 3-tile post-ELON-cut MetricGrid.
        // Skeleton over-counts by 1 for ~200ms · acceptable.
        <SkeletonKpiGrid cols={4} />
      ) : (
        <MetricGrid cols={3}>
          <StatCard
            label={rangePreset === "today" ? "Today's Calls" : `Calls · ${range.shortLabel}`}
            value={m.total}
            icon={<PhoneCall className="w-4 h-4" />}
            color="text-foreground"
            trend={m.total > 0 ? "up" : "neutral"}
            trendLabel={m.inbound > 0 ? `${m.inbound} inbound` : undefined}
          />
          <StatCard
            label="Forwarded to You"
            value={m.forwarded}
            icon={<PhoneForwarded className="w-4 h-4" />}
            color={m.forwarded > 0 ? "text-amber-400" : "text-muted-foreground"}
            trend={m.forwarded > 0 ? "up" : "neutral"}
            trendLabel={m.total > 0 ? `${Math.round((m.forwarded / m.total) * 100)}% of calls` : undefined}
          />
          <StatCard
            label="Total Talk Time"
            value={fmtDuration(m.totalSeconds)}
            icon={<Clock className="w-4 h-4" />}
            color="text-foreground"
            trendLabel={m.avgSeconds > 0 ? `${fmtDuration(m.avgSeconds)} avg` : undefined}
          />
        </MetricGrid>
      )}

      {/* ─── End reasons breakdown ──────────────────────
       * wave-181.x Voice Phase 5 · was a `grid-cols-3` with a
       * `col-span-2` chart + Quick-math panel. Quick-math
       * deleted · chart now takes full width directly. */}
      <div>
        <Panel title="Why calls ended" subtitle={`Breakdown of end reasons · ${range.shortLabel}`} padding="md">
          {reasonsChart.length === 0 ? (
            <EmptyState
              icon={<PhoneCall className="w-8 h-8" />}
              title="No calls today yet"
              subtitle="Once Nick takes a call, the breakdown appears here."
            />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={reasonsChart} layout="vertical" margin={{ left: 40, right: 12, top: 8, bottom: 8 }}>
                <XAxis type="number" stroke={CHART_THEME.axis} fontSize={11} />
                <YAxis type="category" dataKey="name" stroke={CHART_THEME.axis} fontSize={11} width={120} />
                <Tooltip contentStyle={CHART_THEME.tooltip} />
                <Bar dataKey="value" fill={CHART_THEME.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        {/* wave-181.x Voice Phase 5 ELON cut · "Quick math" Panel
         * deleted · was full duplication of KPI tiles + "Why calls
         * ended" chart. Connect-rate / Avg / Total-talk / Web-vs-
         * phone are all already shown elsewhere on this page. Pure
         * decoration · 30 LOC reclaimed. The m.ok error message moves
         * up to the page-header badge which already shows "VAPI
         * UNREACHABLE" when m.ok === false. */}
      </div>

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
              <span className="w-32">End reason</span>
              <span className="w-6"></span>
            </div>
            {callsList.map((c) => {
              const reason = prettyReason(c.endedReason);
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
                      {c.customerName || fmtPhone(c.customerNumber)}
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
                  <span className={`w-32 text-[11px] font-medium ${reason.color}`}>
                    {reason.label}
                  </span>
                  <span className="w-6 text-foreground/30 text-xs">›</span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

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

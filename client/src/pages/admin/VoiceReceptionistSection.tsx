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
} from "./shared";
import {
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Phone,
  Clock,
  TrendingUp,
  AlertCircle,
  Edit2,
  Save,
  ExternalLink,
  Search,
  ArrowUpDown,
  Calendar,
  X,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
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

// ─── VAPI dashboard URL helpers (wave-89) ───────────────────
// Operator wants escape hatches into the VAPI dashboard for things
// the admin doesn't expose (advanced assistant tuning, phone-number
// config, account billing, etc.). All open in a new tab.
const VAPI_DASHBOARD_BASE = "https://dashboard.vapi.ai";
const VAPI_LINKS = {
  callLogs: `${VAPI_DASHBOARD_BASE}/calls`,
  phoneNumbers: `${VAPI_DASHBOARD_BASE}/phone-numbers`,
  assistants: `${VAPI_DASHBOARD_BASE}/assistants`,
  callDetail: (callId: string) => `${VAPI_DASHBOARD_BASE}/calls/${callId}`,
  assistantDetail: (assistantId: string) =>
    `${VAPI_DASHBOARD_BASE}/assistants/${assistantId}`,
};

// ─── Sort / filter types (wave-89) ──────────────────────────
type SortMode = "newest" | "longest" | "shortest";
const SORT_LABELS: Record<SortMode, string> = {
  newest: "Newest first",
  longest: "Longest first",
  shortest: "Shortest first",
};

// ─── Date range (wave-91) ────────────────────────────────────
// Operator wants to look at calls beyond today. Quick chips for the
// most common windows + a custom range picker for everything else.
type RangePreset = "today" | "7d" | "30d" | "custom";

const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom",
};

function rangeToISO(preset: RangePreset, customSince?: string, customUntil?: string): {
  sinceISO: string;
  untilISO?: string;
  shortLabel: string;
} {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (preset === "today") {
    return { sinceISO: startOfToday.toISOString(), shortLabel: "today" };
  }
  if (preset === "7d") {
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);
    return { sinceISO: since.toISOString(), shortLabel: "last 7 days" };
  }
  if (preset === "30d") {
    const since = new Date(now);
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    return { sinceISO: since.toISOString(), shortLabel: "last 30 days" };
  }
  // custom — expect YYYY-MM-DD strings from <input type=date>
  const since = customSince ? new Date(customSince + "T00:00:00") : startOfToday;
  const until = customUntil ? new Date(customUntil + "T23:59:59.999") : now;
  return {
    sinceISO: since.toISOString(),
    untilISO: until.toISOString(),
    shortLabel:
      customSince && customUntil
        ? `${customSince} → ${customUntil}`
        : "custom range",
  };
}

function defaultDateString(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtPhone(num: string | null): string {
  if (!num) return "Anonymous";
  // +12169264490 → (216) 926-4490
  const digits = num.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return num;
}

const REASON_PRETTY: Record<string, { label: string; color: string }> = {
  "customer-ended-call":     { label: "Caller ended",  color: "text-blue-400" },
  "assistant-ended-call":    { label: "Nick ended",    color: "text-emerald-400" },
  "assistant-forwarded-call":{ label: "Forwarded",     color: "text-amber-400" },
  "assistant-error":         { label: "Assistant error", color: "text-red-400" },
  "phone-call-provider-closed-websocket": { label: "Carrier hangup", color: "text-foreground/40" },
  "silence-timed-out":        { label: "Silence timeout", color: "text-foreground/40" },
  "exceeded-max-duration":    { label: "Hit max duration", color: "text-amber-400" },
  unknown:                    { label: "Unknown",      color: "text-foreground/40" },
};

function prettyReason(reason: string): { label: string; color: string } {
  return REASON_PRETTY[reason] || { label: reason.replace(/-/g, " "), color: "text-foreground/60" };
}

// ─── Date range selector (wave-91) ─────────────────────────
//
// Quick chips: Today / 7d / 30d / Custom. Custom expands two
// <input type="date"> pickers for arbitrary range. Defaults to
// 7-days-ago → today when Custom is selected fresh.

function DateRangeSelector({
  preset,
  onPresetChange,
  customSince,
  customUntil,
  onCustomSinceChange,
  onCustomUntilChange,
}: {
  preset: RangePreset;
  onPresetChange: (p: RangePreset) => void;
  customSince: string;
  customUntil: string;
  onCustomSinceChange: (v: string) => void;
  onCustomUntilChange: (v: string) => void;
}) {
  return (
    <div className="bg-card border border-border/30 rounded p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 shrink-0">
        <Calendar className="w-4 h-4 text-foreground/50" />
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/50">
          Range
        </span>
      </div>
      <div className="inline-flex items-center gap-1 bg-background border border-border/30 rounded-md p-1">
        {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
          <button
            key={p}
            onClick={() => onPresetChange(p)}
            className={
              "px-3 py-1 text-[12px] font-semibold tracking-wide rounded transition-colors " +
              (preset === p
                ? "bg-primary text-primary-foreground"
                : "text-foreground/60 hover:text-foreground hover:bg-foreground/5")
            }
          >
            {RANGE_LABELS[p]}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2 ml-1">
          <input
            type="date"
            value={customSince}
            max={customUntil}
            onChange={(e) => onCustomSinceChange(e.target.value)}
            className="bg-background border border-border/30 rounded px-2 py-1 text-[12px] font-mono text-foreground focus:border-primary/50 focus:outline-none"
          />
          <span className="text-foreground/40 text-[12px]">→</span>
          <input
            type="date"
            value={customUntil}
            min={customSince}
            max={defaultDateString(0)}
            onChange={(e) => onCustomUntilChange(e.target.value)}
            className="bg-background border border-border/30 rounded px-2 py-1 text-[12px] font-mono text-foreground focus:border-primary/50 focus:outline-none"
          />
        </div>
      )}
      {preset !== "today" && (
        <span className="text-[10px] text-foreground/40 ml-auto italic">
          Auto-refresh paused — manually reload to pull fresh data
        </span>
      )}
    </div>
  );
}

// ─── Header dashboard-links + filter chip helpers (wave-89) ─

function VapiDashboardLinks({ assistantId }: { assistantId: string | null }) {
  const linkClass =
    "inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase " +
    "text-foreground/60 hover:text-primary border border-border/40 hover:border-primary/40 " +
    "rounded px-2 py-1 transition-colors";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <a
        href={assistantId ? VAPI_LINKS.assistantDetail(assistantId) : VAPI_LINKS.assistants}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        title="Edit Nick's prompt, tools, model in VAPI"
      >
        Assistant <ExternalLink className="w-3 h-3" />
      </a>
      <a
        href={VAPI_LINKS.callLogs}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        title="Full call history (beyond today) in VAPI"
      >
        All Calls <ExternalLink className="w-3 h-3" />
      </a>
      <a
        href={VAPI_LINKS.phoneNumbers}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        title="Phone number config + routing rules"
      >
        Phone Lines <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone = "neutral",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  // Tone => active background tint per end-reason
  const tones: Record<string, string> = {
    "customer-ended-call":     "bg-blue-500/15 border-blue-500/40 text-blue-400",
    "assistant-ended-call":    "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
    "assistant-forwarded-call":"bg-amber-500/15 border-amber-500/40 text-amber-400",
    neutral:                   "bg-primary/15 border-primary/40 text-primary",
  };
  const activeClass = tones[tone] || tones.neutral;
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] " +
        "border transition-colors " +
        (active
          ? activeClass
          : "border-border/30 text-foreground/55 hover:border-foreground/30 hover:text-foreground/80")
      }
    >
      <span>{label}</span>
      <span className={"text-[10px] tabular-nums " + (active ? "" : "text-foreground/40")}>
        {count}
      </span>
    </button>
  );
}

// ─── Section ────────────────────────────────────────────────
export default function VoiceReceptionistSection() {
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  // Wave-89 — sort + filter state
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string | null>(null); // null = "all"

  // Wave-91 — date range state
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  const [customSince, setCustomSince] = useState<string>(() => defaultDateString(7));
  const [customUntil, setCustomUntil] = useState<string>(() => defaultDateString(0));

  const range = rangeToISO(rangePreset, customSince, customUntil);
  const queryInput = { sinceISO: range.sinceISO, untilISO: range.untilISO };

  const { data: metrics, isLoading: metricsLoading } = trpc.vapi.todayMetrics.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false, // only auto-poll for "today"
  });
  const { data: calls, isLoading: callsLoading } = trpc.vapi.todayCalls.useQuery(queryInput, {
    refetchInterval: rangePreset === "today" ? 60_000 : false,
  });
  const { data: vapiStatus } = trpc.vapi.status.useQuery(undefined, { staleTime: 5 * 60_000 });

  const rawCalls = calls ?? [];
  const m = metrics ?? null;
  const assistantId = vapiStatus?.assistants?.[0]?.id ?? null;

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
        actions={<VapiDashboardLinks assistantId={assistantId} />}
      />

      {/* ─── Transfer destination quick-control ─────── */}
      <TransferDestinationCard />

      {/* ─── Wave-102: free-form outbound call trigger ─ */}
      <OutboundCallCard />

      {/* ─── Date range selector (wave-91) ───────────── */}
      <DateRangeSelector
        preset={rangePreset}
        onPresetChange={setRangePreset}
        customSince={customSince}
        customUntil={customUntil}
        onCustomSinceChange={setCustomSince}
        onCustomUntilChange={setCustomUntil}
      />

      {/* ─── KPI Tiles ──────────────────────────────────── */}
      {metricsLoading || !m ? (
        <SkeletonKpiGrid cols={5} />
      ) : (
        <MetricGrid cols={5}>
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
            label="Caller Ended"
            value={m.customerEnded}
            icon={<PhoneOff className="w-4 h-4" />}
            color="text-blue-400"
            trendLabel={m.total > 0 ? `${Math.round((m.customerEnded / m.total) * 100)}% of calls` : undefined}
          />
          <StatCard
            label="Nick Closed"
            value={m.assistantEnded}
            icon={<TrendingUp className="w-4 h-4" />}
            color="text-emerald-400"
            trendLabel={m.total > 0 ? `${Math.round((m.assistantEnded / m.total) * 100)}% of calls` : undefined}
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

      {/* ─── End reasons + Cost breakdown ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Why calls ended" subtitle={`Breakdown of end reasons · ${range.shortLabel}`} padding="md" className="lg:col-span-2">
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

        <Panel title="Quick math" subtitle={range.shortLabel.charAt(0).toUpperCase() + range.shortLabel.slice(1)} padding="md">
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-foreground/60">Connect rate</dt>
              <dd className="font-mono tabular-nums">
                {m && m.total > 0 ? `${Math.round(((m.assistantEnded + m.forwarded) / m.total) * 100)}%` : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-foreground/60">Avg call length</dt>
              <dd className="font-mono tabular-nums">{m ? fmtDuration(m.avgSeconds) : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-foreground/60">Total talk time</dt>
              <dd className="font-mono tabular-nums">{m ? fmtDuration(m.totalSeconds) : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-foreground/60">Web vs phone</dt>
              <dd className="font-mono tabular-nums text-xs">
                {m ? `${m.inbound + m.outbound} phone · ${m.web} web` : "—"}
              </dd>
            </div>
            {m && !m.ok && (
              <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>VAPI API unreachable — numbers may be stale.</span>
              </div>
            )}
          </dl>
        </Panel>
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
              <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search number / name / summary"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-background border border-border/30 rounded pl-7 pr-2.5 py-1.5 text-[12px] text-foreground placeholder:text-foreground/30 focus:border-primary/50 focus:outline-none"
                />
              </div>

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
              <span className="text-[10px] uppercase tracking-wider text-foreground/40 mr-1">Filter:</span>
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
            <div className="flex items-center gap-3 px-4 py-2.5 bg-foreground/[0.02] text-[10px] font-bold tracking-wider uppercase text-foreground/40">
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

// ─── Transfer Destination Card ─────────────────────────────
//
// Operator pain point this fixes: managers swap depending on who's on
// shift, and the transferCall destination has historically required
// logging into the VAPI dashboard to change.
//
// Wave-87: this card surfaces the current number + inline edit.
// Wave-88: per-shift presets stored in shop_settings render as
//          one-click chips. "Save current as preset" lets operators
//          build their library — Manager A cell, Manager B cell,
//          Owner cell, etc. The Shop Landline reset chip is always
//          present as a safe fallback even if presets are empty.

const SHOP_LANDLINE_RESET = {
  label: "Shop Landline · Reset",
  number: "+12168620005",
  description: "(216) 862-0005 · always reaches the front counter",
};

function TransferDestinationCard() {
  const utils = trpc.useUtils();
  const { data: dest, isLoading } = trpc.vapi.getTransferDestination.useQuery(undefined, {
    refetchInterval: 5 * 60_000, // 5 min — operator usually changes once + monitors
  });
  const { data: presets = [] } = trpc.vapi.listTransferPresets.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [editing, setEditing] = useState(false);
  const [draftNumber, setDraftNumber] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");

  const setDest = trpc.vapi.setTransferDestination.useMutation({
    onSuccess: (result) => {
      toast.success(`Calls now forward to ${fmtPhone(result.newNumber)}`);
      utils.vapi.getTransferDestination.invalidate();
      setEditing(false);
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message.slice(0, 100)}`);
    },
  });

  const savePreset = trpc.vapi.saveTransferPreset.useMutation({
    onSuccess: () => {
      toast.success(`Preset saved: ${newPresetLabel}`);
      utils.vapi.listTransferPresets.invalidate();
      setShowSavePreset(false);
      setNewPresetLabel("");
    },
    onError: (err) => toast.error(`Failed to save preset: ${err.message.slice(0, 80)}`),
  });

  const deletePreset = trpc.vapi.deleteTransferPreset.useMutation({
    onSuccess: () => {
      utils.vapi.listTransferPresets.invalidate();
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message.slice(0, 80)}`),
  });

  const startEdit = () => {
    setDraftNumber(dest?.ok ? dest.currentNumber || "" : "");
    setDraftMessage(dest?.ok ? dest.currentMessage || "" : "");
    setEditing(true);
  };

  const submit = () => {
    if (!draftNumber.match(/^\+1\d{10}$/)) {
      toast.error("Number must be E.164 format: +1 followed by 10 digits");
      return;
    }
    setDest.mutate({
      phoneNumber: draftNumber,
      message: draftMessage || undefined,
    });
  };

  const usePreset = (number: string, message?: string) => {
    setDest.mutate({ phoneNumber: number, message });
  };

  const handleSavePresetSubmit = () => {
    const label = newPresetLabel.trim();
    if (!label) {
      toast.error("Give the preset a label first");
      return;
    }
    if (!draftNumber.match(/^\+1\d{10}$/)) {
      toast.error("Type a valid E.164 number first");
      return;
    }
    savePreset.mutate({
      label,
      number: draftNumber,
      message: draftMessage || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 rounded p-4">
        <div className="h-4 w-40 bg-foreground/10 animate-pulse rounded mb-2" />
        <div className="h-7 w-56 bg-foreground/15 animate-pulse rounded" />
      </div>
    );
  }

  if (!dest?.ok) {
    return (
      <div className="bg-card border border-red-500/30 rounded p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-bold text-red-400">Transfer destination unknown</div>
          <div className="text-[12px] text-foreground/60 mt-0.5">
            {dest?.error || "VAPI API unreachable. Calls may still be forwarding correctly — check the VAPI dashboard directly."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-primary/20 rounded p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PhoneForwarded className="w-4 h-4 text-primary/80" />
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/50">
              Calls forward to
            </span>
          </div>
          {editing ? (
            <div className="space-y-2 mt-1">
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  value={draftNumber}
                  onChange={(e) => setDraftNumber(e.target.value)}
                  placeholder="+12168620005"
                  className="bg-background border border-border/40 rounded-md px-3 py-2 text-sm font-mono w-56 focus:border-primary focus:outline-none"
                  autoFocus
                  disabled={setDest.isPending}
                />
                <button
                  onClick={submit}
                  disabled={setDest.isPending}
                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-xs font-bold tracking-wide hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {setDest.isPending ? (
                    <span className="w-3 h-3 border border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={setDest.isPending}
                  className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-foreground px-2 py-2 text-xs transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                placeholder="What Nick says before transferring (optional)"
                className="bg-background border border-border/40 rounded-md px-3 py-1.5 text-[12px] w-full max-w-md focus:border-primary focus:outline-none"
                disabled={setDest.isPending}
                maxLength={200}
              />
              <p className="text-[10px] text-foreground/40">
                Format: +1 followed by 10 digits (e.g. +12168620005)
              </p>
            </div>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="font-mono font-bold text-2xl tracking-tight text-foreground tabular-nums">
                {dest.currentNumber ? fmtPhone(dest.currentNumber) : "—"}
              </div>
              {dest.currentMessage && (
                <div className="text-[11px] text-foreground/50 italic max-w-md">
                  "{dest.currentMessage.slice(0, 100)}{dest.currentMessage.length > 100 ? "…" : ""}"
                </div>
              )}
            </div>
          )}
        </div>

        {!editing && (
          <button
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-foreground border border-border/40 hover:border-primary/50 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Change
          </button>
        )}
      </div>

      {/* wave-109: explain that this number doubles as the on-duty alert target */}
      {!editing && dest.currentNumber && (
        <div className="mt-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-md">
          <p className="text-[11px] text-foreground/60 leading-relaxed">
            <strong className="text-foreground/80">Doubles as the on-duty alert number.</strong>{" "}
            Every new booking, lead, callback, and emergency from nickstire.org
            also fires an SMS to this number from 216-862-0005. Change it here
            and alerts auto-route to the new manager within 5 min.
          </p>
        </div>
      )}

      {/* Quick-pick chips when editing — saved presets + landline reset */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-border/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/40">
              Quick destinations {presets.length > 0 && <span className="text-foreground/30 ml-1">({presets.length})</span>}
            </span>
            {!showSavePreset && (
              <button
                onClick={() => setShowSavePreset(true)}
                disabled={!draftNumber.match(/^\+1\d{10}$/) || setDest.isPending}
                className="text-[10px] font-bold tracking-wider uppercase text-primary hover:underline disabled:opacity-30 disabled:no-underline"
                title="Save the current draft number as a labeled preset"
              >
                + Save current as preset
              </button>
            )}
          </div>

          {/* Inline save-preset prompt */}
          {showSavePreset && (
            <div className="mb-3 p-2.5 rounded bg-primary/5 border border-primary/20 flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder='Label (e.g. "Manager Joe", "Owner cell")'
                value={newPresetLabel}
                onChange={(e) => setNewPresetLabel(e.target.value)}
                maxLength={40}
                autoFocus
                className="bg-background border border-border/40 rounded-md px-2.5 py-1.5 text-xs flex-1 min-w-[180px] focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleSavePresetSubmit}
                disabled={savePreset.isPending}
                className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md text-[11px] font-bold tracking-wide hover:opacity-90 disabled:opacity-50"
              >
                {savePreset.isPending ? (
                  <span className="w-3 h-3 border border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                Save preset
              </button>
              <button
                onClick={() => { setShowSavePreset(false); setNewPresetLabel(""); }}
                className="text-[11px] text-foreground/50 hover:text-foreground px-2 py-1.5"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Saved presets */}
            {presets.map((p) => (
              <div key={p.label} className="relative group">
                <button
                  onClick={() => usePreset(p.number, p.message)}
                  disabled={setDest.isPending}
                  className="text-left bg-background border border-border/40 hover:border-primary/50 rounded-md pl-3 pr-7 py-2 text-xs transition-colors disabled:opacity-50"
                >
                  <div className="font-bold tracking-wide">{p.label}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5 font-mono tabular-nums">
                    {fmtPhone(p.number)}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete preset "${p.label}"?`)) {
                      deletePreset.mutate({ label: p.label });
                    }
                  }}
                  disabled={deletePreset.isPending}
                  title="Delete preset"
                  aria-label={`Delete preset ${p.label}`}
                  className="absolute top-1 right-1 w-5 h-5 rounded text-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Hardcoded landline reset — always present as safe fallback */}
            <button
              onClick={() => usePreset(SHOP_LANDLINE_RESET.number)}
              disabled={setDest.isPending}
              className="text-left bg-background border border-border/40 hover:border-primary/40 rounded-md px-3 py-2 text-xs transition-colors disabled:opacity-50 group"
            >
              <div className="font-bold tracking-wide group-hover:text-primary transition-colors">{SHOP_LANDLINE_RESET.label}</div>
              <div className="text-[10px] text-foreground/50 mt-0.5">{SHOP_LANDLINE_RESET.description}</div>
            </button>
          </div>

          {presets.length === 0 && (
            <p className="text-[10px] text-foreground/40 mt-2 italic">
              No presets saved yet. Type a number above and click "Save current as preset" to build your shift roster.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Wave-102 · Outbound call trigger ───────────────────────
// Free-form dialer for any number — not gated to existing customers.
// Uses the same VAPI follow-up assistant + same 3-min cap.
function OutboundCallCard() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [lastService, setLastService] = useState("recent visit");

  const mutation = trpc.vapi.makeFollowUpCall.useMutation({
    onSuccess: (result) => {
      if (result.success && result.callId) {
        toast.success(`Call queued (${result.callId.slice(0, 8)}...). Nick is dialing now.`);
        setPhone("");
        setName("");
        setLastService("recent visit");
      } else {
        toast.error(`Call failed: ${result.error || "unknown error"}`);
      }
    },
    onError: (err) => toast.error(`Call failed: ${err.message}`),
  });

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 10 || phoneDigits.length === 11;

  return (
    <div className="bg-card border border-emerald-500/20 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <Phone className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wider">OUTBOUND CALL</h3>
          <p className="text-[10px] text-foreground/40">
            Fire Nick at any number. Follow-up tone · 3-min cap · asks for referrals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[9px] text-foreground/40 tracking-wider uppercase block mb-1">Phone (required)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="216-862-0005"
            className="w-full bg-background border border-border/30 px-3 py-2 text-sm text-foreground font-mono focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[9px] text-foreground/40 tracking-wider uppercase block mb-1">First name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="buddy"
            className="w-full bg-background border border-border/30 px-3 py-2 text-sm text-foreground focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[9px] text-foreground/40 tracking-wider uppercase block mb-1">What for? (optional)</label>
          <input
            type="text"
            value={lastService}
            onChange={(e) => setLastService(e.target.value)}
            placeholder="recent visit"
            className="w-full bg-background border border-border/30 px-3 py-2 text-sm text-foreground focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] text-foreground/40">
          Caller ID: <span className="font-mono">+1 216 424 9249</span> · Assistant: <span className="font-mono">Nick's Tire Follow-Up Caller</span>
        </div>
        <button
          onClick={() => {
            if (!phoneValid) {
              toast.error("Phone needs to be 10 or 11 digits");
              return;
            }
            const finalName = name.trim() || "buddy";
            const confirm = window.confirm(
              `Call ${phone} as a follow-up?\n\nNick will say:\n"${finalName}? ... Hope you're doing good, this is Nick from Nick's Tire and Auto, just following up after your last visit. How is everything?"\n\nProceed?`
            );
            if (!confirm) return;
            mutation.mutate({
              customerName: finalName,
              phone,
              lastService: lastService.trim() || "recent visit",
            });
          }}
          disabled={!phoneValid || mutation.isPending}
          className="flex items-center gap-2 px-5 py-2 text-[11px] tracking-wider font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
          DIAL NOW
        </button>
      </div>
    </div>
  );
}

// ─── Drawer ─────────────────────────────────────────────────
function CallDetailsDrawer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { data: details, isLoading } = trpc.vapi.callDetails.useQuery(
    { callId },
    { staleTime: 5 * 60_000 },
  );

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="ml-auto relative z-10 w-full max-w-2xl bg-background border-l border-border/40 overflow-y-auto"
      >
        <div className="sticky top-0 bg-background/90 backdrop-blur-md border-b border-border/30 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-wide">Call detail</h3>
            <p className="text-[11px] text-foreground/50 font-mono">{callId.slice(0, 16)}…</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={VAPI_LINKS.callDetail(callId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase text-foreground/60 hover:text-primary border border-border/40 hover:border-primary/40 rounded px-2 py-1 transition-colors"
              title="Open this call in the VAPI dashboard (recordings, raw events, etc.)"
            >
              Open in VAPI <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={onClose}
              className="text-foreground/50 hover:text-foreground text-xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {isLoading || !details ? (
            <div className="space-y-2">
              <div className="h-4 w-32 bg-foreground/10 animate-pulse rounded" />
              <div className="h-3 w-full bg-foreground/8 animate-pulse rounded" />
              <div className="h-3 w-3/4 bg-foreground/8 animate-pulse rounded" />
              <div className="h-3 w-5/6 bg-foreground/8 animate-pulse rounded" />
            </div>
          ) : (
            <>
              {/* Wave-90 — TRANSCRIPT FIRST. Operator wants to read what was
                  actually said as the primary content; metadata grid is below. */}

              {/* Compact one-line strip: caller · time · duration · end reason */}
              <div className="flex items-center gap-2 text-[12px] flex-wrap pb-3 border-b border-border/20">
                <span className="font-bold text-foreground">
                  {details.customerName || fmtPhone(details.customerNumber)}
                </span>
                <span className="text-foreground/30">·</span>
                <span className="font-mono tabular-nums text-foreground/70">
                  {fmtDuration(details.durationSeconds)}
                </span>
                <span className="text-foreground/30">·</span>
                <span className={prettyReason(details.endedReason).color + " font-medium"}>
                  {prettyReason(details.endedReason).label}
                </span>
                <span className="text-foreground/30">·</span>
                <span className="font-mono tabular-nums text-foreground/50 text-[11px]">
                  {details.createdAt ? new Date(details.createdAt).toLocaleString() : "—"}
                </span>
              </div>

              {/* Recording — keeps prime real estate so you can listen while reading */}
              {details.recordingUrl && (
                <div className="rounded border border-border/30 bg-card/40 p-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-foreground/40 shrink-0">
                    Recording
                  </span>
                  <audio controls src={details.recordingUrl} className="flex-1 h-8" />
                </div>
              )}

              {/* TRANSCRIPT — primary content. Only conversation turns
                  (caller + Nick); system prompts + tool/function messages
                  filtered out (they dominate otherwise — the system prompt
                  is the entire AI identity ~2KB of text). For raw
                  message stream incl. system + tool, use "Open in VAPI". */}
              {(() => {
                const conversation = details.messages.filter(
                  (m) => m.role === "user" || m.role === "bot" || m.role === "assistant",
                );
                if (conversation.length === 0 && !details.transcript) {
                  return (
                    <div className="text-center py-8 text-[12px] text-foreground/40">
                      No conversation captured for this call.
                      {details.messages.length > 0 && (
                        <div className="mt-1 text-[11px]">
                          ({details.messages.length} system/tool message{details.messages.length === 1 ? "" : "s"} hidden — open in VAPI for raw stream)
                        </div>
                      )}
                    </div>
                  );
                }
                if (conversation.length === 0 && details.transcript) {
                  return (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-bold text-foreground/60 mb-2">
                        Transcript
                      </div>
                      <pre className="text-[13px] leading-relaxed whitespace-pre-wrap font-sans bg-card/40 border border-border/30 rounded p-3">
                        {details.transcript}
                      </pre>
                    </div>
                  );
                }
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/60">
                        Transcript ({conversation.length} {conversation.length === 1 ? "turn" : "turns"})
                      </span>
                      <span className="text-[10px] text-foreground/30">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1 align-middle" />
                        Caller
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ml-3 mr-1 align-middle" />
                        Nick
                      </span>
                    </div>
                    <div className="space-y-2">
                      {conversation.map((msg, i) => {
                        const isUser = msg.role === "user";
                        return (
                          <div
                            key={i}
                            className={`text-[13px] leading-relaxed rounded p-2.5 ${
                              isUser
                                ? "bg-blue-500/10 border-l-2 border-blue-500/50"
                                : "bg-emerald-500/10 border-l-2 border-emerald-500/50"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[9px] uppercase tracking-wider font-bold text-foreground/50">
                                {isUser ? "Caller" : "Nick"}
                              </span>
                              {msg.secondsFromStart !== null && (
                                <span className="text-[9px] font-mono text-foreground/30">
                                  {Math.round(msg.secondsFromStart || 0)}s
                                </span>
                              )}
                            </div>
                            {msg.message && <div className="text-foreground/90">{msg.message}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Below-transcript: secondary detail (collapsed by default) */}
              <details className="rounded border border-border/30 bg-card/30">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-foreground/60 hover:text-foreground select-none">
                  Call detail + tool calls{details.toolCalls.length > 0 ? ` (${details.toolCalls.length})` : ""}
                </summary>
                <div className="px-3 py-3 border-t border-border/20 space-y-3">
                  {/* Metadata grid */}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {details.cost !== null && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-foreground/40">Cost</dt>
                        <dd className="font-mono tabular-nums">${details.cost.toFixed(3)}</dd>
                      </div>
                    )}
                    {details.successEvaluation && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-foreground/40">VAPI Success Eval</dt>
                        <dd className="text-[12px]">{details.successEvaluation}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-foreground/40">Call ID</dt>
                      <dd className="font-mono text-[11px] text-foreground/70 break-all">{details.id}</dd>
                    </div>
                  </dl>

                  {/* Summary (AI-generated) */}
                  {details.summary && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">AI Summary</div>
                      <div className="text-[12px] leading-relaxed text-foreground/80">{details.summary}</div>
                    </div>
                  )}

                  {/* Tool calls */}
                  {details.toolCalls.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-primary/80 mb-2">
                        Tool calls
                      </div>
                      <ul className="space-y-1.5">
                        {details.toolCalls.map((tc, i) => (
                          <li key={i} className="text-[12px]">
                            <span className="font-mono font-bold text-primary">{tc.name}</span>
                            {tc.time !== undefined && (
                              <span className="text-foreground/40 ml-2">@{Math.round(tc.time)}s</span>
                            )}
                            <pre className="mt-0.5 text-[11px] text-foreground/60 font-mono whitespace-pre-wrap break-all bg-background/40 rounded p-1.5">
                              {tc.args}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

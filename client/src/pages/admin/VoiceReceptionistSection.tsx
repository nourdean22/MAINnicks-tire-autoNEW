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
  Clock,
  TrendingUp,
  AlertCircle,
  Edit2,
  Save,
  X,
  CheckCircle2,
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

// ─── Section ────────────────────────────────────────────────
export default function VoiceReceptionistSection() {
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const { data: metrics, isLoading: metricsLoading } = trpc.vapi.todayMetrics.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: calls, isLoading: callsLoading } = trpc.vapi.todayCalls.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const callsList = calls ?? [];
  const m = metrics ?? null;

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
            ? { label: `${m.total} CALLS TODAY`, variant: "success" }
            : { label: "QUIET DAY", variant: "neutral" }
        }
      />

      {/* ─── Transfer destination quick-control ─────── */}
      <TransferDestinationCard />

      {/* ─── KPI Tiles ──────────────────────────────────── */}
      {metricsLoading || !m ? (
        <SkeletonKpiGrid cols={5} />
      ) : (
        <MetricGrid cols={5}>
          <StatCard
            label="Today's Calls"
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
        <Panel title="Why calls ended" subtitle="Breakdown of end reasons today" padding="md" className="lg:col-span-2">
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

        <Panel title="Quick math" subtitle="Today" padding="md">
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

      {/* ─── Recent calls table ────────────────────────── */}
      <Panel title="Today's Calls" subtitle="Click any row to see transcript + tool calls" padding="none">
        {callsLoading ? (
          <SkeletonTable rows={6} cells={5} />
        ) : callsList.length === 0 ? (
          <EmptyState
            icon={<PhoneCall className="w-8 h-8" />}
            title="No calls yet today"
            subtitle="Calls appear here within ~60 seconds of ending."
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
// logging into the VAPI dashboard to change. This card surfaces the
// current number inline + lets the operator change it in one click.
//
// Only valid US E.164 numbers (+1 + 10 digits) are accepted — VAPI
// rejects anything else. Common destinations are pre-filled as quick
// chips so the most common changes are zero-typing.
// Hardcoded reset target: the main shop landline. Always reaches whoever
// is at the front counter, so it's the safe default when the manager-on-shift
// isn't reachable. Operators can type any +1 number directly in the input
// for one-off destinations (mobile cells, etc.).
const QUICK_DESTINATIONS: Array<{ label: string; number: string; description: string }> = [
  {
    label: "Shop Landline · Reset",
    number: "+12168620005",
    description: "(216) 862-0005 · always reaches whoever's at the front counter",
  },
];

function TransferDestinationCard() {
  const utils = trpc.useUtils();
  const { data: dest, isLoading } = trpc.vapi.getTransferDestination.useQuery(undefined, {
    refetchInterval: 5 * 60_000, // 5 min — operator usually changes once + monitors
  });
  const [editing, setEditing] = useState(false);
  const [draftNumber, setDraftNumber] = useState("");
  const [draftMessage, setDraftMessage] = useState("");

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

  const useQuick = (q: typeof QUICK_DESTINATIONS[number]) => {
    setDest.mutate({ phoneNumber: q.number });
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

      {/* Quick-pick chips when editing */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-border/20">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/40 mb-2">
            Quick destinations
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_DESTINATIONS.map((q) => (
              <button
                key={q.label}
                onClick={() => useQuick(q)}
                disabled={setDest.isPending}
                className="text-left bg-background border border-border/40 hover:border-primary/40 rounded-md px-3 py-2 text-xs transition-colors disabled:opacity-50 group"
              >
                <div className="font-bold tracking-wide group-hover:text-primary transition-colors">{q.label}</div>
                <div className="text-[10px] text-foreground/50 mt-0.5">{q.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}
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
          <button
            onClick={onClose}
            className="text-foreground/50 hover:text-foreground text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
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
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-foreground/40">Caller</dt>
                  <dd className="font-medium">{details.customerName || fmtPhone(details.customerNumber)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-foreground/40">Time</dt>
                  <dd className="font-mono tabular-nums text-[13px]">
                    {details.createdAt ? new Date(details.createdAt).toLocaleString() : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-foreground/40">Duration</dt>
                  <dd className="font-mono tabular-nums">{fmtDuration(details.durationSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-foreground/40">End reason</dt>
                  <dd className={prettyReason(details.endedReason).color + " font-medium"}>
                    {prettyReason(details.endedReason).label}
                  </dd>
                </div>
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
              </dl>

              {details.summary && (
                <div className="rounded border border-border/30 bg-card/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Summary</div>
                  <div className="text-[13px] leading-relaxed">{details.summary}</div>
                </div>
              )}

              {details.toolCalls.length > 0 && (
                <div className="rounded border border-primary/20 bg-primary/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-primary/80 mb-2">
                    Tool calls ({details.toolCalls.length})
                  </div>
                  <ul className="space-y-1.5">
                    {details.toolCalls.map((tc, i) => (
                      <li key={i} className="text-[12px]">
                        <span className="font-mono font-bold text-primary">{tc.name}</span>
                        {tc.time !== undefined && <span className="text-foreground/40 ml-2">@{Math.round(tc.time)}s</span>}
                        <pre className="mt-0.5 text-[11px] text-foreground/60 font-mono whitespace-pre-wrap break-all bg-background/40 rounded p-1.5">
                          {tc.args}
                        </pre>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {details.recordingUrl && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Recording</div>
                  <audio controls src={details.recordingUrl} className="w-full" />
                </div>
              )}

              {details.messages.length > 0 ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">
                    Transcript ({details.messages.length} messages)
                  </div>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {details.messages.map((msg, i) => {
                      const isUser = msg.role === "user";
                      const isBot = msg.role === "bot" || msg.role === "assistant";
                      return (
                        <div
                          key={i}
                          className={`text-[12px] leading-relaxed rounded p-2 ${
                            isUser
                              ? "bg-blue-500/10 border-l-2 border-blue-500/50"
                              : isBot
                              ? "bg-emerald-500/10 border-l-2 border-emerald-500/50"
                              : "bg-foreground/5 border-l-2 border-foreground/20"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-foreground/50">
                              {isBot ? "Nick" : msg.role}
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
              ) : details.transcript ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">Transcript</div>
                  <pre className="text-[12px] whitespace-pre-wrap font-sans bg-card/40 border border-border/30 rounded p-3">
                    {details.transcript}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

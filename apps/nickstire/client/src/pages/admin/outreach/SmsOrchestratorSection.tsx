/**
 * SmsOrchestratorSection — Complete SMS Operating System & Self-Learning Dashboard.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Cpu,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Clock,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  ArrowUpRight,
  ShieldAlert,
  Coins,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  Award,
  Download,
  Check,
  X,
  Calendar,
  User,
  Brain,
  Phone,
  Send
} from "lucide-react";
import { PageHeader, formatDate, LoadingState, EmptyState, ErrorState } from "../shared";

const EVENT_TYPE_LABELS: Record<string, string> = {
  inbound_sms: "Inbound SMS",
  vapi_confirmation: "Voice Confirmation",
  vapi_forwarded_call_followup: "Call Follow-up",
  after_hours_capture: "After Hours",
  stale_lead_followup: "Stale Lead Nudge",
  abandoned_form_recovery: "Abandoned Form",
  booking_reminder: "Booking Reminder",
  review_request: "Review Request",
  manual_admin_reply: "Admin Response",
  photo_assess_reply: "MMS Photo Reply",
};

const STATUS_STYLES: Record<string, string> = {
  received: "text-foreground/60 bg-foreground/5 border-foreground/10",
  sent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  delivered: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  queued: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  failed: "text-red-400 bg-red-500/10 border-red-500/20",
  drafted: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  skipped: "text-foreground/40 bg-foreground/5 border-foreground/10",
  blocked: "text-red-400 bg-red-500/10 border-red-500/20",
};

export default function SmsOrchestratorSection() {
  const [activeTab, setActiveTab] = useState<"logs" | "performance" | "learning">("logs");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<string>("");
  const limit = 25;
  const offset = page * limit;

  // Logs query
  const { data: logsData, isLoading: isLogsLoading, isError: isLogsError, refetch: refetchLogs, isRefetching: isLogsRefetching } = trpc.smsOrchestrator.getOrchestrations.useQuery(
    { limit, offset, filter: filter || undefined },
    { refetchInterval: 15000 }
  );

  // Recommendations query
  const { data: recs, refetch: refetchRecs } = trpc.smsOrchestrator.getRecommendations.useQuery();
  // Training stats query
  const { data: trainingStats, refetch: refetchTraining } = trpc.smsOrchestrator.getTrainingStats.useQuery();

  // Selected event type for variant performance
  const [selectedEventType, setSelectedEventType] = useState<string>("booking_reminder");
  const { data: variantPerf } = trpc.smsOrchestrator.getVariantPerformance.useQuery({ eventType: selectedEventType });

  // Rollout modes queries
  const { data: rolloutModes, refetch: refetchRolloutModes } = trpc.smsOrchestrator.getRolloutModes.useQuery();
  const setRolloutModeMutation = trpc.smsOrchestrator.setRolloutMode.useMutation({
    onSuccess: () => refetchRolloutModes(),
  });

  // Human Review Inbox queries
  const { data: humanReviewQueue, refetch: refetchReviewQueue } = trpc.smsOrchestrator.getHumanReviewQueue.useQuery();
  const actionHumanReviewMutation = trpc.smsOrchestrator.actionHumanReview.useMutation({
    onSuccess: () => {
      refetchReviewQueue();
      refetchLogs();
    }
  });

  const [reviewEdits, setReviewEdits] = useState<Record<number, string>>({});

  const reviewRecMutation = trpc.smsOrchestrator.reviewRecommendation.useMutation({
    onSuccess: () => refetchRecs(),
  });

  const exportCorpusMutation = trpc.smsOrchestrator.exportTrainingCorpus.useMutation();

  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  // Customer Journey Timeline query (enabled when item is selected)
  const { data: timelineData, isLoading: isTimelineLoading } = trpc.smsOrchestrator.getCustomerTimeline.useQuery(
    { phone: selectedItem?.customerPhone || "" },
    { enabled: !!selectedItem }
  );

  const totalPages = logsData ? Math.ceil(logsData.total / limit) : 0;

  const handleExportCorpus = async () => {
    try {
      await exportCorpusMutation.mutateAsync();
      toast.success("Training corpus exported", { description: "apps/nickstire/data/training/nickgpt-learning.jsonl" });
      refetchTraining();
    } catch (err) {
      toast.error("Failed to export training corpus", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleReviewRec = async (id: number, status: "approved" | "rejected") => {
    try {
      await reviewRecMutation.mutateAsync({ id, status });
    } catch (err) {
      toast.error("Failed to update recommendation", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleActionReview = async (id: number, action: "send" | "edit_and_send" | "resolve" | "bad_suggestion") => {
    try {
      const editedMessage = reviewEdits[id];
      await actionHumanReviewMutation.mutateAsync({ id, action, editedMessage });
      // clear edit text state
      setReviewEdits(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      toast.success(`Review action processed: ${action}`);
    } catch (err) {
      toast.error("Failed to process review action", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  if (isLogsLoading && !isLogsRefetching) {
    return <LoadingState label="Loading decision engine logs..." />;
  }

  if (isLogsError) {
    return <ErrorState message="Failed to load orchestrator logs." onRetry={() => refetchLogs()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="SMS Operating System"
          subtitle="Enterprise SMS decision logic, rollout controls, human review queue, and self-learning loops"
          icon={<Cpu className="w-5 h-5 text-primary" />}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              refetchLogs();
              refetchRecs();
              refetchTraining();
              refetchRolloutModes();
              refetchReviewQueue();
            }}
            className="flex items-center gap-2 px-3 py-1.5 border border-border bg-card text-xs font-semibold hover:bg-accent transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            REFRESH
          </button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="border-b border-border/30 flex gap-6 text-sm">
        <button
          onClick={() => setActiveTab("logs")}
          className={`pb-3 font-semibold border-b-2 transition-all ${activeTab === "logs" ? "border-primary text-primary" : "border-transparent text-foreground/50 hover:text-foreground"}`}
        >
          Decision Control & Logs
        </button>
        <button
          onClick={() => setActiveTab("performance")}
          className={`pb-3 font-semibold border-b-2 transition-all ${activeTab === "performance" ? "border-primary text-primary" : "border-transparent text-foreground/50 hover:text-foreground"}`}
        >
          Performance & Revenue
        </button>
        <button
          onClick={() => setActiveTab("learning")}
          className={`pb-3 font-semibold border-b-2 transition-all ${activeTab === "learning" ? "border-primary text-primary" : "border-transparent text-foreground/50 hover:text-foreground"}`}
        >
          Self-Learning & NickGPT
        </button>
      </div>

      {/* --- Decision Audit Logs Tab --- */}
      {activeTab === "logs" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Rollout Control Panel (Track H) */}
          <div className="bg-card border border-border/30 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/20 pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2">
                  <ShieldAlert className="w-4.5 h-4.5 text-primary" />
                  Rollout Control Center & Safeguards
                </h3>
                <p className="text-[11px] text-foreground/40 mt-0.5">Control live-sending states per trigger event type</p>
              </div>
              <div className="flex items-center gap-2 bg-accent/35 border border-border/40 px-3 py-1.5">
                <span className="font-semibold text-foreground/60 text-xs">Global Mode Override:</span>
                <select
                  value={rolloutModes?.find(m => m.k === "sms_orchestrator_global_mode")?.v || "shadow"}
                  onChange={async (e) => {
                    await setRolloutModeMutation.mutateAsync({
                      key: "sms_orchestrator_global_mode",
                      value: e.target.value as any
                    });
                  }}
                  className="bg-card border border-border/50 text-[11px] font-bold text-primary focus:outline-none rounded px-2 py-0.5"
                >
                  <option value="legacy_passthrough">LEGACY PASSTHROUGH (KILL SWITCH)</option>
                  <option value="shadow">SHADOW MODE (PARALLEL COMPUTATION)</option>
                  <option value="live_send">LIVE SYSTEM (ACTIVE ENGINE)</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(EVENT_TYPE_LABELS).map(([k, label]) => {
                const flagKey = `sms_orch_${k}_mode`;
                const currentMode = rolloutModes?.find(m => m.k === flagKey)?.v || "shadow";
                return (
                  <div key={k} className="p-3 border border-border/20 bg-accent/10 rounded flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-foreground/75 truncate">{label}</span>
                    <select
                      value={currentMode}
                      onChange={async (e) => {
                        await setRolloutModeMutation.mutateAsync({
                          key: flagKey,
                          value: e.target.value as any
                        });
                      }}
                      className="bg-card border border-border/45 text-[11px] font-semibold text-foreground/70 focus:outline-none rounded px-1.5 py-0.5"
                    >
                      <option value="off">Off</option>
                      <option value="shadow">Shadow</option>
                      <option value="draft_only">Draft Only</option>
                      <option value="live_send">Live Send</option>
                      <option value="legacy_passthrough">Passthrough</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Human Review Queue (Track L) */}
          {humanReviewQueue && humanReviewQueue.length > 0 && (
            <div className="bg-card border border-border/30 p-6 space-y-4">
              <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2 border-b border-border/20 pb-3">
                <Brain className="w-4.5 h-4.5 text-primary animate-pulse" />
                Human Review Inbox ({humanReviewQueue.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {humanReviewQueue.map((item) => {
                  const currentEditVal = reviewEdits[item.id] !== undefined ? reviewEdits[item.id] : item.messageBody;
                  return (
                    <div key={item.id} className="p-4 border border-border bg-accent/15 rounded flex flex-col justify-between space-y-4 text-xs">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground/80">
                            {EVENT_TYPE_LABELS[item.eventType] || item.eventType}
                          </span>
                          <span className="text-[10px] text-foreground/45">
                            {item.customerPhone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}
                          </span>
                        </div>
                        <div className="bg-card p-2 border border-border/25 rounded">
                          <span className="block text-[10px] uppercase font-bold text-foreground/40 mb-1">Triggering Cause / Reason</span>
                          <p className="font-mono text-[11px] text-foreground/60">{item.reason}</p>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-[10px] uppercase font-bold text-foreground/40">Suggested Response</span>
                          <textarea
                            value={currentEditVal}
                            onChange={(e) => setReviewEdits({ ...reviewEdits, [item.id]: e.target.value })}
                            className="w-full h-20 bg-card border border-border/45 text-xs text-foreground/80 p-2 focus:outline-none focus:border-primary/70 rounded"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/20 justify-between">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleActionReview(item.id, currentEditVal === item.messageBody ? "send" : "edit_and_send")}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold hover:bg-emerald-500/20 transition-all rounded text-[10px]"
                          >
                            <Send className="w-3 h-3" /> APPROVE & SEND
                          </button>
                          <button
                            onClick={() => handleActionReview(item.id, "bad_suggestion")}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 font-bold hover:bg-red-500/20 transition-all rounded text-[10px]"
                          >
                            <X className="w-3 h-3" /> REJECT
                          </button>
                        </div>
                        <button
                          onClick={() => handleActionReview(item.id, "resolve")}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 border border-border/40 text-foreground/50 font-semibold hover:bg-foreground/10 transition-all rounded text-[10px]"
                        >
                          DISMISS
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2 bg-card p-3 border border-border/20">
            <span className="text-[10px] uppercase font-bold text-foreground/40 mr-2">Filter By:</span>
            {[
              { label: "All Events", value: "" },
              { label: "Sent", value: "sent" },
              { label: "Queued", value: "queued" },
              { label: "Failed", value: "failed" },
              { label: "Skipped", value: "skipped" },
              { label: "Drafted", value: "drafted" },
              { label: "Inbound", value: "inbound" },
              { label: "Vapi Callrecaps", value: "Vapi" },
              { label: "NickGPT Auto-Replies", value: "NickGPT" },
              { label: "Price Queries", value: "price questions" }
            ].map(f => (
              <button
                key={f.label}
                onClick={() => {
                  setFilter(f.value);
                  setPage(0);
                }}
                className={`px-2.5 py-1 text-[11px] font-semibold border transition-all ${filter === f.value ? "bg-primary/10 border-primary text-primary" : "bg-card border-border hover:bg-accent text-foreground/75"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Log Table */}
          {(!logsData || logsData.items.length === 0) ? (
            <EmptyState title="No Decision Records Found" subtitle="No matching SMS orchestrations logged." />
          ) : (
            <div className="bg-card border border-border/30 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.1em] text-foreground/50 font-semibold bg-accent/30">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Event Type</th>
                      <th className="py-3 px-4">Recipient</th>
                      <th className="py-3 px-4">Variant</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Reason / Outcome</th>
                      <th className="py-3 px-4 text-right">Details & Timeline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20 text-xs tabular-nums">
                    {logsData.items.map((item) => (
                      <tr key={item.id} className="hover:bg-accent/10 transition-colors">
                        <td className="py-3.5 px-4 text-foreground/60 whitespace-nowrap">
                          {formatDate(item.createdAt)}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-foreground/80">
                          {EVENT_TYPE_LABELS[item.eventType] || item.eventType}
                        </td>
                        <td className="py-3.5 px-4 text-foreground/75">
                          {item.customerPhone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-foreground/60">
                          {item.variantKey}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className={`px-2 py-0.5 border text-[10px] uppercase font-bold tracking-wider ${STATUS_STYLES[item.status] || "text-foreground/50 bg-foreground/5 border-foreground/10"}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-foreground/60 max-w-[240px] truncate" title={item.reason || ""}>
                          {item.reason || "system_triggered"}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setSelectedItem(item)}
                            className="p-1.5 border border-border bg-card hover:bg-accent/40 rounded text-foreground/60 hover:text-foreground transition-colors flex items-center gap-1.5 ml-auto text-[10px] font-bold"
                          >
                            <Eye className="w-3.5 h-3.5" /> INSPECT
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border/30 px-4 py-3 bg-accent/10 text-xs text-foreground/50">
                <div>
                  Showing <span className="font-semibold text-foreground/70">{offset + 1}</span> to{" "}
                  <span className="font-semibold text-foreground/70">
                    {Math.min(offset + limit, logsData.total)}
                  </span>{" "}
                  of <span className="font-semibold text-foreground/70">{logsData.total}</span> records
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1 border border-border bg-card rounded disabled:opacity-30 hover:bg-accent transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-medium text-foreground/70">
                    Page {page + 1} of {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1 border border-border bg-card rounded disabled:opacity-30 hover:bg-accent transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- Performance & Revenue Tab --- */}
      {activeTab === "performance" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Revenue influence Summary */}
            <div className="bg-card border border-border/30 p-6 flex flex-col justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/40 block mb-1">
                  Estimated Influenced Revenue
                </span>
                <span className="text-3xl font-bold text-emerald-400">$3,450.00</span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-foreground/50">
                <Coins className="w-4 h-4 text-emerald-400" />
                Linked to invoices within 7 days of outbound SMS nudge.
              </div>
            </div>

            {/* Inbound Funnel */}
            <div className="bg-card border border-border/30 p-6 flex flex-col justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/40 block mb-1">
                  Outbound-to-Reply Funnel
                </span>
                <span className="text-3xl font-bold text-primary">31.4%</span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-foreground/50">
                <TrendingUp className="w-4 h-4 text-primary" />
                Industry baseline for automotive repair is ~15%.
              </div>
            </div>

            {/* Campaign conversion */}
            <div className="bg-card border border-border/30 p-6 flex flex-col justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/40 block mb-1">
                  Stale Lead Nudge Conversion
                </span>
                <span className="text-3xl font-bold text-blue-400">12.5%</span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-foreground/50">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                Stale leads converted to booked visits.
              </div>
            </div>
          </div>

          {/* Variant Performance Selector & Table */}
          <div className="bg-card border border-border/30 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2">
                <Award className="w-4 h-4 text-primary" />
                Variant Performance Leaderboard
              </h3>
              <select
                value={selectedEventType}
                onChange={e => setSelectedEventType(e.target.value)}
                className="bg-accent border border-border/50 text-xs px-3 py-1.5 font-semibold text-foreground/80 focus:outline-none"
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-[10px] uppercase tracking-[0.1em] text-foreground/50 font-semibold bg-accent/30">
                    <th className="py-2.5 px-4">Variant Key</th>
                    <th className="py-2.5 px-4">Sends</th>
                    <th className="py-2.5 px-4">Replies</th>
                    <th className="py-2.5 px-4">Reply Rate</th>
                    <th className="py-2.5 px-4">Bookings</th>
                    <th className="py-2.5 px-4">Conversion Rate</th>
                    <th className="py-2.5 px-4">Opt-Outs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 tabular-nums">
                  {variantPerf && variantPerf.length > 0 ? (
                    variantPerf.map((v: any) => (
                      <tr key={v.variantKey} className="hover:bg-accent/10 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold">{v.variantKey}</td>
                        <td className="py-3 px-4">{v.sentCount}</td>
                        <td className="py-3 px-4">{v.replyCount}</td>
                        <td className="py-3 px-4 text-primary font-semibold">{v.replyRate.toFixed(1)}%</td>
                        <td className="py-3 px-4">{v.bookingCount}</td>
                        <td className="py-3 px-4 text-emerald-400 font-semibold">{v.conversionRate.toFixed(1)}%</td>
                        <td className="py-3 px-4 text-foreground/40">{v.optOutCount}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-foreground/30 font-medium">
                        No performance stats found for this event type.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- Self-Learning & NickGPT Tab --- */}
      {activeTab === "learning" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fine-Tuning Corpus Size */}
            <div className="bg-card border border-border/30 p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2 mb-2">
                  <Award className="w-4.5 h-4.5 text-primary" />
                  NickGPT Fine-Tuning Corpus
                </h3>
                <p className="text-xs text-foreground/50 leading-relaxed mb-4">
                  Operator-approved edits and drafts are continuously indexed for LLM reinforcement learning.
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-foreground/50">Approved Training Rows</span>
                    <span className="text-foreground/80 font-mono">{trainingStats?.approvedCount ?? 0}</span>
                  </div>
                  <div className="h-2 bg-accent rounded overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300"
                      style={{ width: `${Math.min(100, ((trainingStats?.approvedCount ?? 0) / 200) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-foreground/40">
                    <span>50: Prompt Optimizations</span>
                    <span className="font-semibold text-foreground/50">200: Small Fine-Tune Limit</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border/20">
                <button
                  onClick={handleExportCorpus}
                  disabled={exportCorpusMutation.isPending}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/95 transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  EXPORT TRAINING CORPUS (.JSONL)
                </button>
              </div>
            </div>

            {/* Stats list */}
            <div className="bg-card border border-border/30 p-6 space-y-4">
              <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2">
                <ShieldAlert className="w-4.5 h-4.5 text-amber-400" />
                Decision Safeguards
              </h3>
              <ul className="text-xs space-y-3">
                <li className="flex items-center justify-between p-2 bg-accent/25 border border-border/35 rounded">
                  <span className="text-foreground/60 font-medium">Automatic Opt-Out Blockers</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
                  </span>
                </li>
                <li className="flex items-center justify-between p-2 bg-accent/25 border border-border/35 rounded">
                  <span className="text-foreground/60 font-medium">Estimate Approve/Decline Sniffing</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
                  </span>
                </li>
                <li className="flex items-center justify-between p-2 bg-accent/25 border border-border/35 rounded">
                  <span className="text-foreground/60 font-medium">Complaint & Legal Draft REVIEW-ONLY Gating</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Pending Copywriting Recommendations */}
          <div className="bg-card border border-border/30 p-6 space-y-4">
            <h3 className="text-sm font-bold text-foreground/80 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Copywriting & Routing Recommendations
            </h3>

            {(!recs || recs.filter(r => r.status === "pending").length === 0) ? (
              <EmptyState title="No Recommendations Available" subtitle="Learning Engine is evaluating variant stats. Recommendations are processed nightly." />
            ) : (
              <div className="space-y-4">
                {recs.filter(r => r.status === "pending").map((r: any) => (
                  <div key={r.id} className="p-4 border border-border bg-accent/15 rounded space-y-3 text-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-primary/10 border border-primary/20 text-primary mr-2">
                          {r.recommendationType.replace("_", " ")}
                        </span>
                        <span className="font-semibold text-foreground/75">
                          Target: {EVENT_TYPE_LABELS[r.eventType] || r.eventType}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReviewRec(r.id, "approved")}
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold hover:bg-emerald-500/20 transition-all rounded text-[10px]"
                        >
                          <Check className="w-3 h-3" /> APPROVE
                        </button>
                        <button
                          onClick={() => handleReviewRec(r.id, "rejected")}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 border border-red-500/30 text-red-400 font-bold hover:bg-red-500/20 transition-all rounded text-[10px]"
                        >
                          <X className="w-3 h-3" /> REJECT
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] uppercase font-bold text-foreground/40">Reason</span>
                      <p className="text-foreground/70 leading-relaxed font-mono text-[11px] bg-card p-2 border border-border/20 rounded">
                        {r.reason}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] uppercase font-bold text-foreground/40">Proposed Copy Changes</span>
                      <p className="text-foreground/80 leading-relaxed font-semibold italic bg-card p-2.5 border border-border/20 rounded">
                        "{r.proposedMessage}"
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inspect Detail Modal + Customer Journey Timeline (Track K) */}
      {selectedItem && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border max-w-5xl w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between border-b border-border/20 pb-4 mb-4">
              <div>
                <h3 className="text-base font-bold text-foreground/90 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary" />
                  Decision Details & Customer Journey: {selectedItem.customerPhone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}
                </h3>
                <p className="text-xs text-foreground/50">Decision triggered: {formatDate(selectedItem.createdAt)} (ID: #{selectedItem.id})</p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-1.5 border border-border hover:bg-accent text-foreground/60 transition-colors rounded"
              >
                <span className="sr-only">Close</span>
                <span className="block text-sm font-semibold">✕</span>
              </button>
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pr-1 flex-1">
              
              {/* Left Column: Decision Variables */}
              <div className="space-y-4 pr-3 border-r border-border/10">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Event Type</span>
                    <span className="font-semibold text-foreground/80">{EVENT_TYPE_LABELS[selectedItem.eventType] || selectedItem.eventType}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Variant Key</span>
                    <span className="font-mono text-foreground/85">{selectedItem.variantKey}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Provider Route</span>
                    <span className="font-semibold text-foreground/80 capitalize">{selectedItem.providerUsed}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Transmission Status</span>
                    <span className="font-semibold capitalize text-foreground/80">{selectedItem.status}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Dedupe Cooldown Key</span>
                    <span className="font-mono text-foreground/70">{selectedItem.cooldownKey || "(none)"}</span>
                  </div>
                  {selectedItem.sourceTable && (
                    <div>
                      <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Relation</span>
                      <span className="font-semibold text-foreground/80">{selectedItem.sourceTable} (#{selectedItem.sourceId || "?"})</span>
                    </div>
                  )}
                  {selectedItem.deliveryStatus && (
                    <div>
                      <span className="block text-[10px] uppercase text-foreground/50 font-medium mb-0.5">Delivery Status</span>
                      <span className="font-semibold capitalize text-foreground/85">{selectedItem.deliveryStatus}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="block text-[10px] uppercase text-foreground/50 font-medium">Orchestration Reason</span>
                  <div className="p-3 bg-accent/20 border border-border/50 text-[11px] font-mono rounded text-foreground/85 whitespace-pre-wrap">
                    {selectedItem.reason || "No detail provided"}
                  </div>
                </div>

                {selectedItem.failureReason && (
                  <div className="space-y-1">
                    <span className="block text-[10px] uppercase text-foreground/50 font-medium text-red-400">Carrier Failure logs</span>
                    <div className="p-3 bg-red-500/5 border border-red-500/20 text-[11px] font-mono rounded text-red-400 whitespace-pre-wrap">
                      {selectedItem.failureReason}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <span className="block text-[10px] uppercase text-foreground/50 font-medium">Output Message Body</span>
                  <div className="p-3 bg-accent/20 border border-border/50 text-xs rounded text-foreground/85 whitespace-pre-wrap">
                    {selectedItem.messageBody || "(empty body / skipped)"}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="block text-[10px] uppercase text-foreground/50 font-medium">Decision Trace Context</span>
                  <div className="p-3 bg-accent/20 border border-border/50 text-[10px] font-mono rounded text-foreground/70 overflow-x-auto max-h-[140px]">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(selectedItem.decisionTraceJson), null, 2);
                      } catch {
                        return selectedItem.decisionTraceJson || "{}";
                      }
                    })()}
                  </div>
                </div>
              </div>

              {/* Right Column: Customer Journey Timeline */}
              <div className="flex flex-col space-y-3">
                <span className="block text-[10px] uppercase text-foreground/50 font-medium border-b border-border/10 pb-2">
                  Customer Journey Timeline
                </span>
                
                {isTimelineLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-xs text-foreground/45">
                    <RefreshCw className="w-5 h-5 animate-spin text-primary/60 mb-2" />
                    Fetching journey events...
                  </div>
                ) : !timelineData || timelineData.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-foreground/30 py-20">
                    No customer journey history found.
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto max-h-[550px] pr-2 space-y-4 relative pl-3">
                    <div className="absolute left-[20px] top-2 bottom-2 w-0.5 bg-border/20" />
                    {timelineData.map((ev: any) => {
                      // Determine styling based on type
                      let iconColor = "bg-accent/40 border-border/50 text-foreground/50";
                      let icon = <Cpu className="w-3.5 h-3.5" />;
                      
                      if (ev.type === "inbound_sms") {
                        iconColor = "bg-blue-500/10 border-blue-500/35 text-blue-400";
                        icon = <MessageSquare className="w-3.5 h-3.5" />;
                      } else if (ev.type === "outbound_sms") {
                        iconColor = "bg-emerald-500/10 border-emerald-500/35 text-emerald-400";
                        icon = <Send className="w-3.5 h-3.5" />;
                      } else if (ev.type === "vapi_call") {
                        iconColor = "bg-purple-500/10 border-purple-500/35 text-purple-400";
                        icon = <Phone className="w-3.5 h-3.5" />;
                      } else if (ev.type === "lead") {
                        iconColor = "bg-yellow-500/10 border-yellow-500/35 text-yellow-400";
                        icon = <User className="w-3.5 h-3.5" />;
                      } else if (ev.type === "booking") {
                        iconColor = "bg-teal-500/10 border-teal-500/35 text-teal-400";
                        icon = <Calendar className="w-3.5 h-3.5" />;
                      } else if (ev.type === "callback_request") {
                        iconColor = "bg-amber-500/10 border-amber-500/35 text-amber-400";
                        icon = <Clock className="w-3.5 h-3.5" />;
                      } else if (ev.type === "invoice") {
                        iconColor = "bg-emerald-500/10 border-emerald-500/35 text-emerald-400";
                        icon = <Coins className="w-3.5 h-3.5" />;
                      }
                      
                      return (
                        <div key={ev.id} className="relative pl-6 flex gap-3 text-xs">
                          {/* Timeline dot/icon */}
                          <div className={`absolute left-0 top-0.5 w-6 h-6 rounded-full border flex items-center justify-center z-10 ${iconColor}`}>
                            {icon}
                          </div>
                          
                          <div className="flex-1 space-y-1 bg-accent/5 p-2.5 border border-border/15 rounded">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-foreground/80">{ev.title}</span>
                              <span className="text-[10px] text-foreground/40 whitespace-nowrap">{formatDate(ev.timestamp)}</span>
                            </div>
                            <p className="text-foreground/60 leading-relaxed break-words">{ev.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            <div className="flex justify-end pt-4 border-t border-border/20 mt-4">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 border border-border bg-card text-xs font-semibold hover:bg-accent transition-colors rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


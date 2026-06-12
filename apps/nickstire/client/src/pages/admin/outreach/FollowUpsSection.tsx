/**
 * FollowUpsSection — shows pending and recent follow-up notifications.
 * Allows running follow-ups manually and viewing their status.
 */
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";

// Inferred from tRPC AppRouter — admin audit §3 follow-up.
type PendingFollowUp = NonNullable<RouterOutputs["followUps"]["pending"]>[number];
type RecentFollowUp = NonNullable<RouterOutputs["followUps"]["recent"]>[number];
import {
  Loader2, Send, RefreshCw, CheckCircle2, Clock, MessageSquare, Star, AlertCircle, X, RotateCw
} from "lucide-react";
import { PageHeader, formatDate, LoadingState, EmptyState, ErrorState } from "../shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  follow_up: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-blue-400 bg-blue-500/10", label: "THANK YOU" },
  review_request: { icon: <Star className="w-3.5 h-3.5" />, color: "text-primary bg-primary/10", label: "REVIEW REQ" },
  booking_confirmed: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400 bg-emerald-500/10", label: "CONFIRMED" },
  booking_completed: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400 bg-emerald-500/10", label: "COMPLETED" },
  maintenance_reminder: { icon: <Clock className="w-3.5 h-3.5" />, color: "text-amber-400 bg-amber-500/10", label: "REMINDER" },
  special_offer: { icon: <Send className="w-3.5 h-3.5" />, color: "text-primary bg-primary/10", label: "OFFER" },
  status_update: { icon: <RefreshCw className="w-3.5 h-3.5" />, color: "text-primary bg-primary/10", label: "STATUS" },
};

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  sent: "text-emerald-400 bg-emerald-500/10",
  failed: "text-red-400 bg-red-500/10",
  // canceled follow-ups are written as status="skipped" (admin.ts cancel
  // mutation) — neutral/muted so they don't read as active or errored.
  skipped: "text-foreground/40 bg-foreground/5",
};

export default function FollowUpsSection() {
  const utils = trpc.useUtils();
  const { data: pending, isLoading: pendingLoading, isError: pendingError, refetch: refetchPending } = trpc.followUps.pending.useQuery(undefined, { refetchInterval: 30000 });
  const { data: recent, isLoading: recentLoading, isError: recentError, refetch: refetchRecent } = trpc.followUps.recent.useQuery(undefined, { refetchInterval: 30000 });

  const runFollowUps = trpc.followUps.run.useMutation({
    onSuccess: (data) => {
      toast.success(`Processed ${data.total} follow-ups`);
      utils.followUps.pending.invalidate();
      utils.followUps.recent.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // wave-115 — per-item cancel + retry. Cancel marks pending → skipped
  // (never sends). Retry marks failed → pending (re-queues for next run).
  const cancelFollowUp = trpc.followUps.cancel.useMutation({
    onSuccess: () => {
      toast.success("Follow-up canceled");
      utils.followUps.pending.invalidate();
      utils.followUps.recent.invalidate();
    },
    onError: (err) => toast.error(err.message.slice(0, 120)),
  });

  const retryFollowUp = trpc.followUps.retry.useMutation({
    onSuccess: () => {
      toast.success("Follow-up requeued");
      utils.followUps.pending.invalidate();
      utils.followUps.recent.invalidate();
    },
    onError: (err) => toast.error(err.message.slice(0, 120)),
  });

  const isLoading = pendingLoading || recentLoading;
  const pendingCount = pending?.length ?? 0;
  const sentCount = recent?.filter((n: RecentFollowUp) => n.status === "sent").length ?? 0;
  const failedCount = recent?.filter((n: RecentFollowUp) => n.status === "failed").length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-Ups"
        subtitle="Automated thank-you + review-request SMS for completed bookings · pending queue + recent activity"
        icon={<Send className="w-5 h-5" />}
      />
      <div className="flex items-center justify-end">
        <button
          onClick={() => runFollowUps.mutate()}
          disabled={runFollowUps.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs tracking-wide disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {runFollowUps.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {runFollowUps.isPending ? "PROCESSING..." : "RUN FOLLOW-UPS"}
        </button>
      </div>

      {/* Stats Row — wave-133 loading guard: was rendering "0/0/0"
          for ~1-2s while pending+recent queries resolved, then
          flashing the real numbers. Now placeholders during load. */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Pending</span>
          <span className="text-2xl font-semibold text-amber-400 tabular-nums">{isLoading ? "—" : pendingCount}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Sent · recent 50</span>
          <span className="text-2xl font-semibold text-emerald-400 tabular-nums">{isLoading ? "—" : sentCount}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Failed</span>
          <span className="text-2xl font-semibold text-red-400 tabular-nums">{isLoading ? "—" : failedCount}</span>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading follow-ups..." />
      ) : pendingError || recentError ? (
        <ErrorState message="Couldn't load follow-ups" onRetry={() => { refetchPending(); refetchRecent(); }} />
      ) : (
        <>
          {/* Pending Follow-Ups */}
          {pendingCount > 0 && (
            <div>
              <h3 className="font-bold text-sm text-amber-400 tracking-wide mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> PENDING ({pendingCount})
              </h3>
              <div className="space-y-2">
                {pending?.map((fu: PendingFollowUp) => {
                  const cfg = TYPE_CONFIG[fu.notificationType] || TYPE_CONFIG.follow_up;
                  return (
                    <div key={fu.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
                      <div className={`flex items-center gap-1.5 px-2 py-1 text-[10px] ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-foreground text-sm">{fu.recipientName}</span>
                        <span className="text-[12px] text-foreground/40 ml-3">{fu.recipientPhone || "No phone"}</span>
                      </div>
                      <span className="font-mono text-[10px] text-foreground/30">
                        {formatDate(fu.createdAt)}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] ${STATUS_STYLES[fu.status]}`}>
                        {fu.status.toUpperCase()}
                      </span>
                      {/* wave-115 — per-row cancel button.
                          wave-152 — migrated native confirm() to ConfirmDialog
                          to close the broken-contract gap (this should have
                          been part of the wave-150 sweep). */}
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirmDialog({
                            title: "Cancel follow-up?",
                            message: `Stop the queued follow-up SMS to ${fu.recipientName}. It won't send.`,
                            confirmLabel: "Cancel send",
                            tone: "danger",
                          })) {
                            cancelFollowUp.mutate({ id: fu.id });
                          }
                        }}
                        disabled={cancelFollowUp.isPending}
                        className="text-foreground/40 hover:text-red-400 transition-colors disabled:opacity-30"
                        title="Cancel this follow-up — it won't send"
                        aria-label="Cancel follow-up"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Follow-Ups */}
          <div>
            <h3 className="font-bold text-sm text-foreground/60 tracking-wide mb-3">
              RECENT FOLLOW-UPS
            </h3>
            {(recent?.length ?? 0) === 0 ? (
              <EmptyState
                icon={<Send className="w-8 h-8" />}
                title="No follow-ups yet"
                subtitle='Auto-generated when bookings complete. Click "Run Follow-Ups" to process eligible bookings now.'
              />
            ) : (
              <div className="space-y-2">
                {recent?.map((fu: RecentFollowUp) => {
                  const cfg = TYPE_CONFIG[fu.notificationType] || TYPE_CONFIG.follow_up;
                  return (
                    <div key={fu.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
                      <div className={`flex items-center gap-1.5 px-2 py-1 text-[10px] ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-foreground text-sm">{fu.recipientName}</span>
                        <span className="text-[12px] text-foreground/40 ml-3">{fu.recipientPhone || "No phone"}</span>
                      </div>
                      <span className="font-mono text-[10px] text-foreground/30">
                        {formatDate(fu.createdAt)}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] ${STATUS_STYLES[fu.status]}`}>
                        {fu.status.toUpperCase()}
                      </span>
                      {/* wave-115 — per-row retry button (failed only) */}
                      {fu.status === "failed" && (
                        <button
                          type="button"
                          onClick={() => retryFollowUp.mutate({ id: fu.id })}
                          disabled={retryFollowUp.isPending}
                          className="text-amber-400/60 hover:text-amber-400 transition-colors disabled:opacity-30"
                          title="Retry this follow-up — re-queues it for the next run"
                          aria-label="Retry follow-up"
                        >
                          <RotateCw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Info */}
      <div className="bg-primary/5 border border-primary/20 p-4">
        <h4 className="font-bold text-xs text-primary tracking-wide mb-2">HOW FOLLOW-UPS WORK</h4>
        <p className="text-foreground/60 text-xs leading-relaxed">
          When a booking is marked as completed, the system automatically queues two follow-ups:
          a 24-hour thank-you message and a 7-day review request. Click "Run Follow-Ups" to process
          any eligible bookings, or they will be processed automatically by the scheduled cron job.
        </p>
      </div>
    </div>
  );
}

/**
 * FollowUpsSection — shows pending and recent follow-up notifications.
 * Allows running follow-ups manually and viewing their status.
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, Send, RefreshCw, CheckCircle2, Clock, MessageSquare, Star, AlertCircle
} from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  follow_up: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-blue-400 bg-blue-500/10", label: "THANK YOU" },
  review_request: { icon: <Star className="w-3.5 h-3.5" />, color: "text-primary bg-primary/10", label: "REVIEW REQ" },
  booking_confirmed: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400 bg-emerald-500/10", label: "CONFIRMED" },
  booking_completed: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400 bg-emerald-500/10", label: "COMPLETED" },
  maintenance_reminder: { icon: <Clock className="w-3.5 h-3.5" />, color: "text-amber-400 bg-amber-500/10", label: "REMINDER" },
  special_offer: { icon: <Send className="w-3.5 h-3.5" />, color: "text-purple-400 bg-purple-500/10", label: "OFFER" },
  status_update: { icon: <RefreshCw className="w-3.5 h-3.5" />, color: "text-cyan-400 bg-cyan-500/10", label: "STATUS" },
};

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  sent: "text-emerald-400 bg-emerald-500/10",
  failed: "text-red-400 bg-red-500/10",
};

export default function FollowUpsSection() {
  const utils = trpc.useUtils();
  const { data: pending, isLoading: pendingLoading } = trpc.followUps.pending.useQuery(undefined, { refetchInterval: 30000 });
  const { data: recent, isLoading: recentLoading } = trpc.followUps.recent.useQuery(undefined, { refetchInterval: 30000 });

  const runFollowUps = trpc.followUps.run.useMutation({
    onSuccess: (data) => {
      toast.success(`Processed ${data.total} follow-ups`);
      utils.followUps.pending.invalidate();
      utils.followUps.recent.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const isLoading = pendingLoading || recentLoading;
  const pendingCount = pending?.length ?? 0;
  const sentCount = recent?.filter((n: any) => n.status === "sent").length ?? 0;
  const failedCount = recent?.filter((n: any) => n.status === "failed").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-2xl text-foreground tracking-wider">FOLLOW-UP MANAGER</h2>
          <p className="text-foreground/50 text-[12px] mt-1">
            Automated thank-you and review request messages for completed bookings
          </p>
        </div>
        <button
          onClick={() => runFollowUps.mutate()}
          disabled={runFollowUps.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs tracking-wide disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {runFollowUps.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {runFollowUps.isPending ? "PROCESSING..." : "RUN FOLLOW-UPS"}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/50 tracking-wide block mb-1">Pending</span>
          <span className="font-bold text-2xl text-amber-400">{pendingCount}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/50 tracking-wide block mb-1">Sent (Recent 50)</span>
          <span className="font-bold text-2xl text-emerald-400">{sentCount}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/50 tracking-wide block mb-1">Failed</span>
          <span className="font-bold text-2xl text-red-400">{failedCount}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* Pending Follow-Ups */}
          {pendingCount > 0 && (
            <div>
              <h3 className="font-bold text-sm text-amber-400 tracking-wide mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> PENDING ({pendingCount})
              </h3>
              <div className="space-y-2">
                {pending?.map((fu: any) => {
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
                        {new Date(fu.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] ${STATUS_STYLES[fu.status]}`}>
                        {fu.status.toUpperCase()}
                      </span>
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
              <div className="text-center py-12 text-foreground/40">
                <Send className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-[13px]">No follow-ups yet. They are generated when bookings are completed.</p>
                <p className="text-[12px] text-foreground/30 mt-2">Click "Run Follow-Ups" to process eligible bookings.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recent?.map((fu: any) => {
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
                        {new Date(fu.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] ${STATUS_STYLES[fu.status]}`}>
                        {fu.status.toUpperCase()}
                      </span>
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

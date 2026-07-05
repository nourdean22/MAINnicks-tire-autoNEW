/**
 * CommandQueue — operator approval queue for AI-generated content commands.
 *
 * Extracted from ContentSection.tsx (1,515 lines) in the 2026-07-04
 * maintainability split — pure mechanical move, mirrors the ./today/
 * and ./customers/ extraction precedent. No behavior change.
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Calendar, Trash2, RefreshCw } from "lucide-react";

export function CommandQueue() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ id: string; action: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>("");

  const utils = trpc.useUtils();
  const { data: queue, isLoading, isError, refetch } = trpc.contentAdmin.listStatenourQueue.useQuery({
    status: statusFilter,
  });

  const actMutation = trpc.contentAdmin.actOnStatenourQueueItem.useMutation({
    onSuccess: () => {
      toast.success("Action processed successfully");
      void utils.contentAdmin.listStatenourQueue.invalidate();
      setBusyId(null);
    },
    onError: (err: any) => {
      toast.error(`Action failed: ${err.message}`);
      setBusyId(null);
    },
  });

  const handleAction = (id: string, action: "approve" | "reject" | "schedule" | "publish" | "delete", reason?: string, date?: string) => {
    if (confirmState?.id === id && confirmState.action === action) {
      setConfirmState(null);
      setBusyId(id);
      actMutation.mutate({
        id,
        action,
        reason,
        scheduledFor: date,
      });
    } else {
      setConfirmState({ id, action });
      setTimeout(() => {
        setConfirmState((prev) => (prev?.id === id && prev.action === action ? null : prev));
      }, 3000);
    }
  };

  const getStatusBadgeProps = (status: string) => {
    switch (status) {
      case "pending":
        return "text-amber-400 bg-amber-500/10 border-amber-500/30";
      case "approved":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
      case "scheduled":
        return "text-sky-400 bg-sky-500/10 border-sky-500/30";
      case "published":
        return "text-zinc-400 bg-zinc-500/10 border-zinc-500/30";
      case "rejected":
        return "text-rose-400 bg-rose-500/10 border-rose-500/30";
      default:
        return "text-foreground/55 bg-background/50 border-border/20";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {["pending", "approved", "scheduled", "published", "all"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors uppercase ${
                statusFilter === status
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 text-foreground/50 hover:text-primary transition-colors"
          title="Refresh Queue"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="text-center py-8 text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded">
          Failed to load command queue items from Statenour.
        </div>
      ) : !queue || queue.length === 0 ? (
        <div className="text-center py-16 border border-border/30 bg-card">
          <Calendar className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-bold text-lg text-foreground/40 tracking-wider">QUEUE EMPTY</p>
          <p className="text-foreground/30 text-[12px] mt-2">
            No items found matching the selected status.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item: any) => {
            const isPending = item.metadata?.status === "pending";
            const isApproved = item.metadata?.status === "approved";
            const isScheduled = item.metadata?.status === "scheduled";
            
            return (
              <div key={item.id} className="bg-card border border-border/30 p-5 flex flex-col md:flex-row gap-5">
                {/* Visual Preview */}
                {item.previewUrl && (
                  <div className="w-full md:w-[220px] aspect-square bg-black/10 border border-border/30 rounded overflow-hidden flex items-center justify-center shrink-0">
                    <img
                      src={item.previewUrl}
                      alt="Asset preview"
                      className="w-full h-full object-contain"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                )}

                {/* Content Details */}
                <div className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 border text-[10px] font-bold tracking-wider uppercase ${getStatusBadgeProps(item.metadata?.status || "pending")}`}>
                        {item.metadata?.status || "pending"}
                      </span>
                      {item.metadata?.kind && (
                        <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 px-2 py-0.5 uppercase tracking-wide">
                          {item.metadata.kind}
                        </span>
                      )}
                      {item.metadata?.source && (
                        <span className="text-[10px] text-foreground/45 italic">
                          via {item.metadata.source}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap font-sans">
                      {item.content}
                    </p>

                    {item.metadata?.suggestedPlatforms && item.metadata.suggestedPlatforms.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.metadata.suggestedPlatforms.map((plat: string) => (
                          <span key={plat} className="text-[9px] font-semibold bg-background/50 border border-border/20 px-2 py-0.5 rounded text-foreground/50 uppercase tracking-wider">
                            {plat}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.metadata?.scheduledFor && (
                      <div className="text-[11px] text-sky-400 font-mono">
                        Scheduled for: {new Date(item.metadata.scheduledFor).toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Actions (Two-tap confirmation) */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/20">
                    {/* Approve Action */}
                    {isPending && (
                      <button
                        onClick={() => handleAction(item.id, "approve")}
                        disabled={busyId === item.id}
                        className={`px-3 py-1.5 font-bold text-[10px] tracking-wide border transition-all duration-200 ${
                          confirmState?.id === item.id && confirmState?.action === "approve"
                            ? "bg-emerald-600 border-emerald-500 text-white px-4"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                        }`}
                      >
                        {busyId === item.id && confirmState?.action === "approve" ? "..." : confirmState?.id === item.id && confirmState?.action === "approve" ? "CONFIRM APPROVE" : "APPROVE"}
                      </button>
                    )}

                    {/* Reject Action */}
                    {isPending && (
                      <button
                        onClick={() => handleAction(item.id, "reject")}
                        disabled={busyId === item.id}
                        className={`px-3 py-1.5 font-bold text-[10px] tracking-wide border transition-all duration-200 ${
                          confirmState?.id === item.id && confirmState?.action === "reject"
                            ? "bg-rose-600 border-rose-500 text-white px-4"
                            : "border-border/30 text-foreground/50 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30"
                        }`}
                      >
                        {busyId === item.id && confirmState?.action === "reject" ? "..." : confirmState?.id === item.id && confirmState?.action === "reject" ? "CONFIRM REJECT" : "REJECT"}
                      </button>
                    )}

                    {/* Schedule Action Form */}
                    {isApproved && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="datetime-local"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          className="bg-background border border-border/40 text-foreground px-2 py-1 text-[11px] focus:outline-none focus:border-primary/50"
                        />
                        <button
                          onClick={() => {
                            if (!scheduleDate) {
                              toast.error("Please pick a schedule date");
                              return;
                            }
                            handleAction(item.id, "schedule", undefined, scheduleDate);
                          }}
                          disabled={busyId === item.id}
                          className={`px-3 py-1.5 font-bold text-[10px] tracking-wide border transition-all duration-200 ${
                            confirmState?.id === item.id && confirmState?.action === "schedule"
                              ? "bg-sky-600 border-sky-500 text-white px-4"
                              : "bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20"
                          }`}
                        >
                          {busyId === item.id && confirmState?.action === "schedule" ? "..." : confirmState?.id === item.id && confirmState?.action === "schedule" ? "CONFIRM SCHEDULE" : "SCHEDULE"}
                        </button>
                      </div>
                    )}

                    {/* Publish Live Action */}
                    {(isApproved || isScheduled) && (
                      <button
                        onClick={() => handleAction(item.id, "publish")}
                        disabled={busyId === item.id}
                        className={`px-3 py-1.5 font-bold text-[10px] tracking-wide border transition-all duration-200 ${
                          confirmState?.id === item.id && confirmState?.action === "publish"
                            ? "bg-amber-600 border-amber-500 text-white px-4"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                        }`}
                      >
                        {busyId === item.id && confirmState?.action === "publish" ? "..." : confirmState?.id === item.id && confirmState?.action === "publish" ? "CONFIRM PUBLISH LIVE" : "PUBLISH LIVE"}
                      </button>
                    )}

                    {/* Delete Action */}
                    <button
                      onClick={() => handleAction(item.id, "delete")}
                      disabled={busyId === item.id}
                      className={`ml-auto p-1.5 border transition-all duration-200 ${
                        confirmState?.id === item.id && confirmState?.action === "delete"
                          ? "bg-red-600 border-red-500 text-white rounded"
                          : "border-border/30 text-foreground/40 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 rounded"
                      }`}
                      title="Delete draft"
                    >
                      {confirmState?.id === item.id && confirmState?.action === "delete" ? (
                        <span className="text-[9px] font-bold px-1">CONFIRM DELETE</span>
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

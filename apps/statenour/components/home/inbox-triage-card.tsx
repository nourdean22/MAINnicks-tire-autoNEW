"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useTaskReviewActions } from "@/hooks/use-task-review-actions";
import { toast } from "sonner";
import { Inbox, Check, X, Clock, Archive, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface InboxTriageCardProps {
  isNested?: boolean;
}

export function InboxTriageCard({ isNested = false }: InboxTriageCardProps) {
  const utils = trpc.useUtils();
  
  // Queries
  const { data, isLoading } = trpc.task.missionsHygiene.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Mutations
  const acceptClassification = trpc.task.acceptTaskClassification.useMutation();
  const dismissClassification = trpc.task.dismissTaskClassification.useMutation();
  const domainSwap = trpc.task.domainSwap.useMutation();
  
  const { snooze, kill, edit } = useTaskReviewActions({
    onChange: () => {
      void utils.task.missionsHygiene.invalidate();
      void utils.task.inboxCount.invalidate();
      void utils.task.list.invalidate();
    },
    source: "home:inbox-triage",
  });

  // Local state for inline input (e.g. setting next action)
  const [nextActionInputs, setNextActionInputs] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (isLoading) return null;
  
  const findings = data?.rescue?.findings ?? [];
  if (findings.length === 0) return null;

  // Show up to 3 findings to avoid cluttering the home page
  const displayedFindings = findings.slice(0, 3);

  const handleAcceptClassification = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      const res = await acceptClassification.mutateAsync({ taskId });
      if (res.ok) {
        toast.success("Classification accepted.");
        void utils.task.missionsHygiene.invalidate();
        void utils.task.inboxCount.invalidate();
        void utils.task.list.invalidate();
      }
    } catch (err) {
      toast.error(`Failed to accept classification: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDismissClassification = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      await dismissClassification.mutateAsync({ taskId });
      toast.success("Classification suggestion dismissed.");
      void utils.task.missionsHygiene.invalidate();
      void utils.task.inboxCount.invalidate();
      void utils.task.list.invalidate();
    } catch (err) {
      toast.error(`Failed to dismiss classification: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDomainSwap = async (taskId: string, domain: string) => {
    setBusyTaskId(taskId);
    try {
      await domainSwap.mutateAsync({ id: taskId, domain });
      toast.success(`Routed to ${domain.toUpperCase()} inbox.`);
      void utils.task.missionsHygiene.invalidate();
      void utils.task.inboxCount.invalidate();
      void utils.task.list.invalidate();
    } catch (err) {
      toast.error(`Failed to swap domain: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSetNextAction = async (taskId: string) => {
    const text = nextActionInputs[taskId]?.trim();
    if (!text) {
      toast.error("Please enter a physical action.");
      return;
    }
    setBusyTaskId(taskId);
    try {
      await edit(taskId, { nextPhysicalAction: text });
      toast.success("Next physical action set.");
      setNextActionInputs((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      void utils.task.missionsHygiene.invalidate();
      void utils.task.inboxCount.invalidate();
      void utils.task.list.invalidate();
    } catch (err) {
      toast.error(`Failed to set next action: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const innerContent = (
    <div className="space-y-4">
      {/* Findings List */}
      <div className="space-y-4">
        {displayedFindings.map((f) => {
          const isBusy = busyTaskId === f.taskId;

          return (
            <div
              key={`${f.taskId}-${f.issue}`}
              className={cn(
                "p-3 rounded-lg border border-white/5 bg-white/[0.01] transition space-y-2.5",
                isBusy && "opacity-60 pointer-events-none animate-pulse"
              )}
            >
              {/* Card Meta */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <span className="inline-flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-rose-400/80">
                    <AlertCircle size={9} />
                    {f.issue.replace(/_/g, " ")}
                  </span>
                  <p className="text-[12.5px] font-medium text-white/90 leading-tight">
                    {f.title}
                  </p>
                </div>
                <span className="text-[9px] font-mono text-white/35 shrink-0 bg-white/5 px-1 py-0.25 rounded">
                  {Math.round(f.confidence * 100)}% conf
                </span>
              </div>

              {/* Reason */}
              <p className="text-[11px] text-white/60 leading-snug">
                {f.reason}
              </p>

              {/* Action Area */}
              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-white/5">
                {f.issue === "pending_classification" && (
                  <>
                    <button
                      onClick={() => handleAcceptClassification(f.taskId)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition"
                    >
                      <Check size={10} /> Confirm {f.missionTitle ? `"${f.missionTitle}"` : "Class."}
                    </button>
                    <button
                      onClick={() => handleDismissClassification(f.taskId)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 transition"
                    >
                      <X size={10} /> Dismiss
                    </button>
                  </>
                )}

                {f.issue === "legacy_inbox" && (
                  <div className="flex flex-col gap-1.5 w-full">
                    <span className="text-[9px] font-mono text-white/40 uppercase">Route to domain inbox:</span>
                    <div className="flex flex-wrap gap-1">
                      {["business", "personal", "health", "content", "finance"].map((dom) => (
                        <button
                          key={dom}
                          onClick={() => handleDomainSwap(f.taskId, dom)}
                          className="text-[9px] font-mono uppercase px-2 py-0.75 rounded border border-white/10 bg-white/5 hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/10 text-white/70 hover:text-[var(--gold)] transition"
                        >
                          {dom}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {f.issue === "stale" && (
                  <>
                    <button
                      onClick={() => snooze(f.taskId, 7)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition"
                    >
                      <Clock size={10} /> Snooze 7d
                    </button>
                    <button
                      onClick={() => kill(f.taskId)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 transition"
                    >
                      <Archive size={10} /> Archive
                    </button>
                  </>
                )}

                {f.issue === "no_next_action" && (
                  <div className="flex items-center gap-1.5 w-full">
                    <input
                      type="text"
                      placeholder="e.g. Call mechanic shop at 10am"
                      value={nextActionInputs[f.taskId] ?? ""}
                      onChange={(e) =>
                        setNextActionInputs((prev) => ({
                          ...prev,
                          [f.taskId]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSetNextAction(f.taskId);
                      }}
                      className="flex-1 min-w-0 bg-zinc-950 border border-white/10 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-[var(--gold)]/30"
                    />
                    <button
                      onClick={() => handleSetNextAction(f.taskId)}
                      className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded bg-[var(--gold)]/15 border border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/25 transition"
                    >
                      Set Action
                    </button>
                  </div>
                )}

                {f.issue === "general_maybe_specific" && (
                  <>
                    <div className="flex flex-col gap-1.5 w-full">
                      <span className="text-[9px] font-mono text-white/40 uppercase">Promote or route:</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => snooze(f.taskId, 7)}
                          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90 transition"
                        >
                          <Clock size={10} /> Keep in General
                        </button>
                        <a
                          href={`/missions#task-${f.taskId}`}
                          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-[var(--gold)]/15 border border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/25 transition"
                        >
                          Assign Project →
                        </a>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {findings.length > 3 && (
        <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-white/45">
          <span>{findings.length - 3} more recommendations waiting</span>
          <a
            href="/missions"
            className="text-[var(--gold)]/80 hover:text-[var(--gold)] transition hover:underline"
          >
            view all missions →
          </a>
        </div>
      )}
    </div>
  );

  if (isNested) {
    return innerContent;
  }

  return (
    <section
      aria-label="inbox triage ritual"
      className="glass-card relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 border border-white/10 rounded-xl p-4 shadow-xl space-y-4"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <Inbox size={14} className="text-rose-400" />
          <h3 className="text-xs font-mono uppercase tracking-[0.16em] text-white/95">
            inbox triage ritual
          </h3>
          <span className="px-1.5 py-0.25 rounded bg-rose-500/10 border border-rose-500/20 text-[9px] font-semibold text-rose-400 font-mono">
            {findings.length} ISSUE{findings.length > 1 ? "S" : ""}
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          quick-cleanup actions
        </span>
      </div>

      {innerContent}
    </section>
  );
}

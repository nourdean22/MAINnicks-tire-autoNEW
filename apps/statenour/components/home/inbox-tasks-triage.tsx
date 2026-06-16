"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import {
  Inbox,
  Check,
  X,
  Clock,
  Archive,
  Sparkles,
  Trash2,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface InboxTasksTriageProps {
  isNested?: boolean;
}

export function InboxTasksTriage({ isNested = false }: InboxTasksTriageProps) {
  const utils = trpc.useUtils();

  // Queries
  const { data: inboxTasks, isLoading: isTasksLoading } = trpc.task.list.useQuery({
    status: "INBOX",
  });
  const { data: missions, isLoading: isMissionsLoading } = trpc.task.missions.useQuery();

  // Mutation
  const triageMutation = trpc.task.triage.useMutation();

  // UI Control states
  const [activePanel, setActivePanel] = useState<
    "none" | "schedule" | "snooze" | "anytime" | "kill"
  >("none");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (isTasksLoading || isMissionsLoading) return null;
  if (!inboxTasks || inboxTasks.length === 0) return null;

  const currentTask = inboxTasks[0];
  const activeMissions = (missions ?? []).filter(
    (m) => m.status === "ACTIVE" && !m.title.startsWith("Inbox")
  );

  const pc = (currentTask as unknown as { pendingClassification: unknown }).pendingClassification as {
    missionId?: string;
    goalId?: string;
    confidence?: number;
    rationale?: string;
  } | null;

  const suggestedMission = pc?.missionId
    ? activeMissions.find((m) => m.id === pc.missionId)
    : null;

  const handleTriage = async (params: {
    decision: "today" | "schedule" | "anytime" | "someday" | "kill" | "snooze";
    date?: string;
    snoozeDays?: number;
    missionId?: string;
  }) => {
    setBusyTaskId(currentTask.id);
    try {
      await triageMutation.mutateAsync({
        id: currentTask.id,
        ...params,
      });

      toast.success(
        `Triaged: "${currentTask.title}" -> ${params.decision.toUpperCase()}`
      );
      
      setActivePanel("none");
      
      // Invalidate queries to update task counts and listings
      void utils.task.list.invalidate();
      void utils.task.inboxCount.invalidate();
      void utils.task.missionsHygiene.invalidate();
    } catch (err) {
      toast.error(
        `Triage failed: ${err instanceof Error ? err.message : "unknown"}`
      );
    } finally {
      setBusyTaskId(null);
    }
  };

  const isBusy = busyTaskId === currentTask.id;

  const innerContent = (
    <div
      className={cn(
        "p-4 rounded-lg border border-white/5 bg-white/1 transition-all duration-300",
        isBusy && "opacity-60 pointer-events-none animate-pulse"
      )}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-(--gold)/80">
            <Sparkles size={9} />
            Current Inbox Task
          </span>
          <h4 className="text-sm font-semibold text-white/95 leading-tight">
            {currentTask.title}
          </h4>
        </div>

        {currentTask.nextPhysicalAction && currentTask.nextPhysicalAction !== currentTask.title && (
          <div className="text-[11px] text-white/50 bg-white/2 border border-white/5 px-2 py-1 rounded">
            <span className="font-mono text-[9px] text-(--gold)/70 uppercase block">
              Next Physical Action:
            </span>
            {currentTask.nextPhysicalAction}
          </div>
        )}

        {suggestedMission && (
          <div className="p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-mono text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={10} /> Suggestion: {suggestedMission.title}
              </span>
              <span className="text-[9px] text-emerald-400/70 font-mono">
                {pc?.confidence ? `${Math.round(pc.confidence * 100)}% conf` : ""}
              </span>
            </div>
            {pc?.rationale && (
              <p className="text-[10px] text-white/60 leading-relaxed italic">
                &ldquo;{pc.rationale}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>

      {/* Buttons Grid */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/5">
        <button
          onClick={() => handleTriage({ decision: "today" })}
          className="flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-(--gold)/30 hover:bg-(--gold)/10 text-white/80 hover:text-(--gold) transition"
        >
          <Check size={14} className="mb-1 text-emerald-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Today</span>
        </button>

        <button
          onClick={() => {
            setActivePanel(activePanel === "schedule" ? "none" : "schedule");
          }}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-(--gold)/30 hover:bg-(--gold)/10 text-white/80 hover:text-(--gold) transition",
            activePanel === "schedule" && "border-(--gold) bg-(--gold)/10 text-(--gold)"
          )}
        >
          <Calendar size={14} className="mb-1 text-sky-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Schedule</span>
        </button>

        <button
          onClick={() => {
            setActivePanel(activePanel === "anytime" ? "none" : "anytime");
          }}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-(--gold)/30 hover:bg-(--gold)/10 text-white/80 hover:text-(--gold) transition",
            activePanel === "anytime" && "border-(--gold) bg-(--gold)/10 text-(--gold)"
          )}
        >
          <Sparkles size={14} className="mb-1 text-purple-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Anytime</span>
        </button>

        <button
          onClick={() => handleTriage({ decision: "someday" })}
          className="flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-(--gold)/30 hover:bg-(--gold)/10 text-white/80 hover:text-(--gold) transition"
        >
          <Archive size={14} className="mb-1 text-amber-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Someday</span>
        </button>

        <button
          onClick={() => {
            setActivePanel(activePanel === "snooze" ? "none" : "snooze");
          }}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-(--gold)/30 hover:bg-(--gold)/10 text-white/80 hover:text-(--gold) transition",
            activePanel === "snooze" && "border-(--gold) bg-(--gold)/10 text-(--gold)"
          )}
        >
          <Clock size={14} className="mb-1 text-pink-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Snooze</span>
        </button>

        <button
          onClick={() => {
            setActivePanel(activePanel === "kill" ? "none" : "kill");
          }}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded border border-white/5 bg-white/2 hover:border-red-500/30 hover:bg-red-500/10 text-white/80 hover:text-red-400 transition",
            activePanel === "kill" && "border-red-500 bg-red-500/10 text-red-400"
          )}
        >
          <Trash2 size={14} className="mb-1 text-red-500" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Kill</span>
        </button>
      </div>

      {/* Dynamic Panels */}
      {activePanel !== "none" && (
        <div className="mt-3 p-3 rounded bg-black/40 border border-white/5 space-y-3 transition-all duration-300">
          {activePanel === "schedule" && (
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase text-white/40 block">
                Select Due Date:
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  className="flex-1 bg-zinc-950 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-(--gold)/30"
                  onChange={(e) => {
                    if (e.target.value) {
                      void handleTriage({
                        decision: "schedule",
                        date: e.target.value,
                      });
                    }
                  }}
                />
              </div>
            </div>
          )}

          {activePanel === "snooze" && (
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase text-white/40 block">
                Select Snooze Duration:
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => handleTriage({ decision: "snooze", snoozeDays: 1 })}
                  className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-white/5 bg-white/2 hover:bg-white/5 hover:text-white transition"
                >
                  1 Day
                </button>
                <button
                  onClick={() => handleTriage({ decision: "snooze", snoozeDays: 3 })}
                  className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-white/5 bg-white/2 hover:bg-white/5 hover:text-white transition"
                >
                  3 Days
                </button>
                <button
                  onClick={() => handleTriage({ decision: "snooze", snoozeDays: 7 })}
                  className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-white/5 bg-white/2 hover:bg-white/5 hover:text-white transition"
                >
                  1 Week
                </button>
              </div>
              <div className="pt-2 border-t border-white/5">
                <span className="text-[9px] font-mono text-white/40 block mb-1">
                  Or custom date:
                </span>
                <input
                  type="date"
                  className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-(--gold)/30"
                  onChange={(e) => {
                    if (e.target.value) {
                      void handleTriage({
                        decision: "snooze",
                        date: e.target.value,
                      });
                    }
                  }}
                />
              </div>
            </div>
          )}

          {activePanel === "anytime" && (
            <div className="space-y-3">
              {suggestedMission && (
                <div className="space-y-1.5">
                  <span className="text-[9px] font-mono text-white/40 uppercase block">
                    Fast path to suggested project:
                  </span>
                  <button
                    onClick={() =>
                      handleTriage({
                        decision: "anytime",
                        missionId: suggestedMission.id,
                      })
                    }
                    className="w-full text-left text-[11px] font-medium px-2.5 py-2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition flex items-center justify-between"
                  >
                    <span>File into &ldquo;{suggestedMission.title}&rdquo;</span>
                    <Check size={10} />
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-[9px] font-mono text-white/40 uppercase block">
                  Choose active project:
                </span>
                <select
                  className="w-full bg-zinc-950 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-(--gold)/30"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      void handleTriage({
                        decision: "anytime",
                        missionId: e.target.value,
                      });
                    }
                  }}
                >
                  <option value="" disabled>
                    -- Select Project --
                  </option>
                  {activeMissions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t border-white/5 flex justify-end">
                <button
                  onClick={() => handleTriage({ decision: "anytime" })}
                  className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded bg-(--gold)/15 border border-(--gold)/30 text-(--gold) hover:bg-(--gold)/25 transition"
                >
                  Route to general / inbox
                </button>
              </div>
            </div>
          )}

          {activePanel === "kill" && (
            <div className="space-y-2">
              <span className="text-[11px] text-white/80 block font-medium">
                Are you absolutely sure you want to delete this task?
              </span>
              <p className="text-[10px] text-white/40">
                This action is permanent and cannot be undone via standard loops.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleTriage({ decision: "kill" })}
                  className="flex-1 text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded bg-red-600 border border-red-500 text-white hover:bg-red-700 transition font-bold"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setActivePanel("none")}
                  className="flex-1 text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isNested) {
    return innerContent;
  }

  return (
    <section
      aria-label="Inbox Triage Card"
      className="glass-card relative overflow-hidden bg-linear-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 border border-white/10 rounded-xl p-4 shadow-xl space-y-4"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-(--gold)/5 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <Inbox size={14} className="text-(--gold)" />
          <h3 className="text-xs font-mono uppercase tracking-[0.16em] text-white/95">
            Inbox Triage
          </h3>
          <span className="px-1.5 py-0.25 rounded bg-(--gold)/10 border border-(--gold)/20 text-[9px] font-semibold text-(--gold) font-mono">
            {inboxTasks.length} REMAINING
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          Things-style flow
        </span>
      </div>

      {innerContent}
    </section>
  );
}

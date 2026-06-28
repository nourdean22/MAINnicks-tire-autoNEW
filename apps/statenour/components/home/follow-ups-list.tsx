"use client";

import { trpc } from "@/lib/trpc/client";
import { Check, Plus, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

export function FollowUpsList() {
  const utils = trpc.useContext();
  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });

  const createTaskMutation = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.task.inboxCount.invalidate();
    },
  });

  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("statenour:dismissed-followups");
        return stored ? JSON.parse(stored) : [];
      }
    } catch {}
    return [];
  });
  const [loadingText, setLoadingText] = useState<string | null>(null);

  const handleDismiss = (text: string) => {
    const updated = [...dismissed, text];
    setDismissed(updated);
    try {
      localStorage.setItem("statenour:dismissed-followups", JSON.stringify(updated));
    } catch {}
  };

  const handleConvertToTask = async (text: string) => {
    try {
      setLoadingText(text);
      await createTaskMutation.mutateAsync({
        title: text,
        status: "INBOX",
      });
      handleDismiss(text);
    } catch (err) {
      console.error("Failed to convert follow-up to task:", err);
    } finally {
      setLoadingText(null);
    }
  };

  if (remembersQ.isLoading) {
    return null; // Don't layout shift
  }

  const allFollowUps = remembersQ.data?.followUps ?? [];
  const activeFollowUps = allFollowUps.filter((f) => !dismissed.includes(f));

  if (activeFollowUps.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="pending-follow-ups"
      className="rounded-xl border border-indigo-500/10 bg-indigo-500/1 p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-400 font-semibold flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" /> Pending Follow-Ups
        </p>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium">
          {activeFollowUps.length} Needed
        </span>
      </div>

      <div className="space-y-2">
        {activeFollowUps.map((followUp) => {
          const isPending = loadingText === followUp;
          return (
            <div
              key={followUp}
              className="flex items-start justify-between p-2.5 rounded bg-white/1 border border-white/3 hover:border-indigo-500/10 transition group gap-3"
            >
              <p className="text-xs text-white/70 leading-relaxed font-medium mt-0.5">
                {followUp}
              </p>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleConvertToTask(followUp)}
                  disabled={isPending}
                  className="p-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 hover:text-white transition disabled:opacity-50 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1"
                  title="Convert to Task"
                >
                  <Plus className="h-3 w-3" /> Task
                </button>
                <button
                  onClick={() => handleDismiss(followUp)}
                  disabled={isPending}
                  className="p-1 rounded bg-white/3 border border-white/5 text-white/40 hover:text-indigo-400 hover:border-indigo-500/20 transition disabled:opacity-50"
                  title="Dismiss Follow-Up"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

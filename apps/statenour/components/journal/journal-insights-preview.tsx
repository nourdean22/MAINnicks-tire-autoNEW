"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { BookOpen, Zap, Lightbulb, Target, Check, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TakeNextAction {
  action: string;
  domain: string | null;
}

interface InsightPreviewItem {
  id: string;
  entryId: string;
  updatedAt: string;
  entryTitle: string;
  goalId: string | null;
  idea: string | null;
  challenge: string | null;
  nextAction: TakeNextAction | null;
}

export function JournalInsightsPreview() {
  const { data: insights, isLoading, refetch } = trpc.journal.insightsPreview.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 2 * 60 * 1000,
  });

  const createTaskMut = trpc.task.create.useMutation();
  const [createdKeys, setCreatedKeys] = useState<Set<string>>(new Set());
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  // Filter items that have at least one takeaway
  const activeInsights = (insights || []).filter(
    (item) => item.idea || item.challenge || item.nextAction
  ) as unknown as InsightPreviewItem[];

  const handleCreateTask = async (item: InsightPreviewItem) => {
    if (!item.nextAction) return;
    const key = `${item.id}-task`;
    setCreatingKey(key);
    try {
      await createTaskMut.mutateAsync({
        title: item.nextAction.action,
        goalId: item.goalId || undefined,
        priority: "normal",
        loopKind: "ONCE",
      });
      setCreatedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      toast.success("Task created in Inbox");
    } catch {
      toast.error("Failed to create task");
    } finally {
      setCreatingKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-4 space-y-3 animate-pulse">
        <div className="h-4 w-40 bg-zinc-800 rounded" />
        <div className="space-y-2">
          <div className="h-12 bg-zinc-800/60 rounded" />
          <div className="h-12 bg-zinc-800/60 rounded" />
        </div>
      </div>
    );
  }

  if (activeInsights.length === 0) return null;

  return (
    <section
      aria-label="journal takeaways preview"
      className="rounded-xl border border-violet-500/20 bg-zinc-950/40 p-4 space-y-3"
    >
      <header className="flex items-center gap-2">
        <Sparkles size={13} className="text-violet-400" strokeWidth={2} />
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-violet-300">
          extracted journal takes
        </h3>
        <Badge variant="outline" className="ml-auto text-[8px] font-mono text-zinc-500 border-zinc-800 bg-zinc-900/30">
          local preview
        </Badge>
      </header>

      <div className="space-y-3">
        {activeInsights.slice(0, 5).map((item) => {
          const taskKey = `${item.id}-task`;
          const isCreated = createdKeys.has(taskKey);
          const isCreating = creatingKey === taskKey;

          return (
            <div
              key={item.id}
              className="rounded-lg border border-zinc-900 bg-zinc-950/20 p-3 space-y-2 transition-all hover:border-zinc-800"
            >
              {/* Source entry title */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-zinc-500 truncate max-w-[280px]">
                  source: {item.entryTitle}
                </span>
                <span className="text-[8px] font-mono text-zinc-600 ml-auto">
                  {new Date(item.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              {/* Take details */}
              <div className="space-y-1.5 pt-0.5">
                {/* Next Move */}
                {item.nextAction && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-emerald-500/[0.03] border border-emerald-500/10">
                    <Zap size={11} className="text-emerald-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase font-mono tracking-wider text-emerald-400/80">
                        next action {item.nextAction.domain && `#${item.nextAction.domain}`}
                      </p>
                      <p className="text-[11px] text-zinc-200 leading-snug mt-0.5">
                        {item.nextAction.action}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleCreateTask(item)}
                      disabled={isCreated || isCreating}
                      className={cn(
                        "h-6 px-2 text-[9px] font-bold uppercase transition-all shrink-0 self-center",
                        isCreated
                          ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 hover:bg-zinc-800"
                          : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black"
                      )}
                    >
                      {isCreating ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : isCreated ? (
                        <Check size={9} className="mr-0.5 inline" />
                      ) : null}
                      {isCreated ? "created" : "accept"}
                    </Button>
                  </div>
                )}

                {/* Bold Idea */}
                {item.idea && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-violet-500/[0.02] border border-violet-500/10">
                    <Lightbulb size={11} className="text-violet-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] uppercase font-mono tracking-wider text-violet-400/80">
                        bold idea
                      </p>
                      <p className="text-[11.5px] text-zinc-300 leading-relaxed mt-0.5">
                        {item.idea}
                      </p>
                    </div>
                  </div>
                )}

                {/* Sharp Challenge */}
                {item.challenge && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/[0.02] border border-amber-500/10">
                    <Target size={11} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] uppercase font-mono tracking-wider text-amber-400/80">
                        challenge
                      </p>
                      <p className="text-[11.5px] text-zinc-300 leading-relaxed mt-0.5">
                        {item.challenge}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

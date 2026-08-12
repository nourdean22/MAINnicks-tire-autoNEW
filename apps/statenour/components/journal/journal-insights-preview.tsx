"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Zap, Lightbulb, Target, Check, Loader2, Sparkles } from "lucide-react";
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
  ideaPromoted: boolean;
  challengePromoted: boolean;
  nextActionPromoted: boolean;
  /** BDN-007 · status of the commitment proposed from this take's nextAction (null = never proposed). */
  commitmentStatus: string | null;
  /** Evidence-tier WP · INFERRED for machine takes; null on legacy rows. */
  evidenceTier: string | null;
  /** Model's confidence in the nextAction (HIGH|MED|LOW), same extraction call. */
  takeConfidence: string | null;
}

type TakeKind = "nextAction" | "idea" | "challenge";

/**
 * BDN-007 · the take's lifecycle, stated instead of implied. The chain is
 * real: journal-brain proposes a commitment from every kept nextAction
 * (sourceRef "journal-take:<entryId>"), Home renders the verdict card, the
 * pulse ticker resolves the outcome. This line reads the actual commitment
 * status back so extraction stops looking like completion.
 */
function TakeLifecycle({ status }: { status: string | null }) {
  const TERMINAL: Record<string, string> = {
    abandoned: "dismissed",
    expired: "expired",
    stale: "stale",
  };
  const STAGE: Record<string, number> = {
    proposed: 1,
    accepted: 2,
    active: 2,
    in_progress: 2,
    blocked: 2,
    completed: 3,
    verified: 3,
  };
  const steps = ["captured", "proposed", "active", "done"] as const;
  const terminal = status ? TERMINAL[status] : undefined;
  const reached = status ? (STAGE[status] ?? 1) : 0;

  return (
    <p className="text-[8px] font-mono tracking-wider text-zinc-600 mt-1 flex items-center gap-1 flex-wrap">
      {terminal ? (
        <>
          <span className="text-zinc-400">captured</span>
          <span>→</span>
          <span className="text-zinc-400">proposed</span>
          <span>→</span>
          <span className="text-zinc-500">× {terminal}</span>
        </>
      ) : (
        steps.map((step, i) => (
          <span key={step} className="flex items-center gap-1">
            {i > 0 && <span>→</span>}
            <span
              className={cn(
                i < reached && "text-zinc-400",
                i === reached && "text-emerald-400",
                i > reached && "text-zinc-700",
              )}
            >
              {step}
              {i === 1 && reached === 1 && " · verdict on Home"}
            </span>
          </span>
        ))
      )}
    </p>
  );
}

export function JournalInsightsPreview() {
  const { data: insights, isLoading, refetch } = trpc.journal.insightsPreview.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 2 * 60 * 1000,
  });
  const utils = trpc.useUtils();

  // Loop-closure wave (audit 2026-07-15) · accepts go through the
  // journal.promoteNextAction seam so the take row's per-layer promoted
  // flag is stamped server-side — the home hub's latestNextAction stops
  // resurfacing accepted actions, and re-accepting after a remount is
  // rejected server-side instead of minting a duplicate task.
  const promoteMut = trpc.journal.promoteNextAction.useMutation();
  const [promotingKey, setPromotingKey] = useState<string | null>(null);

  const activeInsights = (insights || []).filter(
    (item) => item.idea || item.challenge || item.nextAction
  ) as unknown as InsightPreviewItem[];

  const handlePromote = async (item: InsightPreviewItem, kind: TakeKind) => {
    const key = `${item.id}-${kind}`;
    setPromotingKey(key);
    try {
      await promoteMut.mutateAsync({ entryId: item.entryId, kind });
      toast.success("Task created in Inbox");
      await Promise.all([
        refetch(),
        utils.journal.latestNextAction.invalidate(),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create task";
      toast.error(message);
      // "already promoted" means our view was stale — refresh it.
      void refetch();
    } finally {
      setPromotingKey(null);
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

  const acceptButton = (
    item: InsightPreviewItem,
    kind: TakeKind,
    promoted: boolean,
    accent: string,
  ) => {
    const key = `${item.id}-${kind}`;
    const isPromoting = promotingKey === key;
    return (
      <Button
        size="sm"
        onClick={() => handlePromote(item, kind)}
        disabled={promoted || isPromoting}
        aria-label={promoted ? `${kind} already promoted` : `accept ${kind} as task`}
        className={cn(
          "h-6 min-h-[28px] px-2 text-[9px] font-bold uppercase transition-all shrink-0 self-center",
          promoted
            ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 hover:bg-zinc-800"
            : accent
        )}
      >
        {isPromoting ? (
          <Loader2 size={9} className="animate-spin" />
        ) : promoted ? (
          <Check size={9} className="mr-0.5 inline" />
        ) : null}
        {promoted ? "created" : "accept"}
      </Button>
    );
  };

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
        {activeInsights.slice(0, 5).map((item) => (
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
                    <TakeLifecycle status={item.commitmentStatus} />
                    {item.evidenceTier && (
                      <p className="text-[8px] font-mono tracking-wider text-zinc-600 mt-0.5">
                        {item.evidenceTier.toLowerCase()}
                        {item.takeConfidence && ` · confidence ${item.takeConfidence.toLowerCase()}`}
                      </p>
                    )}
                  </div>
                  {acceptButton(
                    item,
                    "nextAction",
                    item.nextActionPromoted,
                    "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black"
                  )}
                </div>
              )}

              {/* Bold Idea */}
              {item.idea && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-violet-500/[0.02] border border-violet-500/10">
                  <Lightbulb size={11} className="text-violet-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase font-mono tracking-wider text-violet-400/80">
                      bold idea
                    </p>
                    <p className="text-[11.5px] text-zinc-300 leading-relaxed mt-0.5">
                      {item.idea}
                    </p>
                  </div>
                  {acceptButton(
                    item,
                    "idea",
                    item.ideaPromoted,
                    "bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500 hover:text-black"
                  )}
                </div>
              )}

              {/* Sharp Challenge */}
              {item.challenge && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/[0.02] border border-amber-500/10">
                  <Target size={11} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase font-mono tracking-wider text-amber-400/80">
                      challenge
                    </p>
                    <p className="text-[11.5px] text-zinc-300 leading-relaxed mt-0.5">
                      {item.challenge}
                    </p>
                  </div>
                  {acceptButton(
                    item,
                    "challenge",
                    item.challengePromoted,
                    "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500 hover:text-black"
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

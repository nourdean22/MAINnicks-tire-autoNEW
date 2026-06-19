"use client";

/**
 * NEXT-ACTION WHISPERER — ephemeral momentum card.
 *
 * Listens to the cross-surface `data-change` event bus for task completions
 * (fired by TodaysThree + ActionsSection + chat + anywhere). When one lands,
 * we pull the next highest-priority task and surface a 30-second transient
 * card: "You just did X. Next 15-min slot: Y. Start?"
 *
 * The card auto-dismisses after 30s, or when Nour clicks start/skip, or when
 * a newer completion arrives (replaces the card).
 *
 * This is the lightweight flow-keeper — after a win, friction to the next
 * action should be near zero.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { onDataChanged, notifyDataChanged } from "@/lib/events/data-change";
import { Play, X as XIcon, Zap } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
interface Task {
  id: string;
  title: string;
  status: string;
  autoPriority: number | null;
  effort?: string | null;
  mission?: { title: string; domain: string | null } | null;
}

const EFFORT_LABEL: Record<string, string> = {
  M5: "5m", M15: "15m", M30: "30m", H1: "1h", H2PLUS: "2h+",
};

// Hides itself for this long after user skips, so we don't pop up twice
// after the user explicitly said "not now."
const SKIP_COOLDOWN_MS = 5 * 60 * 1000;

export function NextActionWhisperer() {
  const [suggestion, setSuggestion] = useState<Task | null>(null);
  const [visible, setVisible] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef<number>(0);
  // Phase B.6b (2026-05-22) · migrated off `authedFetch` onto
  // `trpc.task.*`. The next-task read is event-driven (fires on a
  // `data-change` task-completion), not a render-time query · so it
  // goes through `utils.task.list.fetch()`. The start action is a
  // `task.update` mutation.
  const utils = trpc.useUtils();
  const updateTask = trpc.task.update.useMutation();

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    clearDismissTimer();
    // Keep suggestion in state for fade-out before unmount if we add
    // animation later; currently we just unmount.
    setTimeout(() => setSuggestion(null), 250);
  }, [clearDismissTimer]);

  const fetchNext = useCallback(async () => {
    try {
      const raw = (await utils.task.list.fetch(undefined)) as Task[];
      const arr = Array.isArray(raw) ? raw : [];
      const open = arr.filter(
        (t) => ["INBOX", "READY"].includes(t.status),
      );
      // Prefer tasks with effort=M15 (the "quick slot" sweet spot), then
      // lowest autoPriority (closest to 1 = highest priority).
      open.sort((a, b) => {
        const aIsSlot = a.effort === "M15" ? 0 : 1;
        const bIsSlot = b.effort === "M15" ? 0 : 1;
        if (aIsSlot !== bIsSlot) return aIsSlot - bIsSlot;
        return (a.autoPriority ?? 99) - (b.autoPriority ?? 99);
      });
      return open[0] ?? null;
    } catch {
      return null;
    }
  }, [utils]);

  // Listen for task completions
  useEffect(() => {
    return onDataChanged(["tasks", "any"], async (e) => {
      if (e.detail !== "complete") return;
      if (Date.now() < cooldownUntilRef.current) return;

      const next = await fetchNext();
      if (!next) return;

      clearDismissTimer();
      setSuggestion(next);
      setVisible(true);
      dismissTimerRef.current = window.setTimeout(hide, 30_000);
    });
  }, [fetchNext, hide, clearDismissTimer]);

  // Cleanup on unmount
  useEffect(() => () => clearDismissTimer(), [clearDismissTimer]);

  if (!suggestion || !visible) return null;

  const start = async () => {
    try {
      await updateTask.mutateAsync({
        id: suggestion.id,
        fields: { status: "DOING" },
      });
      toast.success(`started: ${suggestion.title.slice(0, 40)}`);
      notifyDataChanged("tasks", { source: "ultron-whisperer", detail: "start", id: suggestion.id });
    } catch {
      toast.error("failed to start");
    }
    hide();
  };

  const skip = () => {
    cooldownUntilRef.current = Date.now() + SKIP_COOLDOWN_MS;
    hide();
  };

  return (
    <section
      className={cn(
        "rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/5 px-3 py-2.5",
        "flex items-center gap-3 animate-fade-in-scale",
      )}
    >
      <Zap size={14} className="text-[var(--gold)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-[var(--gold)] mb-0.5">
          next action · {suggestion.effort ? EFFORT_LABEL[suggestion.effort] ?? suggestion.effort : "—"} slot
        </p>
        <p className="text-[12px] text-[var(--text-primary)] leading-snug truncate">
          {suggestion.title}
        </p>
        {suggestion.mission?.title && (
          <p className="text-[9px] text-[var(--text-tertiary)] truncate">
            {suggestion.mission.title}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={start}
          className="flex items-center gap-1 px-2 py-1 min-h-[44px] sm:min-h-0 rounded border border-[var(--gold)]/40 bg-[var(--gold)]/15 text-[9px] font-bold uppercase tracking-wider text-[var(--gold)] hover:bg-[var(--gold)]/25 transition-colors"
        >
          <Play size={9} /> start
        </button>
        <button
          onClick={skip}
          className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10"
          aria-label="Skip for 5 min"
        >
          <XIcon size={11} />
        </button>
      </div>
    </section>
  );
}

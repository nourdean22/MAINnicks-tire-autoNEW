"use client";

/**
 * AiSuggestionsBand · v10.0.328 · the AI-suggested-tasks panel for /tasks.
 *
 * Stage C.2 of the /tasks decomposition. ~44 LOC of inline JSX → 1
 * typed component call. Renders only when `tasks.length > 0` (parent
 * keeps the gate so the component can stay simple).
 *
 * Encapsulates:
 *   · Header row · sparkle icon + count + "Add all" button
 *   · Per-suggestion row · priority chip (critical/high/medium/low) +
 *     title + per-row "+" adopt button
 *
 * The adoption flow stays in the parent · the component just emits
 * onAdopt(task) and onAdoptAll() so the parent owns the loading +
 * toast + load() refresh logic.
 */

import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AiTask {
  title: string;
  missionId: string | null;
  priority: "critical" | "high" | "medium" | "low";
  nextAction: string;
  reasoning: string;
}

interface AiSuggestionsBandProps {
  tasks: AiTask[];
  onAdopt: (task: AiTask) => void | Promise<void>;
  onAdoptAll: () => void | Promise<void>;
}

export function AiSuggestionsBand({ tasks, onAdopt, onAdoptAll }: AiSuggestionsBandProps) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-lg bg-zinc-900/40 border border-zinc-800/30 p-2 space-y-0.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-amber-400/70 font-bold flex items-center gap-1">
          <Sparkles size={9} />
          {tasks.length} AI suggestions
        </span>
        <Button
          size="sm"
          className="h-5 px-2 text-[8px] bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-black font-bold rounded-md"
          onClick={onAdoptAll}
        >
          Add all
        </Button>
      </div>
      {tasks.map((t, i) => (
        <div key={i} className="flex items-center gap-2 py-1 px-2 hover:bg-zinc-800/30 rounded-lg">
          <span
            className={cn(
              "text-[8px] font-bold uppercase w-10 shrink-0",
              t.priority === "critical"
                ? "text-red-400"
                : t.priority === "high"
                  ? "text-amber-400"
                  : "text-zinc-600"
            )}
          >
            {t.priority}
          </span>
          <span className="text-[11px] text-zinc-300 flex-1 truncate">{t.title}</span>
          <Button
            size="sm"
            className="h-5 px-1.5 text-[8px] bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-black font-bold rounded-md"
            onClick={() => onAdopt(t)}
          >
            +
          </Button>
        </div>
      ))}
    </div>
  );
}

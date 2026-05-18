"use client";

/**
 * QuickAddBar · v10.0.325 · the universal quick-add row for /tasks.
 *
 * Stage B.1 of the /tasks decomposition campaign · v10.0.311 (Stage A)
 * extracted the NowOperatorBar (130 LOC) · this extracts the next ~130
 * LOC of inline JSX from the parent page.
 *
 * Encapsulates:
 *   · Input field with onKeyDown=Enter→onAdd hook
 *   · Plus-button "add" trigger
 *   · Voice recording button (Mic / Square / Loader2 states)
 *   · AI-suggest sparkle button
 *   · Live parse preview chips (kind / title / promiseTo / deadline / domain / effort)
 *   · Empty-state syntax hint (`@dania · daily: ... · ... by fri · @health · /30m`)
 *
 * The quickAddParsed computation moved INSIDE the component since it only
 * depends on newTask · saves a prop and keeps the component self-contained.
 *
 * Why surgical extraction matters here · /tasks is the operator's daily
 * driver · the page was 2391 LOC pre-extraction · breaking this critical
 * surface would cost the next morning. The component pre-bakes typed
 * props (no `any`s) so the parent page sees a strict interface contract.
 */

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Mic, Square, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseQuickAdd } from "@/lib/loops/quick-add-parser";
import { domainClass as dc } from "@/components/actions/shared";

interface VoiceObject {
  isRecording: boolean;
  transcribing: boolean;
  startRecording: () => Promise<void> | void;
  stopRecording: () => void;
}

interface QuickAddBarProps {
  newTask: string;
  setNewTask: (value: string | ((prev: string) => string)) => void;
  voice: VoiceObject;
  onAdd: () => void | Promise<void>;
  onGenAi: () => void | Promise<void>;
  generating: boolean;
}

export function QuickAddBar({
  newTask,
  setNewTask,
  voice,
  onAdd,
  onGenAi,
  generating,
}: QuickAddBarProps) {
  // Quick-add live preview — parse as you type so Nour sees what
  // kind + deadline the parser detected before hitting Enter.
  const quickAddParsed = useMemo(() => {
    const text = newTask.trim();
    if (text.length < 3) return null;
    return parseQuickAdd(text);
  }, [newTask]);

  // H.3.1 · suppress DeepModeNudge on this quick-add bar. Tasks are
  // short verbs ("call mom", "ship feature") — they routinely contain
  // "strategy" / "research" / etc. keywords the classifier matches.
  // The nudge there would fire on every task add. data-no-deep-nudge
  // on this wrapper makes the global watcher skip any focused input
  // inside it.
  return (
    <div className="space-y-1" data-no-deep-nudge>
      <div className="flex gap-1.5">
        <Input
          placeholder="What needs to happen?"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          className="h-9 bg-zinc-900/60 border-zinc-800/40 text-[13px] placeholder:text-zinc-600 focus:border-amber-500/30 transition-all"
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0 bg-zinc-800/80 hover:bg-amber-500/20 hover:text-amber-400 border border-zinc-700/50 shrink-0"
          onClick={onAdd}
        >
          <Plus size={14} />
        </Button>
        {/* Apr 26 · F9 — voice input. Tap to record, tap to
            stop + transcribe (Whisper). Transcript appends to
            whatever's in the input so dictation + cleanup is
            natural. Hidden when SSR / mediaDevices unavailable. */}
        <Button
          size="sm"
          onClick={() => {
            if (voice.transcribing) return;
            if (voice.isRecording) voice.stopRecording();
            else void voice.startRecording();
          }}
          disabled={voice.transcribing}
          title={
            voice.isRecording
              ? "Stop recording"
              : voice.transcribing
                ? "Transcribing…"
                : "Voice add (Whisper)"
          }
          className={cn(
            "h-9 w-9 p-0 border shrink-0",
            voice.isRecording
              ? "bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/40 animate-pulse"
              : voice.transcribing
                ? "bg-zinc-800 text-zinc-500 border-zinc-700/50"
                : "bg-zinc-800/80 hover:bg-amber-500/20 hover:text-amber-400 border-zinc-700/50"
          )}
        >
          {voice.transcribing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : voice.isRecording ? (
            <Square size={12} fill="currentColor" />
          ) : (
            <Mic size={13} />
          )}
        </Button>
        <Button
          size="sm"
          className="h-9 px-2.5 bg-zinc-900 hover:bg-amber-500/15 text-zinc-500 hover:text-amber-400 text-[9px] font-bold border border-zinc-800 rounded shrink-0"
          onClick={onGenAi}
          disabled={generating}
          title="AI suggest tasks"
        >
          {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        </Button>
      </div>
      {/* Apr 26 · F4 — Live parse preview, expanded.
          Shows what the parser will save BEFORE Nour hits enter:
          kind / title / promiseTo / deadline / domain / effort.
          Empty input → tiny syntax hint so you don't have to
          remember the tokens. Anything unrecognized just shows
          the title — never blocks a save. */}
      {quickAddParsed ? (
        <div className="flex items-center gap-1.5 px-1 text-[9px] flex-wrap">
          <span className={cn(
            "px-1.5 py-0.5 rounded border font-bold uppercase",
            quickAddParsed.loopKind === "DAILY"
              ? "text-amber-400 border-amber-500/30 bg-amber-500/5"
              : quickAddParsed.loopKind === "PROMISE"
                ? "text-rose-300 border-rose-500/30 bg-rose-500/5"
                : "text-blue-400 border-blue-500/30 bg-blue-500/5"
          )}>
            {quickAddParsed.loopKind}
          </span>
          <span className="text-zinc-400 truncate min-w-0 flex-1">
            &ldquo;{quickAddParsed.title}&rdquo;
          </span>
          {quickAddParsed.promiseTo && (
            <span className="px-1.5 py-0.5 rounded border border-rose-500/30 bg-rose-500/5 text-rose-300 font-mono">
              @{quickAddParsed.promiseTo}
            </span>
          )}
          {quickAddParsed.dueDate && (
            <span className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300 font-mono">
              {(() => {
                const due = new Date(quickAddParsed.dueDate);
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
                const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86_400_000);
                if (days === 0) return "today";
                if (days === 1) return "tomorrow";
                if (days >= 2 && days <= 6) {
                  return due.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
                }
                if (days >= 7 && days < 14) return `${days}d`;
                return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              })()}
            </span>
          )}
          {quickAddParsed.domain && (
            <span className={cn("px-1.5 py-0.5 rounded border font-mono", dc(quickAddParsed.domain), "border-current/30")}>
              {quickAddParsed.domain}
            </span>
          )}
          {quickAddParsed.effort && (
            <span className="px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 font-mono">
              {quickAddParsed.effort.replace(/^M/, "").replace(/^H/, "h").replace("PLUS", "+")}
              {quickAddParsed.effort.startsWith("M") ? "m" : ""}
            </span>
          )}
        </div>
      ) : newTask.length === 0 ? (
        <div className="flex items-center gap-2 px-1 text-[9px] text-zinc-700 font-mono select-none">
          <span>@dania</span>
          <span className="text-zinc-800">·</span>
          <span>daily: ...</span>
          <span className="text-zinc-800">·</span>
          <span>... by fri</span>
          <span className="text-zinc-800">·</span>
          <span>@health</span>
          <span className="text-zinc-800">·</span>
          <span>/30m</span>
        </div>
      ) : null}
    </div>
  );
}

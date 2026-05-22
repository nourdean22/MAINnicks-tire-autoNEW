"use client";

/**
 * CAPTURE MODAL — Global brain-dump surface.
 *
 * Opens via:
 *   - Cmd/Ctrl+Shift+J from anywhere
 *   - `window.dispatchEvent(new Event("ultron:open-capture"))` — used by
 *     the FloatingHome quick-nav "Capture" action so there's ONE floating
 *     button on screen, not two.
 *
 * The old draggable floating trigger was removed in the v10 Ultron
 * consolidation — FloatingHome is the single floating affordance now.
 *
 * Fires the data-change event bus so the /journal page, Ultron, and
 * /tasks all refresh.
 *
 * v10.0.529.22 · optimistic UI · clears the textarea + restores focus
 * the moment the capture request is dispatched, so the operator can
 * keep typing the next thought while AI extraction + pgvector embedding
 * run in the background (3-8s typical end-to-end). Sonner toast carries
 * the eventual result. Previous flow locked the textarea + switched the
 * modal into a result-card mode for the full pipeline duration. Highest
 * operator-facing UX gain from the /journal audit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { Sparkles, X, Zap, NotebookPen, Loader2 } from "lucide-react";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/journal/
// capture")` onto `trpc.brain.captureThought` · the optimistic-UI clear
// stays client-side, fired before the mutation resolves.
import { trpc } from "@/lib/trpc/client";
// v10.0.529.26 · Arc B Phase 1A · extend wisdom-suggest from /chat to
// the brain-dump composer. Same hook + same UI surface · sits ABOVE
// the textarea as a faded gold-on-dark margin note · operator
// either accepts (Enter / click) or dismisses (×). Self-disables
// while a capture is in-flight via the same isStreaming gate /chat
// uses while Nick is replying.
import { WisdomPill } from "@/components/chat/wisdom-pill";
interface CaptureResult {
  brainDumpId: string;
  entryType: string;
  summary: string;
  tasksCreated: number;
  insightsStored: number;
  commitmentsFound: number;
}

export const CAPTURE_OPEN_EVENT = "ultron:open-capture";

export function BrainDumpModal() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // v10.0.529.22 · `inFlight` is a count, not a boolean — the operator
  // can now fire captures back-to-back without waiting. The send button
  // still disables on empty text but never on the in-flight state.
  const [inFlight, setInFlight] = useState(0);
  // Most-recent capture result · sticky footer feedback. Replaces the
  // pre-v529.22 modal-mode-switch (result-card replaced the textarea).
  const [lastResult, setLastResult] = useState<CaptureResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captureMutation = trpc.brain.captureThought.useMutation();

  // Global hotkey: Cmd/Ctrl+Shift+J
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Window event opener — lets FloatingHome (and anyone else) trigger
  // this modal without a prop drill or portal choreography.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen);
  }, []);

  // Focus the textarea when the modal opens · reset state on close
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      setTimeout(() => {
        setText("");
        setLastResult(null);
      }, 200);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 3) return;

    // v10.0.529.22 · optimistic UI · clear textarea + bump in-flight
    // counter + restore focus BEFORE awaiting the network round-trip.
    // The raw BrainDump row write inside ingestJournal happens before
    // any AI call, so the thought is durable the moment the API
    // returns. The operator doesn't need to wait for AI extraction to
    // type the next thought.
    setText("");
    setInFlight((n) => n + 1);
    requestAnimationFrame(() => textareaRef.current?.focus());

    const toastId = toast.loading("Capturing thought…");

    try {
      const data = (await captureMutation.mutateAsync({
        text: trimmed,
      })) as CaptureResult;
      setLastResult(data);
      notifyDataChanged("any", { source: "global-capture", detail: "journal-capture" });

      // Compact "+N task · +N insight · +N commitment" suffix · the
      // operator sees the extraction result without re-opening the
      // modal in a result-mode pane.
      const counts: string[] = [];
      if (data.tasksCreated > 0)
        counts.push(`+${data.tasksCreated} task${data.tasksCreated > 1 ? "s" : ""}`);
      if (data.insightsStored > 0)
        counts.push(`+${data.insightsStored} insight${data.insightsStored > 1 ? "s" : ""}`);
      if (data.commitmentsFound > 0)
        counts.push(
          `+${data.commitmentsFound} commitment${data.commitmentsFound > 1 ? "s" : ""}`
        );
      const suffix = counts.length > 0 ? ` · ${counts.join(" · ")}` : "";
      toast.success(`Captured as ${data.entryType}${suffix}`, { id: toastId });
    } catch {
      toast.error("Capture failed", { id: toastId });
    } finally {
      setInFlight((n) => Math.max(0, n - 1));
    }
  }, [text, captureMutation]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [submit]
  );

  if (!open) return null;

  return (
    // v10.0.529.21 a11y + mobile fix · iPhone Safari raises the
    // on-screen keyboard which pushes the visual viewport up · the
    // pre-fix `pt-[10vh]` was computed against the layout viewport so
    // the modal sat 10% from the top regardless, and the textarea +
    // submit button could fall partially below the keyboard fold.
    <div
      className="fixed inset-0 z-[9500] flex items-start sm:items-center justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom,0px)] bg-[var(--bg-void)]/85 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Capture a thought"
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.15)] overflow-hidden animate-fade-in-scale max-h-[calc(100dvh-4rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NotebookPen size={14} className="text-[var(--gold)]" />
            <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              Capture a Thought
            </span>
            {inFlight > 0 && (
              <span
                className="flex items-center gap-1 text-[9px] font-mono text-[var(--text-tertiary)]"
                aria-live="polite"
                aria-label={`${inFlight} capture${inFlight > 1 ? "s" : ""} processing`}
              >
                <Loader2 size={10} className="animate-spin text-[var(--gold)]/70" />
                {inFlight} processing
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline-flex items-center gap-1 h-5 px-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[9px] font-mono text-[var(--text-tertiary)]">
              ⌘⇧J
            </kbd>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* v10.0.529.21 · body scrolls inside the flex-column modal so
            content can't push the submit button below the keyboard
            fold on iPhone. v10.0.529.22 · single textarea-mode view ·
            no more result-card mode switch — the last-captured strip
            below carries the extraction summary inline. */}
        <div className="p-4 space-y-3 overflow-y-auto">
          {/* v10.0.529.26 · Arc B Phase 1A · at-write-time wisdom
              suggestion. The same hook + UI surface /chat shipped at
              v526. The pill listens to the draft, debounces 600ms,
              fetches up to 2 wisdoms from /api/ai/chat/wisdom-suggest,
              renders faded gold-on-dark above the textarea. Operator
              accepts (Enter / click) → wisdom inserted as
              "// considering: …" margin note prepended to the draft.
              Disabled while a capture is in-flight so the pill never
              competes for attention during the extraction round-trip. */}
          <WisdomPill
            draft={text}
            isStreaming={inFlight > 0}
            onUseThis={(next) => {
              setText(next);
              // Restore focus to the textarea so the operator can keep
              // typing immediately after accepting a wisdom · matches
              // the /chat pattern + the modal's own focus restoration
              // on submit. requestAnimationFrame ensures the textarea
              // is mounted + the new value rendered first.
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="What's in your head right now? Nick will sort it into thinking / reasoning / insight / decision / reflection — and extract any tasks, commitments, or patterns."
            rows={6}
            className={cn(
              "w-full text-[13px] leading-[1.55] resize-none rounded-xl px-3.5 py-3",
              "bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-primary)]",
              "placeholder:text-[var(--text-tertiary)] outline-none transition-colors",
              "focus:border-[var(--gold)]/40"
            )}
          />
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-[var(--text-tertiary)]">
              Runs the full ingest pipeline — tasks, insights, commitments, mood.
              Fires across Ultron + Actions + Journal.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[var(--text-tertiary)] font-mono">
                {text.length}
              </span>
              <button
                onClick={submit}
                disabled={text.trim().length < 3}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border transition-all",
                  text.trim().length < 3
                    ? "bg-transparent border-zinc-800 text-zinc-600"
                    : "bg-[var(--gold)]/15 border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/25"
                )}
                aria-label="Capture thought"
              >
                <Zap size={11} />
                Capture
              </button>
            </div>
          </div>

          {/* v10.0.529.22 · sticky last-captured strip · the most-
              recent extraction result stays visible inline so the
              operator can verify Nick's parsing without losing the
              textarea or the keyboard focus. Replaces the pre-v529.22
              result-card mode-switch. */}
          {lastResult && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30"
              aria-live="polite"
            >
              <Sparkles size={11} className="text-emerald-400 flex-shrink-0" />
              <span className="text-[10px] text-emerald-300 font-medium truncate">
                Last:{" "}
                <span className="font-bold uppercase">{lastResult.entryType}</span>
                {lastResult.tasksCreated > 0 && (
                  <span className="text-amber-400">
                    {" · "}+{lastResult.tasksCreated} task
                    {lastResult.tasksCreated > 1 ? "s" : ""}
                  </span>
                )}
                {lastResult.insightsStored > 0 && (
                  <span className="text-blue-400">
                    {" · "}+{lastResult.insightsStored} insight
                    {lastResult.insightsStored > 1 ? "s" : ""}
                  </span>
                )}
                {lastResult.commitmentsFound > 0 && (
                  <span className="text-violet-400">
                    {" · "}+{lastResult.commitmentsFound} commitment
                    {lastResult.commitmentsFound > 1 ? "s" : ""}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

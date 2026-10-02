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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
interface CaptureResult {
  brainDumpId: string;
  entryType: string;
  summary: string;
  tasksCreated: number;
  insightsStored: number;
  commitmentsFound: number;
}

export const CAPTURE_OPEN_EVENT = "ultron:open-capture";

// ─── Mode-Based Capture · journal-advancement item B (2026-06-10) ───
// 7 capture modes. A mode ONLY seeds the prompt (placeholder) + declares
// the entryType — capture stays instant, zero extra round-trips. The
// declared type rides the captureThought mutation as entryTypeHint and
// outranks the blind fast classification (operator is ground truth).
type EntryTypeHint =
  | "raw" | "thinking" | "reasoning" | "insight"
  | "decision" | "reflection" | "planning" | "venting";

interface CaptureMode {
  key: string;
  label: string;
  desc: string;
  placeholder: string;
  hint: EntryTypeHint | null; // null = let the AI classify (plain dump)
}

const CAPTURE_MODES: CaptureMode[] = [
  {
    key: "dump",
    label: "Dump",
    desc: "Empty your head — raw, unfiltered. Nick sorts it.",
    placeholder:
      "What's in your head right now? Nick will sort it into thinking / reasoning / insight / decision / reflection — and extract any tasks, commitments, or patterns.",
    hint: null,
  },
  {
    key: "debrief",
    label: "Daily Debrief",
    desc: "Close the day like an operator.",
    placeholder:
      "Today: what moved? What stalled? What did you avoid? Name the one thing tomorrow must get.",
    hint: "reflection",
  },
  {
    key: "battle",
    label: "Battle Log",
    desc: "Log the fight while it's hot.",
    placeholder:
      "What hit you, how you reacted, what it cost. No varnish — the log is for the operator you're becoming.",
    hint: "venting",
  },
  {
    key: "replay",
    label: "Decision Replay",
    desc: "Re-run a call you made.",
    placeholder:
      "The decision. The options you saw. Why you chose. What you'd do differently knowing what you know now.",
    hint: "decision",
  },
  {
    key: "breaker",
    label: "Pattern Breaker",
    desc: "Name the loop to break it.",
    placeholder:
      "Which pattern fired again? What triggered it? What's the interrupt next time it starts?",
    hint: "insight",
  },
  {
    key: "win",
    label: "Win Proof",
    desc: "Evidence you're becoming.",
    placeholder:
      "What did you do that your old self wouldn't have? Specifics — date it, size it, name what it proves.",
    hint: "reflection",
  },
  {
    key: "future",
    label: "Future Self",
    desc: "Write from who you're becoming.",
    placeholder:
      "It's 12 months out and it worked. What did you do THIS week to get here? Lay out the next moves.",
    hint: "planning",
  },
];

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
  // Item B · active capture mode. Index 0 (Dump) = the classic behavior.
  const [modeKey, setModeKey] = useState<string>(CAPTURE_MODES[0].key);
  const mode = CAPTURE_MODES.find((m) => m.key === modeKey) ?? CAPTURE_MODES[0];
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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        setModeKey(CAPTURE_MODES[0].key);
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
        // Item B · the mode's declared entry type (undefined for Dump —
        // the AI classifies freely, exactly the pre-mode behavior).
        entryTypeHint: mode.hint ?? undefined,
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
  }, [text, captureMutation, mode]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  if (!open) return null;

  return (
    // v10.0.529.21 a11y + mobile fix · iPhone Safari raises the
    // on-screen keyboard which pushes the visual viewport up. Base UI Dialog
    // now owns focus trapping/restoration, Escape/outside dismissal and scroll lock.
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-[9500] bg-[var(--bg-void)]/85 backdrop-blur-sm"
        className="fixed left-1/2 top-[max(2rem,env(safe-area-inset-top))] z-[9501] flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.15)] outline-none animate-fade-in-scale sm:top-1/2 sm:-translate-y-1/2"
      >
        <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NotebookPen size={14} className="text-[var(--gold)]" />
            <DialogTitle className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              Capture a Thought
            </DialogTitle>
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
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
          {/* Item B · mode strip. Selecting a mode is instant — it only
              swaps the placeholder prompt + declares the entryType hint.
              No round-trip, no extra state to wait on. */}
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {CAPTURE_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setModeKey(m.key);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  aria-pressed={m.key === mode.key}
                  className={cn(
                    "rounded-micro border px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-all",
                    "[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3",
                    m.key === mode.key
                      ? "bg-[var(--gold)]/15 border-[var(--gold)]/40 text-[var(--gold)]"
                      : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-[var(--text-tertiary)] italic">
              {mode.desc}
              {mode.hint && (
                <span className="ml-1 font-mono not-italic text-[var(--gold)]/50">
                  → {mode.hint}
                </span>
              )}
            </p>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={mode.placeholder}
            rows={6}
            className={cn(
              "w-full text-[16px] sm:text-[13px] leading-[1.55] resize-none rounded-xl px-3.5 py-3",
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
                  "flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-control text-[11px] font-bold border transition-all",
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
      </DialogContent>
    </Dialog>
  );
}

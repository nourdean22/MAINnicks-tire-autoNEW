"use client";

/**
 * OMNI-CAPTURE BAR — the universal input.
 *
 * One box. Five prefixes. Infinite options:
 *   /ask    → stream Nick inline
 *   /decide → decision log
 *   /dump   → brain-dump + auto-sort via /api/journal/capture
 *   /park   → parking lot (localStorage v1)
 *   /search → nav to /chat?q=... (was /knowledge?q=, retired 2026-08-16)
 *
 * No prefix → auto-classify (see lib/ultron/omni-capture-router).
 *
 * The /ask path uses the existing streaming Nick transport (same as the old
 * HQ NickInput). The response card lives inline here and is dismissible,
 * pinnable, or continuable in the full /chat.
 */

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Send, MessageSquare, Pin, X, Loader2, Mic, NotebookPen, GitBranch, Inbox, Search, Sparkles, ArrowRight, Play, ExternalLink, Eye, ListChecks } from "lucide-react";
import { routeCapture, cycleIntentKind, type CaptureIntent, type CycleableKind } from "@/lib/ultron/omni-capture-router";
import { capturePlaceholderFor } from "@/lib/ultron/persona-map";
import { notifyDataChanged } from "@/lib/events/data-change";
import { CAPTURE_OPEN_EVENT } from "@/components/brain-dump-modal";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import type { UltronMode } from "@/lib/ultron/mode-classifier";

import { trpc } from "@/lib/trpc/client";
const LAST_RESPONSE_KEY = "ultron:ask:last";
const LAST_RESPONSE_TTL_MS = 10 * 60 * 1000;
const PINNED_KEY = "ultron:ask:pinned";
const PARK_KEY = "ultron:park";

// ── Persistence helpers ─────────────────────────────────────
interface CachedResponse {
  q: string;
  text: string;
  timestamp: number;
}

function loadCached(): CachedResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_RESPONSE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedResponse;
    if (Date.now() - parsed.timestamp > LAST_RESPONSE_TTL_MS) {
      localStorage.removeItem(LAST_RESPONSE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCached(entry: CachedResponse): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LAST_RESPONSE_KEY, JSON.stringify(entry)); } catch {}
}

function clearCached(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(LAST_RESPONSE_KEY); } catch {}
}

function loadPinned(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(PINNED_KEY); } catch { return null; }
}

function savePinned(text: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PINNED_KEY, text); } catch {}
}

function clearPinned(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PINNED_KEY); } catch {}
}

function appendPark(text: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(PARK_KEY);
    const list = raw ? (JSON.parse(raw) as Array<{ text: string; at: string }>) : [];
    list.unshift({ text, at: new Date().toISOString() });
    localStorage.setItem(PARK_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {}
}

interface PlanStep {
  id: string;
  title: string;
  action: "task" | "capture" | "nav" | "reminder" | "toggle" | "note";
  target?: string;
  effort?: "M5" | "M15" | "M30" | "H1";
}

interface PlanResult {
  steps: PlanStep[];
  summary: string;
  reasoning: string;
}

// ── Component ────────────────────────────────────────────────
interface OmniCaptureProps {
  mode: UltronMode;
}

export function OmniCapture({ mode }: OmniCaptureProps) {
  const router = useRouter();
  // Phase B.6a (2026-05-22) · `utils` drives the /plan path (operator
  // domain) · Phase B.6b extends it to the task-domain reads/writes
  // below (`task.create`, `task.createMission`, `task.missions`).
  // scattered-components slice (2026-05-22) · the last two authedFetch
  // calls in this file migrate now — `/dump` → `trpc.brain.captureThought`
  // (the journal-ingest pipeline) and `/decide` → `trpc.operator.logDecision`
  // — so the `authedFetch` import is gone.
  const utils = trpc.useUtils();
  const createTask = trpc.task.create.useMutation();
  const createMission = trpc.task.createMission.useMutation();
  const captureThought = trpc.brain.captureThought.useMutation();
  const logDecision = trpc.operator.logDecision.useMutation();
  const [input, setInput] = useState("");
  /** Manual override — when Nour taps the chip to cycle, we pin the
   *  kind until they either change input or send. Clears automatically
   *  after submit so the next line gets a fresh auto-classification. */
  const [manualKind, setManualKind] = useState<CycleableKind | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showCache, setShowCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  // Derived state: live intent preview as user types.
  const intent = useMemo(() => {
    if (!input.trim()) return null;
    const auto = routeCapture(input);
    // Apply manual override — keep the user's tap-chosen kind but use
    // the latest text from input.
    if (manualKind) {
      return { kind: manualKind, text: auto.text } as CaptureIntent;
    }
    return auto;
  }, [input, manualKind]);

  // Draft auto-save — OmniCapture is a HIGH-loss surface because it's
  // one-tap-away on every mastery page via the TopStrip. If Nour starts
  // typing a brain-dump and navigates away, he'd lose it without this.
  // Restores only when current input is empty so we don't trample mid-type.
  const { clearDraft: clearCaptureDraft, restore: restoreCaptureDraft } =
    useDraftAutosave({ key: "omni-capture", value: input });
  useEffect(() => {
    const saved = restoreCaptureDraft();
    if (saved && input.length === 0) {
      setTimeout(() => setInput(saved), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ultron's omni-capture is a back-channel to Nick. We force standard
  // mode + a low max_tokens via query-shape (the API adapts on "ask"
  // short queries). No override needed — standard handles fast replies
  // via adaptive token cap now.
  const transportBodyRef = useRef<{ modeOverride: "standard" }>({ modeOverride: "standard" });
  const transport = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => new DefaultChatTransport({
      api: "/api/ai/chat",
      body: () => transportBodyRef.current,
    }),
    [],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: "ultron-ask",
    transport,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    const p = loadPinned();
    const hasCache = loadCached();
    setTimeout(() => {
      setPinned(p);
      if (hasCache) setShowCache(true);
      setHydrated(true);
    }, 0);
  }, []);

  // Clear manualKind whenever input becomes empty — a fresh line should
  // get a fresh auto-classification.
  useEffect(() => {
    if (!input.trim() && manualKind !== null) {
      setTimeout(() => setManualKind(null), 0);
    }
  }, [input, manualKind]);

  /** Cycle the intent chip to the next visible kind. Pins the manual
   *  override until the input changes or a send happens. */
  const cycleIntent = useCallback(() => {
    const current = intent?.kind ?? "ask";
    const next = cycleIntentKind(current);
    setManualKind(next);
  }, [intent]);

  // Cache streamed response for 10 min
  useEffect(() => {
    if (isStreaming) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.parts) return;
    const text = last.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
    if (!text) return;
    const userMsg = messages[messages.length - 2];
    if (!userMsg || userMsg.role !== "user" || !userMsg.parts) return;
    const q = userMsg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
    saveCached({ q, text, timestamp: Date.now() });
  }, [isStreaming, messages]);

  const fire = useCallback(
    async (intent: CaptureIntent) => {
      const text = intent.text.trim();
      if (!text) {
        toast("type something first");
        return;
      }
      switch (intent.kind) {
        case "ask": {
          setInput("");
          setShowCache(false);
          clearCached();
          setMessages([]);
          sendMessage({ text });
          break;
        }
        case "task": {
          // Direct task create — bypasses the journal-ingest classifier
          // so a single-line "call Mike" becomes a Task row, not a
          // BrainDump that may or may not extract a task. Much faster
          // round-trip for the most common capture shape.
          setBusy(true);
          try {
            await createTask.mutateAsync({
              title: text.slice(0, 200),
              status: "INBOX",
              source: "omni-capture",
            });
            toast.success("task created");
            setInput("");
          } catch {
            toast.error("task failed");
          } finally {
            setBusy(false);
          }
          break;
        }
        case "dump": {
          setBusy(true);
          try {
            // scattered-components slice · /dump runs the journal-
            // ingest pipeline via trpc.brain.captureThought (the same
            // `ingestJournal` the legacy POST /api/journal/capture
            // called). The procedure returns the JournalResult
            // unwrapped — the legacy `raw?.data?.tasksExtracted` read
            // was a PRE-EXISTING BUG: that field never existed (the
            // pipeline returns `tasksCreated`), so the count branch was
            // dead and the toast always said the bare "captured". The
            // typed procedure forces the real field name.
            const result = await captureThought.mutateAsync({ text });
            const n = result.tasksCreated ?? 0;
            toast.success(
              n > 0
                ? `captured → ${n} task${n === 1 ? "" : "s"} extracted`
                : "captured",
            );
            setInput("");
          } catch {
            toast.error("capture failed");
          } finally {
            setBusy(false);
          }
          break;
        }
        case "decide": {
          setBusy(true);
          try {
            // scattered-components slice · /decide logs a decision via
            // trpc.operator.logDecision (the same `createDecision`
            // service the legacy POST /api/decisions called). The
            // legacy body field `options_considered` is `optionsConsidered`
            // on the typed input · the `/decide` quick-capture sends
            // none, so it's omitted.
            await logDecision.mutateAsync({
              title: text.slice(0, 120),
              stakes: "medium",
              chosen: "pending",
              reasoning: text,
              domain: "general",
            });
            toast.success("decision logged · review later");
            setInput("");
          } catch {
            toast.error("failed to log");
          } finally {
            setBusy(false);
          }
          break;
        }
        case "park": {
          appendPark(text);
          toast("parked · reviewed Sunday");
          setInput("");
          break;
        }
        case "search": {
          // 2026-08-16 · was `/knowledge?q=` — a page that never read a `q`
          // param and, after the monorepo import, rendered zero files. The
          // slash-command has been a no-op search for months. /chat prefills
          // its composer from `?q=` (restored in #1539) and can actually
          // search memory via tools.
          router.push(`/chat?q=${encodeURIComponent(text)}`);
          break;
        }
        case "plan": {
          // Phase B.6a (2026-05-22) · migrated off `authedFetch` onto
          // `trpc.operator.plan`. Modeled as a query (the route does no
          // DB write) · fired imperatively via `utils.operator.plan
          // .fetch`. The procedure returns the PlanResult directly (the
          // legacy `data` envelope is gone) · a too-short intent throws
          // a BAD_REQUEST TRPCError which the existing catch surfaces
          // as the "plan failed" toast, same as the legacy !res.ok path.
          setBusy(true);
          setPlan(null);
          try {
            const result = await utils.operator.plan.fetch({ intent: text });
            setPlan(result);
            setInput("");
          } catch {
            toast.error("plan failed");
          } finally {
            setBusy(false);
          }
          break;
        }
        case "reflect": {
          // Navigate to /journal with an optional seed hash so the composer
          // focuses itself on arrival.
          const seed = text ? `#reflect&seed=${encodeURIComponent(text)}` : "#reflect";
          router.push(`/journal${seed}`);
          setInput("");
          break;
        }
      }
    },
    [router, sendMessage, setMessages, utils, createTask, captureThought, logDecision],
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      // Use the displayed intent (which respects manual override) so
      // what the user sees on the chip is exactly what fires. Clear the
      // override so the next capture gets a fresh auto-classification.
      const i: CaptureIntent = intent
        ? { kind: intent.kind, text: input.trim() } as CaptureIntent
        : routeCapture(input);
      setManualKind(null);
      fire(i);
    },
    [input, intent, fire],
  );

  // ── Render state ─────────────────────────────────────────────
  const liveAssistant = messages.find((m) => m.role === "assistant");
  const liveUser = messages.find((m) => m.role === "user");
  const liveText = liveAssistant?.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
    .map((p) => p.text).join("") ?? "";
  const liveQ = liveUser?.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
    .map((p) => p.text).join("") ?? "";

  const cached = showCache && !liveText ? loadCached() : null;
  const displayText = liveText || cached?.text || "";
  const displayQ = liveQ || cached?.q || "";

  const dismiss = () => {
    setMessages([]);
    setShowCache(false);
    clearCached();
  };

  const pin = () => {
    if (!displayText) return;
    savePinned(displayText);
    setPinned(displayText);
    dismiss();
  };

  const unpin = () => {
    clearPinned();
    setPinned(null);
  };

  const continueInChat = () => {
    if (!displayQ) { router.push("/chat"); return; }
    router.push(`/chat?q=${encodeURIComponent(displayQ)}`);
  };

  // ── Plan step execution ─────────────────────────────────────
  // Each step's `action` maps to a client-side interpretation. No server
  // round-trip except for `task` which creates a Task through /api/tasks.
  const executePlanStep = async (step: PlanStep) => {
    switch (step.action) {
      case "nav": {
        if (step.target) router.push(step.target);
        break;
      }
      case "capture": {
        window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
        break;
      }
      case "task": {
        try {
          // Resolve Inbox mission (or create). Phase B.6b · the
          // missions read + mission/task creates moved to
          // `trpc.task.{missions,createMission,create}` · the procedures
          // return the rows directly, so the legacy `data`-envelope
          // unwrap collapses.
          let inboxId: string | null = null;
          const missions = (await utils.task.missions
            .fetch()
            .catch(() => null)) as Array<{ id: string; title: string }> | null;
          if (Array.isArray(missions)) {
            const inbox = missions.find((m) => m.title === "Inbox");
            inboxId = inbox?.id ?? null;
          }
          if (!inboxId) {
            const created = (await createMission
              .mutateAsync({
                title: "Inbox",
                description: "Ad-hoc tasks",
                status: "ACTIVE",
              })
              .catch(() => null)) as { id?: string } | null;
            inboxId = created?.id ?? null;
          }
          if (!inboxId) { toast.error("no inbox"); return; }
          const title = step.target || step.title;
          try {
            await createTask.mutateAsync({
              title,
              missionId: inboxId,
              nextPhysicalAction: title,
              effort: step.effort || "M15",
              roiScore: 55,
              frictionScore: 30,
              energyRequired: "MEDIUM",
              context: "ANYWHERE",
              finishCondition: "Done",
              autoPriorityExplanation: `from plan: ${plan?.summary ?? "micro-plan"}`,
            });
            toast.success(`task queued: ${title.slice(0, 40)}`);
            notifyDataChanged("tasks", { source: "ultron-plan", detail: "add" });
          } catch {
            toast.error("task create failed");
          }
        } catch {
          toast.error("task create failed");
        }
        break;
      }
      case "reminder":
      case "toggle":
      case "note":
      default: {
        // Treat as a note/reminder — fold into capture for the user to act on
        window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
        break;
      }
    }
  };

  const dismissPlan = () => setPlan(null);

  return (
    <section className="space-y-2">
      {/* Pinned card */}
      {hydrated && pinned && !displayText && (
        <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-3 py-2 flex items-start gap-2">
          <Pin size={10} className="text-[var(--gold)] mt-1 shrink-0" />
          <p className="flex-1 text-[11px] leading-[1.5] text-[var(--text-primary)] whitespace-pre-wrap">
            {pinned}
          </p>
          <button onClick={unpin} className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors" aria-label="Unpin">
            <X size={11} />
          </button>
        </div>
      )}

      {/* Intent chip row — sits ABOVE the input so Nour sees where the
       *  capture is headed before he hits Enter. Tap to cycle through
       *  ask → task → decide → dump → search if the classifier got it
       *  wrong. Hidden entirely when input is empty (nothing to route). */}
      {intent && input.trim() && (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            →
          </span>
          <IntentChipButton
            intent={intent}
            manualActive={manualKind !== null}
            onCycle={cycleIntent}
          />
          <span className="text-[8px] font-mono text-[var(--text-tertiary)]/60 italic">
            tap to override
          </span>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2"
        role="search"
        aria-label="Capture: ask Nick, create task, log decision, brain-dump, or search"
      >
        <div className="flex-1 relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "nick is thinking…" : capturePlaceholderFor(mode)}
            disabled={isStreaming || busy}
            aria-label="Capture input — type naturally, Ultron auto-routes to the right action"
            className="w-full h-10 pl-3 pr-10 rounded-lg bg-[var(--bg-raised)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--gold)]/40 focus:outline-none transition-colors disabled:opacity-60 font-mono"
          />
          <button
            type="submit"
            disabled={isStreaming || busy || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--gold)] hover:text-[var(--gold)]/80 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            {isStreaming || busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <button
          type="button"
          disabled
          title="Voice capture — v2"
          className="w-10 h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] flex items-center justify-center text-[var(--text-tertiary)] opacity-50 cursor-not-allowed"
          aria-label="Voice capture"
        >
          <Mic size={14} />
        </button>
      </form>

      {/* Plan card — appears when user runs /plan (or auto-classified into it) */}
      {plan && (
        <section className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles size={11} className="text-blue-400" />
              <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-blue-400">
                micro-plan
              </span>
              <span className="text-[8px] font-mono text-[var(--text-tertiary)]">
                {plan.steps.length} steps
              </span>
            </div>
            <button
              onClick={dismissPlan}
              className="text-[var(--text-tertiary)] hover:text-red-400"
              aria-label="Dismiss plan"
            >
              <X size={11} />
            </button>
          </div>
          {plan.summary && (
            <p className="text-[11px] text-[var(--text-primary)] italic leading-snug">
              {plan.summary}
            </p>
          )}
          <ol className="space-y-1">
            {plan.steps.map((step, i) => (
              <li
                key={step.id + i}
                className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1.5"
              >
                <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[8px] font-mono tabular-nums rounded-full border border-blue-500/30 text-blue-400">
                  {i + 1}
                </span>
                <p className="flex-1 min-w-0 text-[11px] text-[var(--text-primary)] truncate">
                  {step.title}
                </p>
                {step.effort && (
                  <span className="text-[8px] font-mono text-[var(--text-tertiary)] shrink-0">
                    {step.effort}
                  </span>
                )}
                <span
                  className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] shrink-0"
                  title={step.target || ""}
                >
                  {step.action}
                </span>
                <button
                  onClick={() => executePlanStep(step)}
                  className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20"
                  title="Run this step"
                >
                  {step.action === "nav"
                    ? <ExternalLink size={9} />
                    : step.action === "task"
                      ? <Play size={9} />
                      : <ArrowRight size={9} />}
                  go
                </button>
              </li>
            ))}
          </ol>
          {plan.reasoning && (
            <p className="text-[9px] text-[var(--text-tertiary)] italic leading-snug pt-1 border-t border-[var(--border-default)]">
              why: {plan.reasoning}
            </p>
          )}
        </section>
      )}

      {/* Streaming/cached response */}
      {hydrated && displayText && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 space-y-2",
            liveText
              ? "border-[var(--gold)]/30 bg-[var(--gold)]/5"
              : "border-[var(--border-default)] bg-[var(--bg-raised)]",
          )}
        >
          {displayQ && (
            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
              q: {displayQ.length > 80 ? displayQ.slice(0, 80) + "…" : displayQ}
              {cached && !liveText && (
                <span className="ml-2 text-[var(--gold)]/60">
                  {/* eslint-disable-next-line react-hooks/purity */}
                  · from {Math.floor((Date.now() - cached.timestamp) / 60_000)}m ago
                </span>
              )}
            </p>
          )}
          <div className="text-[12px] leading-[1.55] text-[var(--text-primary)] whitespace-pre-wrap">
            {displayText}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--gold)] animate-pulse" />
            )}
          </div>
          {!isStreaming && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={continueInChat}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-default)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors"
                title="Open in the full chat page"
              >
                <MessageSquare size={10} />
                continue in chat
              </button>
              <button
                onClick={pin}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-default)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors"
              >
                <Pin size={10} />
                pin
              </button>
              <button
                onClick={dismiss}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors ml-auto"
              >
                <X size={10} />
                dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Intent chip meta ─────────────────────────────────────────
const INTENT_META: Record<
  CaptureIntent["kind"],
  {
    label: string;
    icon: typeof MessageSquare;
    color: string;
    bg: string;
    border: string;
    /** One-line description of what pressing Enter will do. */
    action: string;
  }
> = {
  ask:     { label: "Nick",    icon: MessageSquare, color: "text-[var(--gold)]",  bg: "bg-[var(--gold)]/10",   border: "border-[var(--gold)]/30",  action: "stream a Nick reply inline" },
  task:    { label: "Task",    icon: ListChecks,    color: "text-emerald-400",    bg: "bg-emerald-500/10",     border: "border-emerald-500/30",    action: "create an inbox task" },
  decide:  { label: "Decide",  icon: GitBranch,     color: "text-blue-400",       bg: "bg-blue-500/10",        border: "border-blue-500/30",       action: "log a decision for review" },
  dump:    { label: "Dump",    icon: NotebookPen,   color: "text-violet-400",     bg: "bg-violet-500/10",      border: "border-violet-500/30",     action: "brain dump · auto-classifies" },
  park:    { label: "Park",    icon: Inbox,         color: "text-[var(--text-tertiary)]", bg: "bg-slate-500/10",       border: "border-slate-500/30",      action: "park for Sunday review" },
  search:  { label: "Search",  icon: Search,        color: "text-amber-400",      bg: "bg-amber-500/10",       border: "border-amber-500/30",      action: "search the knowledge base" },
  plan:    { label: "Plan",    icon: Sparkles,      color: "text-blue-400",       bg: "bg-blue-500/10",        border: "border-blue-500/30",       action: "AI compiles 3-6 steps" },
  reflect: { label: "Reflect", icon: Eye,           color: "text-emerald-400",    bg: "bg-emerald-500/10",     border: "border-emerald-500/30",    action: "open structured reflection" },
};

// ── Tap-to-cycle intent chip ─────────────────────────────────
function IntentChipButton({
  intent,
  manualActive,
  onCycle,
}: {
  intent: CaptureIntent;
  manualActive: boolean;
  onCycle: () => void;
}) {
  const meta = INTENT_META[intent.kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`${meta.action}${manualActive ? " · manual override" : " · auto-detected (tap to cycle)"}`}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
        "text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.18em]",
        "transition-all active:scale-95 hover:scale-[1.02]",
        meta.color,
        meta.bg,
        meta.border,
        manualActive && "ring-1 ring-offset-0 ring-current/40",
      )}
      aria-label={`Intent: ${meta.label}. ${meta.action}. Tap to cycle.`}
    >
      <Icon size={10} />
      <span>{meta.label}</span>
      {manualActive && (
        <span className="text-[7px] opacity-70 tracking-normal normal-case">·manual</span>
      )}
    </button>
  );
}

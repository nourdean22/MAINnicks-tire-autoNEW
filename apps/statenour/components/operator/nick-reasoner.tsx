"use client";

/**
 * NickReasoner · Phase H (2026-05-18 PM)
 *
 * The Charizard surface. Operator drops a question · the engine runs
 * the appropriate tier (auto-classified or operator-picked) · the
 * reasoning trace unfolds step-by-step · the final answer lands with
 * confidence + cost stamp.
 *
 * Tiers (mirrored from lib/ai/reasoning/types.ts):
 *   quick    · passthrough · standard chat handles it
 *   standard · pretask fanout + draft + critique · ~3-5s · ~$0.005
 *   deep     · multi-agent + fanout + critique + refine · ~8-15s · ~$0.02
 *   thorough · deep-research + multi-agent + critique + refine · ~30-60s · ~$0.10
 *
 * The "AUTO" pill lets the classifier pick · operator overrides for
 * cases where they know they want deeper thinking than the heuristic
 * would assign (or the opposite · save cost on a question that LOOKS
 * deep but really isn't).
 *
 * Aesthetic per docs/aesthetic-principles.md:
 *   · editorial-minimalist · text-[var(--text-primary)] body
 *   · gold tone on the "ask" button + tier pills (selected state)
 *   · trace renders as a left-bordered list · each step has a
 *     tone-dot + label + optional detail expansion
 *   · final answer block · standard prose · italic confidence + cost
 *     footer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";

/** Parse one SSE frame · "event: NAME\ndata: JSON" · returns null on
 *  malformed/empty frames. */
function parseSseFrame(raw: string): { event: string; data: unknown } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let event = "message";
  let dataLine = "";
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

type ReasoningTier = "quick" | "standard" | "deep" | "thorough" | "mega";
type ReasoningStepKind =
  | "classify"
  | "decompose"
  | "plan"
  | "fanout"
  | "agent_call"
  | "tool_call"
  | "critique"
  | "refine"
  | "deliver";

interface ReasoningStep {
  kind: ReasoningStepKind;
  label: string;
  detail?: unknown;
  elapsedMs: number;
  durationMs: number;
}

interface ReasoningResult {
  trace: {
    steps: ReasoningStep[];
    answer: string;
    confidence: number;
    totalMs: number;
    cost: { usd: number; calls: number };
  };
  tier: ReasoningTier;
  classifierReason: string;
}

const KIND_DOT: Record<ReasoningStepKind, string> = {
  classify: "bg-[var(--text-tertiary)]",
  decompose: "bg-sky-400",
  plan: "bg-sky-400",
  fanout: "bg-violet-400",
  agent_call: "bg-violet-400",
  tool_call: "bg-emerald-400",
  critique: "bg-amber-400",
  refine: "bg-amber-400",
  deliver: "bg-[var(--gold)]",
};

const TIER_OPTIONS: Array<{ value: ReasoningTier | "auto"; label: string; hint: string }> = [
  { value: "auto", label: "auto", hint: "classifier picks" },
  { value: "standard", label: "standard", hint: "~5s · ~$0.005" },
  { value: "deep", label: "deep", hint: "~15s · ~$0.02" },
  { value: "thorough", label: "thorough", hint: "~45s · ~$0.10" },
  { value: "mega", label: "mega", hint: "~90s · ~$0.20 · everything" },
];

export function NickReasoner({
  initialQuestion,
  brainContext,
  autoRun,
  className,
}: {
  initialQuestion?: string;
  brainContext?: string;
  /** When true + initialQuestion present, fires the engine on mount.
   *  Used by deep-link entry from /reason?q=... · operator lands and
   *  the engine is already running. */
  autoRun?: boolean;
  className?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [tier, setTier] = useState<ReasoningTier | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const [liveSteps, setLiveSteps] = useState<ReasoningStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Phase H.2 · live-trace run · POSTs to /api/nick/reason/stream and
  // consumes Server-Sent Events. Each `step` event appends to liveSteps
  // so the operator sees step-by-step progress as Nick reasons (not
  // token-by-token — each step is an atomic LLM call). `result` event
  // lands the final ReasoningResult.
  //
  // H.3.3 + H.3.4 · handles 402 budget/confirm responses · shows a
  // confirm dialog for mega tier and surfaces the budget cap when
  // hit instead of bubbling up as a generic error.
  const run = useCallback(async (confirmExpensive = false) => {
    const q = question.trim();
    if (!q || busy) return;
    // H.3.4 · client-side mega confirm. Before the network call, if
    // operator picked mega and hasn't confirmed yet, ask first.
    if (tier === "mega" && !confirmExpensive) {
      const ok = window.confirm(
        "Mega tier runs deep-research + multi-agent + fanout + ghost predictions + wisdom in parallel.\n\nEstimated cost: ~$0.20\nEstimated time: 60-120s\n\nContinue?",
      );
      if (!ok) return;
      confirmExpensive = true;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setLiveSteps([]);
    setExpandedStep(null);
    try {
      const res = await authedFetch("/api/nick/reason/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          brainContext,
          tier: tier === "auto" ? undefined : tier,
          confirmExpensive,
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          spentTodayUsd?: number;
          capUsd?: number;
        };
        // H.3.4 · server-side mega confirm (auto-classifier triggered mega)
        if (res.status === 402 && body.error === "confirm_expensive") {
          const ok = window.confirm(
            `${body.message}\n\nRetry with confirmation?`,
          );
          if (ok) {
            setBusy(false);
            void run(true);
            return;
          }
          throw new Error("Mega run cancelled.");
        }
        // H.3.3 · daily budget exhausted
        if (res.status === 402 && body.error === "budget_exceeded") {
          throw new Error(
            `Daily reasoning budget hit · $${(body.spentTodayUsd ?? 0).toFixed(3)} / $${(body.capUsd ?? 1).toFixed(2)} · resets midnight ET.`,
          );
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are delimited by \n\n
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSseFrame(raw);
          if (!parsed) continue;
          if (parsed.event === "step") {
            const step = parsed.data as ReasoningStep;
            setLiveSteps((prev) => [...prev, step]);
          } else if (parsed.event === "result") {
            setResult(parsed.data as ReasoningResult);
          } else if (parsed.event === "error") {
            const errPayload = parsed.data as { message?: string };
            throw new Error(errPayload.message ?? "stream error");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [question, brainContext, tier, busy]);

  // Phase H.2 · auto-run on mount when both flags + question are present.
  // Ref-tracked so we don't fire twice in strict-mode dev.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRun && initialQuestion && !autoRanRef.current) {
      autoRanRef.current = true;
      void run();
    }
    // intentional · we want this to fire only when autoRun lands true once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, initialQuestion]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void run();
      }
    },
    [run],
  );

  const totalSeconds = useMemo(
    () => (result ? (result.trace.totalMs / 1000).toFixed(1) : null),
    [result],
  );

  return (
    <section
      aria-label="nick reasoner"
      className={[
        "mx-auto max-w-[68ch] px-4 py-6 space-y-5",
        className ?? "",
      ].join(" ")}
    >
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            nick · reasoning engine
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/reason/telemetry"
              className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition"
            >
              telemetry →
            </a>
            <a
              href="/reason/history"
              className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition"
            >
              history →
            </a>
          </div>
        </div>
        <h1 className="text-2xl font-medium text-[var(--text-primary)]">
          Watch Nick think.
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Ask a hard question. The engine picks a tier, runs a step-by-step
          reasoning loop, and emits each step to the live trace as it
          completes. Each step is an atomic LLM call · expect 2-10s
          between trace updates. Cmd/Ctrl+Enter to send.
        </p>
      </header>

      {/* Input + tier picker + run button */}
      <div className="space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 4000))}
          onKeyDown={onKeyDown}
          placeholder="What's the right move on the Q2 financial goal · given my current pace and the trailing axis?"
          rows={3}
          className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-white/30 focus:outline-none focus:border-[var(--gold)]/60 resize-y min-h-[88px]"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TIER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTier(opt.value)}
                disabled={busy}
                title={opt.hint}
                className={[
                  "text-[10px] font-mono uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border transition",
                  tier === opt.value
                    ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                    : "border-white/15 text-[var(--text-secondary)] hover:border-white/30 hover:text-[var(--text-primary)]",
                  busy ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || question.trim().length === 0}
            className="text-xs font-mono uppercase tracking-[0.14em] px-4 min-h-[40px] rounded bg-[var(--gold)] text-black font-medium hover:bg-[var(--gold)]/90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "thinking..." : "ask nick"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : null}

      {/* Trace · steps unfolding (live during streaming, final after result lands) */}
      {liveSteps.length > 0 || result ? (
        <div className="space-y-5">
          {result ? (
            <div className="space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                tier · {result.tier} · {result.classifierReason}
              </p>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
                {totalSeconds}s · {result.trace.cost.calls} call
                {result.trace.cost.calls === 1 ? "" : "s"} ·{" "}
                ${result.trace.cost.usd.toFixed(3)} est
              </p>
            </div>
          ) : busy ? (
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] animate-pulse">
              live trace · {liveSteps.length} step{liveSteps.length === 1 ? "" : "s"} done · current step in flight...
            </p>
          ) : null}

          <ol className="space-y-2 border-l border-white/10 pl-4">
            {(result ? result.trace.steps : liveSteps).map((step, i) => (
              <li key={i} className="space-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStep(expandedStep === i ? null : i)
                  }
                  className="w-full text-left flex items-start gap-2.5 text-sm leading-snug hover:bg-white/[0.03] rounded-sm px-1"
                >
                  <span
                    aria-hidden
                    className={[
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      KIND_DOT[step.kind] ?? "bg-white/30",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mr-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                      {step.kind}
                    </span>
                    <span className="text-[var(--text-primary)]">
                      {step.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                    {step.durationMs >= 1000
                      ? `${(step.durationMs / 1000).toFixed(1)}s`
                      : `${step.durationMs}ms`}
                  </span>
                </button>
                {expandedStep === i && step.detail !== undefined && step.detail !== null ? (
                  <pre className="ml-6 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono bg-white/[0.02] border border-white/5 rounded-sm p-2.5 max-h-64 overflow-auto">
                    {typeof step.detail === "string"
                      ? step.detail
                      : JSON.stringify(step.detail, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>

          {/* Final answer block · only after result lands */}
          {result ? (
            <div className="rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] p-4 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
                nick · answer
              </p>
              <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {result.trace.answer}
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] italic">
                  confidence {(result.trace.confidence * 100).toFixed(0)}%
                </p>
                {/* H.4.5 · continue-in-chat handoff. Routes to /chat
                    with the question + answer prefixed as a system
                    seed so the chat picks up where the reasoning
                    left off · operator can ask follow-ups, drill
                    in, or pivot without losing the thread. */}
                <a
                  href={`/chat?seed=${encodeURIComponent(
                    `Earlier in /reason I asked: ${question.trim().slice(0, 240)}\n\nNick (${result.tier} tier) answered:\n${result.trace.answer.slice(0, 800)}\n\nLet's continue.`,
                  )}`}
                  className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--gold)] transition"
                  title="open in /chat with question + answer pre-seeded"
                >
                  continue in chat →
                </a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

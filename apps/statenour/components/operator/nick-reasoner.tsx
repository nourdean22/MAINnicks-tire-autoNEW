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

import { useCallback, useMemo, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";

type ReasoningTier = "quick" | "standard" | "deep" | "thorough";
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
];

export function NickReasoner({
  initialQuestion,
  brainContext,
  className,
}: {
  initialQuestion?: string;
  brainContext?: string;
  className?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [tier, setTier] = useState<ReasoningTier | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const run = useCallback(async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setExpandedStep(null);
    try {
      const res = await authedFetch("/api/nick/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          brainContext,
          tier: tier === "auto" ? undefined : tier,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ReasoningResult;
      setResult(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [question, brainContext, tier, busy]);

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
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          nick · reasoning engine
        </p>
        <h1 className="text-2xl font-medium text-[var(--text-primary)]">
          Watch Nick think.
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Ask a hard question. The engine picks a tier, runs a step-by-step
          reasoning loop, and shows you every move. Cmd/Ctrl+Enter to send.
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

      {/* Trace · steps unfolding */}
      {result ? (
        <div className="space-y-5">
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

          <ol className="space-y-2 border-l border-white/10 pl-4">
            {result.trace.steps.map((step, i) => (
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

          {/* Final answer block */}
          <div className="rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] p-4 space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
              nick · answer
            </p>
            <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {result.trace.answer}
            </div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] italic">
              confidence {(result.trace.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

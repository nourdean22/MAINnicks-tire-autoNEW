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
import { useRouter } from "next/navigation";

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

type ReasoningTier = "quick" | "standard" | "smart" | "deep" | "thorough" | "mega";
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
  { value: "smart", label: "smart", hint: "~10s · ~$0.015 · router picks sources" },
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
  const router = useRouter();
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
  //
  // H.7.6 · self-recursive retry pattern caught by react-hooks/
  // immutability lint pre-fix. Now stashed in a ref so the inner
  // 402-retry path goes through runRef.current() instead of run()
  // directly · no self-reference in the closure.
  const runRef = useRef<((confirmExpensive?: boolean) => Promise<void>) | null>(null);
  const run = useCallback(async (confirmExpensive = false) => {
    const q = question.trim();
    if (!q || busy) return;
    // H.3.4 + N.4 · client-side mega confirm. Pre-N.4 used window.confirm
    // which didn't trap focus + blocked the UI thread. Now uses an
    // accessible Dialog with focus trap + ARIA conventions.
    if (tier === "mega" && !confirmExpensive) {
      const { megaConfirm } = await import("./mega-confirm-dialog");
      const ok = await megaConfirm(
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
      // scattered-components REST→tRPC slice (2026-05-22) · this is a
      // Server-Sent-Events stream — per the tRPC migration plan SSE
      // endpoints stay REST (tRPC v11 has no first-class SSE transport;
      // see lib/trpc/routers/nick.ts). The only change is dropping
      // `authedFetch` for a plain `fetch`: `credentials: "include"`
      // carries the NextAuth cookie, and this handler already does its
      // own 401/402 branching below, so `authedFetch`'s sign-in bounce
      // is neither needed nor wanted here.
      const res = await fetch("/api/nick/reason/stream", {
        method: "POST",
        credentials: "include",
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
          const { megaConfirm } = await import("./mega-confirm-dialog");
          const ok = await megaConfirm(
            `${body.message}\n\nRetry with confirmation?`,
          );
          if (ok) {
            setBusy(false);
            // H.7.6 · use the ref · avoids self-reference lint warning
            void runRef.current?.(true);
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
      // L.4 · async iterator (ES2018+) replaces while(true)+reader.read()
      // Modern body.pipeThrough(TextDecoderStream) + for-await · auto-
      // cleanup on early-exit · no manual reader.releaseLock() to forget.
      const decoderStream = new TextDecoderStream();
      const textStream = res.body.pipeThrough(decoderStream);
      let buffer = "";
      for await (const chunk of textStream as unknown as AsyncIterable<string>) {
        buffer += chunk;
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

  // H.7.6 · keep the ref in sync with the latest `run` closure
  useEffect(() => {
    runRef.current = run;
  }, [run]);

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

          {/* M.3 · plan-first · CrewAI-inspired · surface the plan step
              detail as a top-level section so the operator sees Nick's
              plan before scrolling through the trace. Pulls from result
              when complete · liveSteps during streaming. */}
          {(() => {
            const stepsForPlan = result ? result.trace.steps : liveSteps;
            const planStep = stepsForPlan.find((s) => s.kind === "plan");
            const planText = planStep?.detail;
            if (typeof planText !== "string" || planText.length === 0) {
              return null;
            }
            return (
              <div className="rounded-md border border-sky-400/20 bg-sky-400/[0.04] p-3 space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-sky-300/90">
                  nick&apos;s plan
                </p>
                <pre className="text-xs text-[var(--text-primary)] whitespace-pre-wrap font-sans leading-relaxed">
                  {planText}
                </pre>
              </div>
            );
          })()}

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
                {/* H.4.5 + H.6.3 · continue-in-chat handoff. Routes to
                    /chat with the question + answer prefixed as a seed
                    so the chat picks up where the reasoning left off.
                    H.6.3 · seed payload goes via sessionStorage instead
                    of URL query string · keeps the operator's reasoning
                    out of server access logs + browser history. The
                    chat page reads + clears the sessionStorage entry
                    on mount. ?h=1 flag tells chat to look. */}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const payload = `Earlier in /reason I asked: ${question.trim().slice(0, 240)}\n\nNick (${result.tier} tier) answered:\n${result.trace.answer.slice(0, 800)}\n\nLet's continue.`;
                      sessionStorage.setItem("chat:pending-seed", payload);
                      // lint-baseline 2026-08-13 · soft nav — sessionStorage
                      // survives client-side navigation identically.
                      router.push("/chat?h=1");
                    } catch {
                      // sessionStorage blocked (private mode, etc.) ·
                      // fall back to the old query-string path
                      const url = `/chat?seed=${encodeURIComponent(
                        `Earlier in /reason: ${question.trim().slice(0, 80)}`,
                      )}`;
                      router.push(url);
                    }
                  }}
                  className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--gold)] transition"
                  title="open in /chat with question + answer pre-seeded (kept out of URL)"
                >
                  continue in chat →
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

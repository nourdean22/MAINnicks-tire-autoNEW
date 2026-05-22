"use client";

/**
 * /system/judge-eval · Phase V (2026-05-18 PM)
 *
 * Parity dashboard for the AGENT_V1 → AGENT_V2 migration. Closes the
 * Phase 0 prerequisite the agent-v1-to-v2 doc has been blocking on:
 *
 *   > Phase 1 canary requirement · daily judge-eval comparator runs
 *   > · alerts on regression. 7-day observation window before promotion.
 *
 * Shows:
 *   · Verdict chip (safe / watch / regressing / insufficient-data)
 *   · 7d + 24h win-rate buckets (V2 wins · V1 wins · ties · pct)
 *   · Per-intent class breakdown (catches "V2 regresses on summarization
 *     but wins on Q&A" patterns)
 *   · 10 most recent comparison runs with prompt snippet + per-dim
 *     judgment + summary
 *
 * Run new comparisons via `POST /api/judge-eval/run` (Phase V.6) until
 * the daily cron is wired.
 */

import { useState } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
// Phase straggler-pages (2026-05-22) · the POST /api/judge-eval/run
// call is migrated off authedFetch onto `system.judgeEvalRun` · the
// summary + samples reads already routed through tRPC. Zero
// use-authed-fetch imports remain. Legacy REST route stays mounted.
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Copy,
  Loader2,
  Scale,
  Eye,
  Sparkles,
} from "lucide-react";

type Winner = "v1" | "v2" | "tie";
type Verdict = "safe" | "watch" | "regressing" | "insufficient-data";

const VERDICT_TONE: Record<Verdict, string> = {
  safe: "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300",
  watch: "border-amber-500/30 bg-amber-500/[0.05] text-amber-300",
  regressing: "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
  "insufficient-data":
    "border-[var(--border-default)] bg-[var(--bg-base)]/40 text-[var(--text-secondary)]",
};

// Phase FF · explicit per-verdict icon-circle background colors.
// Pre-FF the verdict chip used `bg-current/10` which depends on
// currentColor + alpha-modifier support in Tailwind v4 · not verified
// on this stack + no precedent in the codebase. Explicit per-verdict
// classes are reliable regardless of Tailwind version + match the
// per-verdict palette established in VERDICT_TONE above.
const VERDICT_ICON_BG: Record<Verdict, string> = {
  safe: "bg-emerald-500/10",
  watch: "bg-amber-500/10",
  regressing: "bg-rose-500/10",
  "insufficient-data": "bg-[var(--bg-base)]/60",
};

const WINNER_TONE: Record<Winner, string> = {
  v2: "bg-emerald-500/15 text-emerald-300",
  v1: "bg-rose-500/15 text-rose-300",
  tie: "bg-[var(--bg-void)] text-[var(--text-tertiary)]",
};

export default function JudgeEvalPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, error, refetch } =
    trpc.system.judgeEvalSummary.useQuery(undefined, {
      refetchInterval: 60_000,
      staleTime: 30_000,
    });
  const samplesQ = trpc.system.judgeEvalSamples.useQuery(
    { take: 10, sinceDays: 7 },
    { staleTime: 60_000 },
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Link
          href="/system"
          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          aria-label="back to system"
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Judge-eval · V1 vs V2
          </h1>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            LLM-as-judge comparator · 4 dimensions · per-intent breakdown
          </p>
        </div>
      </header>

      {isLoading && !data && (
        <GlassCard>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
            <Loader2 size={12} className="animate-spin" />
            reading comparison runs…
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-rose-300 break-words">
              judge-eval summary fetch failed · {error.message}
            </p>
            <button
              onClick={() => void refetch()}
              className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
            >
              retry
            </button>
          </div>
        </GlassCard>
      )}

      {data && (
        <>
          {/* Verdict chip · the headline · Phase AA.4 polish · larger
              icon sized to label baseline · vertical centering balanced
              · headline upgraded to a 2-line stack with tabular-num
              percentage hint when verdict has signal. */}
          <GlassCard className={cn("border", VERDICT_TONE[data.verdict as Verdict])}>
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "shrink-0 flex h-10 w-10 items-center justify-center rounded-full",
                  VERDICT_ICON_BG[data.verdict as Verdict],
                )}
              >
                {data.verdict === "safe" ? (
                  <CheckCircle2 size={22} className="text-emerald-400" />
                ) : data.verdict === "regressing" ? (
                  <AlertTriangle size={22} className="text-rose-400" />
                ) : data.verdict === "watch" ? (
                  <Eye size={22} className="text-amber-400" />
                ) : (
                  <Scale size={22} className="text-[var(--text-tertiary)]" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-mono uppercase tracking-[0.18em] opacity-60 mb-1">
                  Phase 1 canary verdict · 7d window
                </p>
                <div className="flex items-baseline gap-2 mb-1">
                  <p className="text-base font-bold uppercase tracking-wider leading-none">
                    {data.verdict.replace("-", " ")}
                  </p>
                  {data.last7d.v2WinPct >= 0 && (
                    <span className="text-[10px] font-mono tabular-nums opacity-70">
                      · v2 {data.last7d.v2WinPct}% / {data.last7d.total} runs
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  {data.verdictReason}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Rolling buckets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BucketCard
              label="last 7d"
              total={data.last7d.total}
              v2Wins={data.last7d.v2Wins}
              v1Wins={data.last7d.v1Wins}
              ties={data.last7d.ties}
              v2WinPct={data.last7d.v2WinPct}
            />
            <BucketCard
              label="last 24h"
              total={data.last24h.total}
              v2Wins={data.last24h.v2Wins}
              v1Wins={data.last24h.v1Wins}
              ties={data.last24h.ties}
              v2WinPct={data.last24h.v2WinPct}
            />
          </div>

          {/* Per-intent breakdown */}
          {data.byIntent.length > 0 && (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Activity size={13} className="text-[var(--gold)]" />
                <span className="section-label">
                  By intent class · 7d
                </span>
              </div>
              <div className="space-y-1.5">
                {data.byIntent.map((b) => (
                  <IntentRow
                    key={b.intentClass}
                    intentClass={b.intentClass}
                    total={b.total}
                    v2Wins={b.v2Wins}
                    v1Wins={b.v1Wins}
                    v2WinPct={b.v2WinPct}
                  />
                ))}
              </div>
            </GlassCard>
          )}

          {/* Recent runs */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Scale size={13} className="text-[var(--gold)]" />
              <span className="section-label">
                Recent runs · {data.recent.length}
              </span>
            </div>
            {data.recent.length === 0 ? (
              <p className="text-[11px] text-[var(--text-tertiary)] italic">
                No comparison runs yet · trigger one via{" "}
                <code className="text-[var(--gold)]">POST /api/judge-eval/run</code>
              </p>
            ) : (
              <div className="space-y-2">
                {data.recent.map((r) => (
                  <RecentRun key={r.id} r={r} />
                ))}
              </div>
            )}
          </GlassCard>

          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] text-center">
            generated · {new Date(data.generatedAt).toLocaleTimeString()} ·
            mean v2Score {data.meanV2Score >= 0 ? data.meanV2Score.toFixed(1) : "—"}
          </p>
        </>
      )}

      {/* Phase W · Candidate prompts · operator workflow: copy
          prompt + v2 reply → manually generate v1 reply → paste
          into the ad-hoc form below. The sampler filters out
          already-compared rows so each card is fresh work. */}
      <CandidatePromptsSection
        samples={samplesQ.data ?? []}
        loading={samplesQ.isLoading}
      />

      {/* Phase W · Ad-hoc compare form · paste in prompt + v1 + v2
          and POST through /api/judge-eval/run. Same shape as the
          curl path · just bound to a tiny form for operator UX. */}
      <AdHocCompareForm
        onJudged={() => {
          void utils.system.judgeEvalSummary.invalidate();
          void utils.system.judgeEvalSamples.invalidate();
        }}
      />
    </div>
  );
}

interface SampleData {
  messageId: string;
  conversationId: string;
  prompt: string;
  v2Reply: string;
  createdAt: string;
  intentClass: string | null;
}

function CandidatePromptsSection({
  samples,
  loading,
}: {
  samples: SampleData[];
  loading: boolean;
}) {
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("clipboard write failed");
    }
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={13} className="text-[var(--gold)]" />
        <span className="section-label">
          Candidate prompts · {samples.length} fresh
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto">
          7d · uncompared only
        </span>
      </div>

      {loading && samples.length === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-3 justify-center">
          <Loader2 size={12} className="animate-spin" />
          scanning recent V2 replies…
        </div>
      )}

      {/* Phase AA.3 · composed empty state · 3 sketched placeholder
          rows + actionable explanation. Replaces the prior single-
          line italic "no candidates" which the redesign skill flagged
          as a missed getting-started opportunity. */}
      {!loading && samples.length === 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            No fresh candidates in the last 7d · either{" "}
            <code className="text-[var(--gold)]">/chat</code> is silent
            or every reply already has a comparison run on file.
          </p>
          {/* Phase FF · aria-hidden on the placeholder container ·
              pre-FF screen readers (VoiceOver, NVDA) would read the 3
              sketched prompts aloud as if they were real candidates ·
              the visual dimming + pointer-events-none didn't carry
              over to assistive tech. */}
          <div
            className="space-y-1.5 opacity-40 pointer-events-none select-none"
            aria-hidden="true"
          >
            {[
              { intent: "decide", prompt: "should we swap suppliers for the Q3 buy" },
              { intent: "compose", prompt: "draft a follow-up text for declined work" },
              { intent: "plan", prompt: "plan the labor rate change rollout" },
            ].map((s, i) => (
              <div
                key={i}
                className="px-2 py-2 rounded border border-dashed border-[var(--border-default)] bg-[var(--bg-base)]/20"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
                    {s.intent}
                  </span>
                  <span className="text-[10px] text-[var(--text-secondary)] truncate flex-1">
                    {s.prompt}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
            ↳ Each new <code className="text-[var(--gold)]">/chat</code> reply
            becomes a candidate the next time the daily{" "}
            <code className="text-[var(--gold)]">judge-eval-shadow</code> cron
            fires (or sooner if you hit refresh).
          </p>
        </div>
      )}

      {samples.length > 0 && (
        <div className="space-y-1.5">
          {samples.map((s) => (
            <div
              key={s.messageId}
              className="px-2 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40"
            >
              <div className="flex items-center gap-2 mb-1">
                {s.intentClass && (
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
                    {s.intentClass}
                  </span>
                )}
                <span className="text-[10px] text-[var(--text-secondary)] truncate flex-1">
                  {s.prompt.slice(0, 120)}
                </span>
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
                  {new Date(s.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Phase AA.2 · active:scale-[0.97] micro-press + transition
                    duration 100 · makes the copy actions feel clickable
                    rather than visually inert. */}
                <button
                  onClick={() => copyToClipboard(s.prompt, "prompt")}
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-void)]/60 active:scale-[0.97] transition-transform duration-100 inline-flex items-center gap-1"
                >
                  <Copy size={9} /> prompt
                </button>
                <button
                  onClick={() => copyToClipboard(s.v2Reply, "v2 reply")}
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 active:scale-[0.97] transition-transform duration-100 inline-flex items-center gap-1"
                >
                  <Copy size={9} /> v2 reply
                </button>
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto truncate">
                  {s.messageId.slice(0, 12)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

/**
 * Phase AA.1 · field-spec metadata · drives the FieldLabel renderer
 * below so each input shows label + required marker + live char count
 * on a single rhythmically-aligned row. Removes the prior pattern
 * where label color was the only signal (rose for v1, emerald for v2)
 * and required-ness was implicit from submit-time toast-only feedback.
 */
const FIELD_MAX = {
  prompt: 4000,
  v1Reply: 8000,
  v2Reply: 8000,
  intentClass: 80,
  sourceMessageId: 64,
} as const;

function FieldLabel({
  label,
  required,
  charCount,
  charMax,
  tone,
}: {
  label: string;
  required?: boolean;
  charCount: number;
  charMax: number;
  tone?: "rose" | "emerald" | "tertiary";
}) {
  const labelColor =
    tone === "rose"
      ? "text-rose-300"
      : tone === "emerald"
        ? "text-emerald-300"
        : "text-[var(--text-tertiary)]";
  const overage = charCount > charMax * 0.9;
  return (
    <div className="flex items-baseline justify-between mb-0.5">
      <span
        className={cn(
          "text-[9px] font-mono uppercase tracking-[0.14em]",
          labelColor,
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--gold)]" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </span>
      <span
        className={cn(
          "text-[9px] font-mono tabular-nums",
          overage ? "text-amber-300" : "text-[var(--text-tertiary)]",
        )}
      >
        {charCount}/{charMax}
      </span>
    </div>
  );
}

function AdHocCompareForm({ onJudged }: { onJudged: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [v1Reply, setV1Reply] = useState("");
  const [v2Reply, setV2Reply] = useState("");
  const [intentClass, setIntentClass] = useState("");
  const [sourceMessageId, setSourceMessageId] = useState("");

  // Phase straggler-pages · the judge-eval run is a tRPC mutation now ·
  // `isPending` replaces the page-local `submitting` flag.
  const runMutation = trpc.system.judgeEvalRun.useMutation();
  const submitting = runMutation.isPending;

  const promptOk = prompt.trim().length > 0;
  const v1Ok = v1Reply.trim().length > 0;
  const v2Ok = v2Reply.trim().length > 0;
  const allRequiredOk = promptOk && v1Ok && v2Ok;
  const canSubmit = allRequiredOk && !submitting;
  const missingLabel = !promptOk
    ? "prompt"
    : !v1Ok
      ? "v1 reply"
      : !v2Ok
        ? "v2 reply"
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRequiredOk) {
      toast.error(`Required field missing: ${missingLabel}`);
      return;
    }
    try {
      const result = await runMutation.mutateAsync({
        prompt,
        v1Reply,
        v2Reply,
        intentClass: intentClass || undefined,
        sourceMessageId: sourceMessageId || undefined,
      });
      const winner = result.judgment.winner;
      const v2Score = result.judgment.v2Score;
      toast.success(`Judged · ${winner} · v2 ${v2Score}`);
      setPrompt("");
      setV1Reply("");
      setV2Reply("");
      setIntentClass("");
      setSourceMessageId("");
      onJudged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        <Scale size={13} className="text-[var(--gold)]" />
        <span className="section-label">Compare new pair</span>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <label className="block">
          <FieldLabel
            label="prompt"
            required
            charCount={prompt.length}
            charMax={FIELD_MAX.prompt}
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-2 py-1.5 text-[11px] text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--gold)]/60 focus:ring-1 focus:ring-[var(--gold)]/30"
            placeholder="What's the concrete answer to..."
            maxLength={FIELD_MAX.prompt}
            aria-required="true"
            aria-invalid={!promptOk}
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <FieldLabel
              label="v1 reply"
              required
              tone="rose"
              charCount={v1Reply.length}
              charMax={FIELD_MAX.v1Reply}
            />
            <textarea
              value={v1Reply}
              onChange={(e) => setV1Reply(e.target.value)}
              rows={5}
              className="w-full rounded border border-rose-500/30 bg-[var(--bg-base)]/40 px-2 py-1.5 text-[11px] text-[var(--text-primary)] font-mono focus:outline-none focus:border-rose-400/70 focus:ring-1 focus:ring-rose-400/30"
              placeholder="Legacy V1 reply text"
              maxLength={FIELD_MAX.v1Reply}
              aria-required="true"
              aria-invalid={!v1Ok}
            />
          </label>
          <label className="block">
            <FieldLabel
              label="v2 reply"
              required
              tone="emerald"
              charCount={v2Reply.length}
              charMax={FIELD_MAX.v2Reply}
            />
            <textarea
              value={v2Reply}
              onChange={(e) => setV2Reply(e.target.value)}
              rows={5}
              className="w-full rounded border border-emerald-500/30 bg-[var(--bg-base)]/40 px-2 py-1.5 text-[11px] text-[var(--text-primary)] font-mono focus:outline-none focus:border-emerald-400/70 focus:ring-1 focus:ring-emerald-400/30"
              placeholder="V2 (Mastra agent) reply text"
              maxLength={FIELD_MAX.v2Reply}
              aria-required="true"
              aria-invalid={!v2Ok}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <FieldLabel
              label="intent class (optional)"
              charCount={intentClass.length}
              charMax={FIELD_MAX.intentClass}
            />
            <input
              type="text"
              value={intentClass}
              onChange={(e) => setIntentClass(e.target.value)}
              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-2 py-1 text-[11px] text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--gold)]/60 focus:ring-1 focus:ring-[var(--gold)]/30"
              placeholder="question · plan · compose · …"
              maxLength={FIELD_MAX.intentClass}
            />
          </label>
          <label className="block">
            <FieldLabel
              label="source messageId (optional)"
              charCount={sourceMessageId.length}
              charMax={FIELD_MAX.sourceMessageId}
            />
            <input
              type="text"
              value={sourceMessageId}
              onChange={(e) => setSourceMessageId(e.target.value)}
              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/60 focus:ring-1 focus:ring-[var(--gold)]/30"
              placeholder="ChatMessage.id from candidate"
              maxLength={FIELD_MAX.sourceMessageId}
            />
          </label>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-transform duration-100",
              canSubmit
                ? "border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 active:scale-[0.97]"
                : "border-[var(--border-default)] text-[var(--text-tertiary)] cursor-not-allowed",
            )}
            title={
              submitting
                ? "judging…"
                : missingLabel
                  ? `Required field missing: ${missingLabel}`
                  : "judge + persist"
            }
          >
            {submitting ? "judging…" : "judge + persist"}
          </button>
          {!submitting && missingLabel && (
            <span className="text-[10px] font-mono text-amber-300/80">
              ↳ fill {missingLabel} to enable
            </span>
          )}
        </div>
      </form>
    </GlassCard>
  );
}

interface BucketProps {
  label: string;
  total: number;
  v2Wins: number;
  v1Wins: number;
  ties: number;
  v2WinPct: number;
}

function BucketCard({ label, total, v2Wins, v1Wins, ties, v2WinPct }: BucketProps) {
  return (
    <GlassCard>
      <div className="flex items-baseline justify-between mb-2">
        <span className="section-label">{label}</span>
        <span
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider tabular-nums",
            v2WinPct >= 50
              ? "text-emerald-300"
              : v2WinPct >= 40
                ? "text-amber-300"
                : v2WinPct >= 0
                  ? "text-rose-300"
                  : "text-[var(--text-tertiary)]",
          )}
        >
          {v2WinPct >= 0 ? `v2 ${v2WinPct}%` : "no runs"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <Cell label="total" value={total} tone="tertiary" />
        <Cell label="v2 wins" value={v2Wins} tone="emerald" />
        <Cell label="v1 wins" value={v1Wins} tone="rose" />
        <Cell label="ties" value={ties} tone="tertiary" />
      </div>
    </GlassCard>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "tertiary";
}) {
  const colorMap = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    tertiary: "text-[var(--text-secondary)]",
  };
  return (
    <div className="rounded bg-[var(--bg-base)]/40 border border-[var(--border-default)] px-1.5 py-1.5 text-center">
      <div className={cn("text-base font-bold tabular-nums", colorMap[tone])}>
        <AnimatedCounter value={value} />
      </div>
      <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mt-0.5">
        {label}
      </p>
    </div>
  );
}

function IntentRow({
  intentClass,
  total,
  v2Wins,
  v1Wins,
  v2WinPct,
}: {
  intentClass: string;
  total: number;
  v2Wins: number;
  v1Wins: number;
  v2WinPct: number;
}) {
  return (
    <div className="px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-mono text-[var(--text-secondary)] flex-1 min-w-0 truncate">
          {intentClass}
        </span>
        <span className="font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
          {v1Wins}v1 · {v2Wins}v2
        </span>
        <span
          className={cn(
            "font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded shrink-0",
            v2WinPct >= 50
              ? "bg-emerald-500/15 text-emerald-300"
              : v2WinPct >= 40
                ? "bg-amber-500/15 text-amber-300"
                : "bg-rose-500/15 text-rose-300",
          )}
        >
          {v2WinPct}%
        </span>
      </div>
      {/* Stacked bar · v2 wins (emerald) + ties (gray) + v1 wins (rose) */}
      <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-void)] overflow-hidden flex">
        <div
          className="h-full bg-emerald-400"
          style={{ width: `${(v2Wins / total) * 100}%` }}
        />
        <div
          className="h-full bg-rose-400"
          style={{ width: `${(v1Wins / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

interface RecentRunData {
  id: string;
  prompt: string;
  v1Reply: string;
  v2Reply: string;
  intentClass: string | null;
  createdAt: string;
  judgment: {
    winner: Winner;
    v2Score: number;
    summary: string;
    dimensions: Array<{ dimension: string; winner: Winner; reason: string }>;
    parsed: boolean;
  };
}

function RecentRun({ r }: { r: RecentRunData }) {
  return (
    // Phase AA.5 · `group` enables the chevron to react to the
    // `[&[open]]` selector on the parent <details> · the default
    // browser triangle is hidden via `[&::-webkit-details-marker]:hidden`
    // + `list-none` so the Lucide ChevronDown can take its place.
    <details className="group rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40 overflow-hidden [&[open]>summary>.chevron]:rotate-180 transition-colors hover:border-[var(--border-hover)]">
      <summary className="px-2.5 py-2 cursor-pointer hover:bg-[var(--bg-void)]/40 select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded",
              WINNER_TONE[r.judgment.winner],
            )}
          >
            {r.judgment.winner}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
            v2 {r.judgment.v2Score}
          </span>
          {r.intentClass && (
            <span className="text-[9px] font-mono text-[var(--gold)]/70 truncate shrink-0">
              {r.intentClass}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-secondary)] truncate flex-1">
            {r.prompt.slice(0, 100)}
          </span>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
            {new Date(r.createdAt).toLocaleTimeString()}
          </span>
          <ChevronDown
            size={12}
            className="chevron shrink-0 text-[var(--text-tertiary)] transition-transform duration-200"
            aria-hidden="true"
          />
        </div>
      </summary>
      <div className="px-2.5 py-2 border-t border-[var(--border-default)] bg-[var(--bg-void)]/30 space-y-2">
        <p className="text-[10px] text-[var(--text-secondary)] italic">
          {r.judgment.summary}
        </p>
        <div className="grid grid-cols-2 gap-1">
          {r.judgment.dimensions.map((d) => (
            <div
              key={d.dimension}
              className="px-1.5 py-1 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40"
            >
              <div className="flex items-center justify-between text-[9px]">
                <span className="font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  {d.dimension}
                </span>
                <span
                  className={cn(
                    "font-mono uppercase px-1 py-0.5 rounded",
                    WINNER_TONE[d.winner],
                  )}
                >
                  {d.winner}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] leading-snug mt-0.5">
                {d.reason}
              </p>
            </div>
          ))}
        </div>
        {!r.judgment.parsed && (
          <p className="text-[10px] text-amber-300/80 italic">
            ⚠ judge response not parseable · default tie returned
          </p>
        )}
      </div>
    </details>
  );
}

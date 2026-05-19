"use client";

/**
 * MessageInfoCard — power-and-control dropdown surfacing every
 * Batch A column for an assistant message.
 *
 * v7.6 · C7 · Apr 29 · ChatMessage Batch A — visible truth panel.
 *
 * What it shows (per message):
 *   · Provider + model + routerReason  (which engine handled this turn + why)
 *   · Latency / TTFT                   (color-tinted: green<800ms, amber<2s, red>4s)
 *   · Tokens in/out + cost             (live $-format)
 *   · Streaming state                  (complete / partial / errored / aborted)
 *   · Attachments hash                 (truncated, click-to-copy full)
 *   · clientMessageId / parentMessageId / branchId (for branching debug)
 *   · Feedback toggle                  (thumbs up/down → POST to feedback API)
 *
 * Interaction:
 *   · Tiny `i` glyph at the message corner. Tap/click → opens card.
 *   · Click a field value → copies to clipboard + toast.
 *   · Click thumbs → optimistic UI + POSTs feedback. (Wired in C7 stub
 *     here, server endpoint added in same commit.)
 *
 * Visual language:
 *   · Card = ambient bg with subtle border (matches existing toasts).
 *   · Latency dot pulses if > 4s (helps spot slow turns at a glance).
 *   · Provider badge tinted by router reason (default = neutral, fallback
 *     = amber, preferLargeContext = blue, nourVoiceLane = gold).
 *
 * No external deps beyond lucide + cn. Pure component — feedback POST
 * is fire-and-forget so failed feedback never breaks the UI.
 */

import { useState } from "react";
import { Info, ThumbsUp, ThumbsDown, Copy, Check, Cpu, Clock, Coins, Hash, GitBranch, Activity, Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

import { authedFetch } from "@/hooks/use-authed-fetch";
import { trpc } from "@/lib/trpc/client";

/**
 * v10.0.98 — Slice B · "what your brain knew about this reply".
 *
 * On first card-open, lazy-fetches the message's provenance via the
 * chat.messageProvenance tRPC procedure. Surfaces the top-3 hybrid-
 * recall hits that most likely shaped this reply — same KNN+FTS+
 * recency stack the chat route uses to inject recall context into
 * the system prompt at generation time.
 *
 * Why surface it: the recall is already happening (96ms parallel pipe)
 * but is invisible. Visible recall = trust + debugging + power. User
 * sees what the brain remembered without leaving the chat thread.
 *
 * Phase EE (2026-05-18 PM) · migrated from `authedFetch` + useEffect
 * + cancelled-flag dance to `trpc.chat.messageProvenance.useQuery`
 * with `enabled: open` for the lazy-on-open semantics React Query
 * provides natively. The pre-EE manual `ProvenanceResponse` interface
 * is gone · types now flow from the procedure.
 */
// ProvenanceHit type now inferred from the trpc procedure (see usage
// in the brainHits derivation below).
export interface MessageInfoCardData {
  messageId: string;
  provider?: string | null;
  model?: string | null;
  routerReason?: string | null;
  latencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costCents?: number | null;
  streamingState?: string | null;
  feedbackScore?: number | null;
  attachmentsHash?: string | null;
  clientMessageId?: string | null;
  parentMessageId?: string | null;
  branchId?: string | null;
}

const ROUTER_REASON_TONE: Record<string, string> = {
  default: "text-zinc-400 border-zinc-500/30 bg-zinc-500/[0.04]",
  fallback: "text-amber-300 border-amber-500/35 bg-amber-500/[0.06]",
  preferLargeContext: "text-blue-300 border-blue-500/35 bg-blue-500/[0.06]",
  nourVoiceLane: "text-[var(--gold)] border-[var(--gold)]/35 bg-[var(--gold)]/[0.05]",
};

function latencyTone(ms: number | null | undefined): string {
  if (ms == null) return "text-zinc-500";
  if (ms < 800) return "text-emerald-300";
  if (ms < 2000) return "text-zinc-300";
  if (ms < 4000) return "text-amber-300";
  return "text-red-300";
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCost(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

export function MessageInfoCard({ data, className }: { data: MessageInfoCardData; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<number | null>(data.feedbackScore ?? null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  // v10.0.98 · Slice B — brain-context state. Lazy-loaded on first open.
  // Phase EE · React Query handles the lazy-fetch + cleanup. The pre-EE
  // useEffect + setState + cancelled-flag dance + manual dedup guard
  // is gone. `enabled: open` mirrors "only fire after first card open".
  // 60s staleTime means closing + reopening within a minute doesn't
  // re-fetch · matches the prior cached-per-card-render behavior.
  const [brainExpanded, setBrainExpanded] = useState(false);
  const provenanceQ = trpc.chat.messageProvenance.useQuery(
    { messageId: data.messageId },
    { enabled: open, staleTime: 60_000 },
  );
  const brainBusy = provenanceQ.isFetching;
  const brainErr = provenanceQ.error ? "recall failed" : null;
  // Slice to top-3 here (same as pre-EE) · the procedure returns up to 10
  const brainHits = provenanceQ.data
    ? provenanceQ.data.recall.hits.slice(0, 3)
    : null;

  const copy = async (field: string, value: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1000);
    } catch {
      // ignore — clipboard not available
    }
  };

  const setFeedbackOptimistic = async (score: number) => {
    if (feedbackBusy) return;
    const prev = feedback;
    const next = feedback === score ? null : score; // toggle off
    setFeedback(next);
    setFeedbackBusy(true);
    try {
      await authedFetch("/api/ai/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: data.messageId, score: next }),
      });
    } catch {
      // optimistic UI — silent on failure but revert
      setFeedback(prev);
    } finally {
      setFeedbackBusy(false);
    }
  };

  const total = (data.promptTokens ?? 0) + (data.completionTokens ?? 0);
  const reasonTone = data.routerReason && ROUTER_REASON_TONE[data.routerReason]
    ? ROUTER_REASON_TONE[data.routerReason]
    : ROUTER_REASON_TONE.default;
  const latencyVeryslow = (data.latencyMs ?? 0) > 4000;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px]",
          "border-[var(--border-default)] bg-[var(--bg-raised)]/40",
          "text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40",
          "transition-colors",
          open && "border-[var(--gold)]/60 bg-[var(--gold)]/10 text-[var(--gold)]",
          latencyVeryslow && !open && "msg-info-pulse-slow",
        )}
        title="Message info"
        aria-expanded={open}
      >
        <Info size={10} />
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-6 z-50 w-72 sm:w-80 rounded-xl border",
            "border-[var(--border-default)] bg-[var(--bg-void)]/95 backdrop-blur-xl shadow-2xl",
            "p-3 text-[11px] animate-fadeSlideUp",
          )}
        >
          {/* Provider + model + routerReason */}
          <Row icon={Cpu} label="provider">
            <span className="font-mono">{data.provider ?? "—"}</span>
            {data.model && (
              <button
                type="button"
                onClick={() => copy("model", data.model!)}
                className="ml-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] font-mono text-[10px] truncate max-w-[120px]"
                title="Click to copy model id"
              >
                {copiedField === "model" ? <Check size={10} className="inline" /> : data.model}
              </button>
            )}
          </Row>
          {data.routerReason && (
            <Row icon={GitBranch} label="router reason">
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-md border font-mono text-[9.5px] uppercase tracking-wider",
                  reasonTone,
                )}
              >
                {data.routerReason}
              </span>
            </Row>
          )}

          <Divider />

          {/* Latency */}
          <Row icon={Clock} label="latency">
            <span className={cn("font-mono", latencyTone(data.latencyMs))}>
              {fmtMs(data.latencyMs)}
            </span>
            {data.firstTokenLatencyMs != null && (
              <span className="ml-2 text-[var(--text-tertiary)] font-mono text-[10px]">
                ttft {fmtMs(data.firstTokenLatencyMs)}
              </span>
            )}
            {latencyVeryslow && (
              <span className="ml-2 inline-flex items-center gap-1 text-[9px] text-amber-400">
                <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                slow
              </span>
            )}
          </Row>

          {/* Tokens + cost */}
          <Row icon={Coins} label="tokens">
            <span className="font-mono text-[var(--text-secondary)]">
              {fmtTokens(data.promptTokens)} in · {fmtTokens(data.completionTokens)} out
            </span>
            {total > 0 && (
              <span className="ml-1.5 text-[var(--text-tertiary)] font-mono text-[9.5px]">= {fmtTokens(total)}</span>
            )}
          </Row>
          {data.costCents != null && (
            <Row icon={Coins} label="cost">
              <span className="font-mono text-[var(--gold)]">{fmtCost(data.costCents)}</span>
            </Row>
          )}

          <Divider />

          {/* Streaming state + feedback */}
          <Row icon={Activity} label="state">
            <span className="font-mono text-[var(--text-secondary)]">{data.streamingState ?? "complete"}</span>
          </Row>
          <div className="flex items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => setFeedbackOptimistic(1)}
              disabled={feedbackBusy}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md border text-[10px] transition-colors",
                feedback === 1
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-emerald-500/40 hover:text-emerald-300",
              )}
              title={feedback === 1 ? "Click again to clear" : "Mark good"}
            >
              <ThumbsUp size={10} />
              good
            </button>
            <button
              type="button"
              onClick={() => setFeedbackOptimistic(-1)}
              disabled={feedbackBusy}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md border text-[10px] transition-colors",
                feedback === -1
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-red-500/40 hover:text-red-300",
              )}
              title={feedback === -1 ? "Click again to clear" : "Mark bad"}
            >
              <ThumbsDown size={10} />
              bad
            </button>
          </div>

          {/* v10.0.98 · Slice B — Brain context (top-3 recall hits) */}
          <Divider />
          <Row icon={Brain} label="brain context">
            {brainBusy && brainHits === null ? (
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">recalling…</span>
            ) : brainErr ? (
              <span className="font-mono text-[10px] text-rose-300/80">{brainErr}</span>
            ) : brainHits && brainHits.length > 0 ? (
              <button
                type="button"
                onClick={() => setBrainExpanded((v) => !v)}
                className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--gold)] hover:text-[var(--gold)]/80 transition-colors"
                title="Show top recall hits"
              >
                {brainHits.length} memor{brainHits.length === 1 ? "y" : "ies"} shaped this
                <ChevronDown
                  size={10}
                  className={cn("transition-transform", brainExpanded && "rotate-180")}
                />
              </button>
            ) : (
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">no recall hits</span>
            )}
          </Row>
          {brainExpanded && brainHits && brainHits.length > 0 && (
            <div className="mt-1.5 space-y-1.5 pl-[12px] border-l border-[var(--gold)]/15 ml-[3px]">
              {brainHits.map((h) => (
                <div key={h.memoryId} className="text-[10px] leading-snug">
                  <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)] mb-0.5">
                    <span className="text-[var(--gold)]/70">{h.category.replace(/_/g, " ")}</span>
                    <span>·</span>
                    <span>{h.ageDays}d ago</span>
                    <span>·</span>
                    <span>conf {Math.round(h.confidence * 100)}%</span>
                    <span>·</span>
                    <span>score {h.finalScore.toFixed(2)}</span>
                  </div>
                  <p className="text-[var(--text-secondary)]/90 line-clamp-3">
                    {h.content.replace(/\s+/g, " ").trim().slice(0, 220)}
                    {h.content.length > 220 && "…"}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Identifiers (hashing/branching) */}
          {(data.attachmentsHash || data.parentMessageId || data.branchId || data.clientMessageId) && (
            <>
              <Divider />
              {data.attachmentsHash && (
                <Row icon={Hash} label="attachments">
                  <button
                    type="button"
                    onClick={() => copy("attachmentsHash", data.attachmentsHash!)}
                    className="font-mono text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    title="Click to copy full hash"
                  >
                    {copiedField === "attachmentsHash" ? <Check size={10} className="inline" /> : (
                      <>{data.attachmentsHash.slice(0, 8)}<Copy size={9} className="inline ml-1 opacity-60" /></>
                    )}
                  </button>
                </Row>
              )}
              {data.parentMessageId && (
                <Row icon={GitBranch} label="parent">
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    {data.parentMessageId.slice(0, 8)}…
                  </span>
                </Row>
              )}
              {data.branchId && (
                <Row icon={GitBranch} label="branch">
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    {data.branchId.slice(0, 8)}…
                  </span>
                </Row>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-1.5 right-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-[14px] leading-none"
            aria-label="Close info"
          >
            ×
          </button>
        </div>
      )}

      <style jsx>{`
        .msg-info-pulse-slow {
          animation: msg-info-slow-pulse 2s ease-in-out infinite;
        }
        @keyframes msg-info-slow-pulse {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; box-shadow: 0 0 8px rgba(251,191,36,0.3); }
        }
      `}</style>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Info;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 mb-1.5 last:mb-0">
      <Icon size={11} className="text-[var(--text-tertiary)]/70 shrink-0 mt-0.5" />
      <span className="text-[9px] uppercase tracking-[0.18em] font-mono text-[var(--text-tertiary)] w-[78px] shrink-0 mt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[var(--border-default)]/50 my-2" />;
}

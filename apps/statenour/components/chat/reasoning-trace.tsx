"use client";

/**
 * ReasoningTrace — the "Why this answer" panel under every Nick reply.
 *
 * Lazy-fetches from /api/system/agent-traces/by-message/[id] only when
 * expanded · zero cost while collapsed. Shows the full chain of calls
 * that produced the reply: provider/model · latency · cost · brain
 * retrievals · tools fired · sub-traces · critic scores.
 *
 * The point: operator can DEBUG vague replies in-context instead of
 * grep-ing logs. Operator-grade observability inline.
 *
 * Editorial-minimalist aesthetic per aesthetic-principles.md ·
 * monochrome with one accent · no purple gradients · no inter font ·
 * tight grid · numbers right-aligned.
 *
 * v10.0.515 · #7 reasoning-trace UI · ships with traceId linking from
 * persist-assistant-turn.ts (tokenUsage.traceId).
 *
 * v10.0.528 · a11y A7 fix · disclosure pattern needs aria-controls on
 * the toggle pointing at the disclosed contents' stable id. React's
 * useId() gives us a server-render-safe id per instance so multiple
 * traces on the same page don't collide.
 */

import * as React from "react";
import { useState, useCallback, useId } from "react";
import { ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

// Cross-domain residuals slice (2026-05-22) · `TraceResponse` stays a
// local interface describing what THIS card reads. The shared service's
// `AgentTraceByMessageView` (the `system.agentTraceByMessage` return
// type) is assignable to it — every field this card touches is present
// and compatibly typed.
interface TraceRow {
  id: string;
  label: string;
  source?: string | null;
  provider?: string | null;
  model?: string | null;
  startedAt: string;
  durationMs?: number | null;
  costCents?: number | null;
  toolCalls?: number;
  errorClass?: string | null;
  errorMessage?: string | null;
}

interface TraceEnvelopeConsolidated {
  memoriesUsed?: Array<{ id: string; title?: string; similarity?: number }>;
  factsAssumed?: string[];
  toolsCalled?: Array<{ name: string; args?: unknown }>;
  reason?: string | null;
}

interface TraceResponse {
  messageId: string;
  traceId: string | null;
  unavailable?: boolean;
  reason?: string;
  startedAt?: string;
  rootLabel?: string;
  rootSource?: string;
  totalDurationMs?: number;
  totalCostCents?: number;
  hasError?: boolean;
  consolidated?: TraceEnvelopeConsolidated;
  rows?: TraceRow[];
  summary?: {
    model: string | null;
    provider: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    persona: string | null;
    // Optional · tRPC's superjson transport surfaces an `unknown`
    // procedure field as optional (an `undefined` value is dropped on
    // the wire). The render already null-coalesces every `summary.*`
    // read so this is behavior-neutral.
    critic?: unknown;
    createdAt: string;
  } | null;
}

interface ReasoningTraceProps {
  messageId: string;
  /**
   * v10.0.517 · optional conversationId for the fresh-stream
   * fallback. When useChat's SDK id doesn't match the DB cuid yet,
   * the route resolves to the latest assistant in this conversation.
   */
  conversationId?: string;
  className?: string;
}

export function ReasoningTrace({ messageId, conversationId, className }: ReasoningTraceProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TraceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // v10.0.528 · a11y A7 · stable id for the disclosed contents so the
  // toggle can declare aria-controls. useId is SSR-safe and unique
  // per ReasoningTrace instance — multiple traces on the same page
  // never collide.
  const contentsId = useId();
  // Cross-domain residuals slice (2026-05-22) · migrated off
  // `authedFetch("/api/system/agent-traces/by-message/<id>")` onto
  // `trpc.system.agentTraceByMessage`. The trace is lazy-fetched only on
  // first expand · zero cost while collapsed · so it fires imperatively
  // via `utils.system.agentTraceByMessage.fetch()`. The procedure
  // returns the trace object directly · the legacy `json.data` envelope
  // unwrap is gone.
  const utils = trpc.useUtils();

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const trace = await utils.system.agentTraceByMessage.fetch({
        messageId,
        conversationId,
      });
      setData(trace);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [open, data, loading, messageId, conversationId, utils]);

  return (
    <div className={cn("mt-2 text-[11px]", className)}>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 opacity-60 hover:opacity-100",
          "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-[9.5px]",
          "transition-all",
        )}
        aria-expanded={open}
        aria-controls={contentsId}
        aria-label="Toggle reasoning trace"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        <span className="font-mono uppercase tracking-wider">Reason</span>
      </button>

      {open && (
        <div
          id={contentsId}
          className={cn(
            "mt-1.5 border-l border-[var(--border)] pl-3 ml-1.5",
            "space-y-2",
          )}
        >
          {loading && (
            <div className="text-[var(--text-secondary)]">loading…</div>
          )}
          {err && (
            <div className="flex items-center gap-1 text-[var(--danger,#dc2626)]">
              <AlertTriangle className="h-3 w-3" /> {err}
            </div>
          )}
          {data?.unavailable && (
            <div className="text-[var(--text-secondary)] italic">{data.reason}</div>
          )}
          {data && !data.unavailable && (
            <>
              {/* Top line — provider · model · latency · cost · tools · memories */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
                <Cell label="Provider" value={data.summary?.provider ?? "—"} />
                <Cell label="Model" value={data.summary?.model ?? "—"} />
                <Cell
                  label="Latency"
                  value={fmtMs(data.totalDurationMs)}
                  align="right"
                  valueClassName={
                    data.totalDurationMs
                      ? data.totalDurationMs > 12000
                        ? "text-rose-400/80 font-semibold"
                        : data.totalDurationMs > 5000
                        ? "text-amber-400"
                        : "text-emerald-400"
                      : undefined
                  }
                />
                <Cell
                  label="Cost"
                  value={fmtCents(data.totalCostCents)}
                  align="right"
                />
                <Cell
                  label="Tools"
                  value={String(data.consolidated?.toolsCalled?.length ?? 0)}
                  align="right"
                />
                <Cell
                  label="Memories"
                  value={String(data.consolidated?.memoriesUsed?.length ?? 0)}
                  align="right"
                />
              </div>

              {/* Sub-trace chain */}
              {data.rows && data.rows.length > 0 && (
                <div>
                  <div className="text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                    chain · {data.rows.length} step{data.rows.length === 1 ? "" : "s"}
                  </div>
                  <ul className="space-y-0.5">
                    {data.rows.map((r) => (
                      <li
                        key={r.id}
                        className={cn(
                          "font-mono flex items-baseline justify-between gap-2",
                          r.errorClass && "text-[var(--danger,#dc2626)]",
                        )}
                      >
                        <span className="truncate">
                          {r.label}
                          {r.provider && (
                            <span className="text-[var(--text-secondary)]">
                              {" "}
                              · {r.provider}
                            </span>
                          )}
                        </span>
                        <span className={cn(
                          "shrink-0",
                          r.durationMs && r.durationMs > 5000 ? "text-amber-400/80" : "text-[var(--text-secondary)]"
                        )}>
                          {fmtMs(r.durationMs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Memory citations · top 5 */}
              {data.consolidated?.memoriesUsed && data.consolidated.memoriesUsed.length > 0 && (
                <div>
                  <div className="text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                    brain retrievals
                  </div>
                  <ul className="space-y-0.5 font-mono">
                    {data.consolidated.memoriesUsed.slice(0, 5).map((m) => (
                      <li key={m.id} className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{m.title ?? m.id}</span>
                        {typeof m.similarity === "number" && (
                          <span className="text-[var(--text-secondary)] shrink-0">
                            {m.similarity.toFixed(2)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tool calls */}
              {data.consolidated?.toolsCalled && data.consolidated.toolsCalled.length > 0 && (
                <div>
                  <div className="text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                    tools fired
                  </div>
                  <ul className="space-y-0.5 font-mono">
                    {data.consolidated.toolsCalled.slice(0, 8).map((t, i) => (
                      <li key={`${t.name}-${i}`}>{t.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.hasError && (
                <div className="flex items-center gap-1 text-[var(--danger,#dc2626)] font-mono">
                  <AlertTriangle className="h-3 w-3" />
                  trace contains errors
                </div>
              )}

              <a
                href={`/system/agent-traces?traceId=${data.traceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-block mt-1 font-mono uppercase tracking-wider",
                  "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  "underline underline-offset-2",
                )}
              >
                open full trace →
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  align = "left",
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  align?: "left" | "right";
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-1", align === "right" && "justify-end")}>
      <span className="text-[var(--text-secondary)] uppercase tracking-wider">
        {label}
      </span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}

function fmtMs(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCents(cents?: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(4)}`;
}

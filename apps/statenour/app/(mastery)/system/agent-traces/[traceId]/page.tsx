"use client";

/**
 * /system/agent-traces/[traceId] · v10.0.149 · May 03
 *
 * Drill-down view for one trace. Shows the explainability envelope
 * (memories used, facts assumed, tools called, policy id, reason)
 * plus the full ladder of trace rows.
 *
 * Per the post-audit consolidation: every Nick response + every
 * autonomous action carries an envelope. This page is where an
 * operator answers "why did the system do that, what evidence did
 * it use, what rule allowed it?" in one screen.
 *
 * Linked from /system/agent-traces (chain rows are clickable).
 */

import { useState, use } from "react";
import Link from "next/link";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is now `trpc.system.agentTraceDetail.useQuery`. An
// unknown traceId surfaces as a NOT_FOUND tRPC error, mapped to the
// same "stale link" message the prior 404 branch showed.
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import {
  Brain,
  CheckCircle2,
  Clock,
  Coins,
  Compass,
  FileText,
  Loader2,
  Wrench,
  XCircle,
  ArrowLeft,
} from "lucide-react";

interface EnvelopeMemory {
  id: string;
  category: string;
  confidence: number | null;
  preview: string;
}

interface EnvelopeToolCall {
  name: string;
  ok: boolean;
  durationMs: number;
}

interface Envelope {
  version: 1;
  policyId: string | null;
  memoriesUsed: EnvelopeMemory[];
  factsAssumed: string[];
  toolsCalled: EnvelopeToolCall[];
  reason: string | null;
}

interface TraceRow {
  id: string;
  label: string;
  source: string;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  costCents: number | null;
  toolCalls: number;
  errorClass: string | null;
  errorMessage: string | null;
  startedAt: string;
  envelope: Envelope | null;
}

interface DetailPayload {
  traceId: string;
  startedAt: string;
  rootLabel: string;
  rootSource: string;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  consolidated: Envelope;
  rows: TraceRow[];
}

export default function TraceDetailPage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = use(params);

  // Phase B.7a · the single read is now a typed useQuery. A NOT_FOUND
  // error (the procedure maps a missing trace's ServiceError(404) →
  // NOT_FOUND) surfaces the same "stale link" copy the prior 404
  // branch showed.
  const detailQuery = trpc.system.agentTraceDetail.useQuery({ traceId });
  const data: DetailPayload | null =
    (detailQuery.data as DetailPayload | undefined) ?? null;
  const loading = detailQuery.isPending || detailQuery.isFetching;
  const error = detailQuery.error
    ? detailQuery.error.data?.code === "NOT_FOUND"
      ? "trace not found · stale or never persisted"
      : detailQuery.error.message
    : null;

  return (
    <div className="space-y-4">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="system · agent traces · detail"
        title={data?.rootLabel ?? "Loading…"}
        description={`Trace ${traceId}`}
      />

      <Link
        href="/system/agent-traces"
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft size={12} />
        back to chains
      </Link>

      {loading && (
        <Panel>
          <div className="flex items-center gap-2 p-4 text-zinc-500 text-[12px]">
            <Loader2 className="animate-spin" size={14} />
            loading envelope…
          </div>
        </Panel>
      )}

      {error && (
        <Panel>
          <p className="p-3 text-rose-400 text-[12px]">failed to load: {error}</p>
        </Panel>
      )}

      {data && (
        <>
          {/* Roll-up tile strip */}
          <Panel>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3">
              <Stat label="rows" value={data.rows.length} />
              <Stat
                label="cost"
                value={`$${(data.totalCostCents / 100).toFixed(3)}`}
              />
              <Stat
                label="duration"
                value={`${(data.totalDurationMs / 1000).toFixed(2)}s`}
              />
              <Stat label="source" value={data.rootSource} />
              <Stat
                label="status"
                value={data.hasError ? "error" : "ok"}
                tint={data.hasError ? "text-rose-400" : "text-emerald-400"}
              />
            </div>
          </Panel>

          {/* Consolidated envelope · the operator's "why" view */}
          <Panel>
            <div className="p-3 space-y-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1">
                <Compass size={10} />
                explainability envelope · consolidated
              </h2>

              {data.consolidated.reason && (
                <p className="text-[13px] text-zinc-200 italic border-l-2 border-amber-500/40 pl-2">
                  {data.consolidated.reason}
                </p>
              )}

              {/* Policy link */}
              <Section label="policy" icon={<Compass size={10} />}>
                {data.consolidated.policyId ? (
                  <Link
                    href={`/system/policies?search=${encodeURIComponent(data.consolidated.policyId)}`}
                    className="font-mono text-[11px] text-blue-300 hover:text-blue-200 hover:underline"
                  >
                    {data.consolidated.policyId}
                  </Link>
                ) : (
                  <span className="text-[10px] text-zinc-600 italic">
                    no policy declared · run scripts/seed-policies.ts to register
                  </span>
                )}
              </Section>

              {/* Memories used */}
              <Section
                label={`memories (${data.consolidated.memoriesUsed.length})`}
                icon={<Brain size={10} />}
              >
                {data.consolidated.memoriesUsed.length === 0 ? (
                  <span className="text-[10px] text-zinc-600 italic">none retrieved</span>
                ) : (
                  <ul className="space-y-1">
                    {data.consolidated.memoriesUsed.map((m) => (
                      <li
                        key={m.id}
                        className="text-[11px] text-zinc-300 leading-snug"
                      >
                        <span className="font-mono text-[8px] uppercase tracking-wider text-zinc-600 mr-1.5 px-1 py-px bg-zinc-800/40 rounded">
                          {m.category}
                        </span>
                        {m.preview}
                        {m.confidence !== null && (
                          <span className="text-[8px] font-mono text-zinc-600 ml-1.5">
                            · {Math.round(m.confidence * 100)}% conf
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Facts assumed */}
              <Section
                label={`facts (${data.consolidated.factsAssumed.length})`}
                icon={<FileText size={10} />}
              >
                {data.consolidated.factsAssumed.length === 0 ? (
                  <span className="text-[10px] text-zinc-600 italic">none recorded</span>
                ) : (
                  <ul className="space-y-0.5">
                    {data.consolidated.factsAssumed.map((f, i) => (
                      <li key={i} className="text-[11px] text-zinc-300">
                        · {f}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Tools called */}
              <Section
                label={`tools (${data.consolidated.toolsCalled.length})`}
                icon={<Wrench size={10} />}
              >
                {data.consolidated.toolsCalled.length === 0 ? (
                  <span className="text-[10px] text-zinc-600 italic">no tool calls</span>
                ) : (
                  <ul className="space-y-0.5 font-mono text-[10px]">
                    {data.consolidated.toolsCalled.map((t, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2"
                      >
                        {t.ok ? (
                          <CheckCircle2 size={10} className="text-emerald-400" />
                        ) : (
                          <XCircle size={10} className="text-rose-400" />
                        )}
                        <span className="text-zinc-300">{t.name}</span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-500">{t.durationMs}ms</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </Panel>

          {/* Per-row ladder */}
          <Panel>
            <div className="p-3 space-y-2">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                trace ladder · {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
              </h2>
              {data.rows.map((row, idx) => (
                <RowCard key={row.id} row={row} idx={idx} />
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={cn("text-[15px] font-bold tabular-nums", tint ?? "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-zinc-600">
        {icon}
        {label}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

function RowCard({ row, idx }: { row: TraceRow; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-zinc-800/60 bg-zinc-950/40 p-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="text-[8px] font-mono text-zinc-700">#{idx + 1}</span>
        <span className="text-[11px] font-mono text-zinc-200 flex-1 min-w-0 truncate">
          {row.label}
        </span>
        {row.errorClass ? (
          <span className="text-[9px] font-mono text-rose-400">{row.errorClass}</span>
        ) : (
          <CheckCircle2 size={10} className="text-emerald-500/60" />
        )}
        <span className="text-[9px] font-mono text-zinc-500">
          {row.durationMs ?? "—"}ms
        </span>
        {row.costCents != null && row.costCents > 0 && (
          <span className="text-[9px] font-mono text-zinc-500 inline-flex items-center gap-0.5">
            <Coins size={9} />${(row.costCents / 100).toFixed(3)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-zinc-900 space-y-1 text-[10px] font-mono text-zinc-500">
          <div>source: {row.source}</div>
          {row.provider && <div>provider: {row.provider}</div>}
          {row.model && <div>model: {row.model}</div>}
          {row.errorMessage && (
            <div className="text-rose-400">error: {row.errorMessage}</div>
          )}
          {row.envelope && (
            <div className="pt-1 mt-1 border-t border-zinc-900">
              <div className="text-zinc-400 mb-0.5">envelope (this row):</div>
              {row.envelope.reason && <div>· reason: {row.envelope.reason}</div>}
              {row.envelope.policyId && (
                <div>· policy: {row.envelope.policyId}</div>
              )}
              {row.envelope.memoriesUsed.length > 0 && (
                <div>· memories: {row.envelope.memoriesUsed.length}</div>
              )}
              {row.envelope.toolsCalled.length > 0 && (
                <div>· tools: {row.envelope.toolsCalled.length}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

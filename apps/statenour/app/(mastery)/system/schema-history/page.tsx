"use client";

/**
 * /system/schema-history · v10 Track E.1 · Apr 30.
 *
 * Operator UI for the v10.0.2 SchemaChangeLedger. Reads from
 * /api/system/schema-history and shows:
 *   · 6-axis summary (total, applied 24h/7d, pending, failed,
 *     destructive 30d)
 *   · Recent ledger entries with status pills, environment chips,
 *     destructive flag highlight, rollback-plan reveal
 *
 * Closes the migration-history visibility gap. Combined with
 * /system/embedding-coverage (pgvector backfill) and the v8.6
 * schema-drift sentinel, the operator can answer:
 *   "Is the database where I think it is, and how did it get there?"
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LedgerEntry {
  id: string;
  changeKey: string;
  title: string;
  reason: string;
  changeType: string;
  method: string;
  environment: string;
  destructive: boolean;
  status: string;
  appliedAt: string | null;
  appliedBy: string | null;
  approvedBy: string | null;
  rollbackPlan: string | null;
  createdAt: string;
}

interface LedgerPayload {
  generatedAt: string;
  stats: {
    totalChanges: number;
    appliedLast24h: number;
    appliedLast7d: number;
    pendingPlanned: number;
    failedLast24h: number;
    destructiveLast30d: number;
  };
  entries: LedgerEntry[];
}

type EnvFilter = "all" | "production" | "preview" | "local";

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function statusColor(status: string): string {
  if (status === "applied") return "text-emerald-300";
  if (status === "planned") return "text-amber-300";
  if (status === "failed") return "text-rose-300";
  if (status === "rolled_back") return "text-zinc-400";
  return "text-zinc-500";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "applied")
    return <CheckCircle2 size={11} className="text-emerald-300" />;
  if (status === "planned")
    return <Clock size={11} className="text-amber-300" />;
  if (status === "failed")
    return <XCircle size={11} className="text-rose-300" />;
  return <Clock size={11} className="text-zinc-400" />;
}

function envColor(env: string): string {
  if (env === "production") return "text-rose-200 bg-rose-500/10";
  if (env === "preview") return "text-amber-200 bg-amber-500/10";
  return "text-zinc-300 bg-zinc-500/10";
}

export default function SchemaHistoryPage() {
  const [data, setData] = useState<LedgerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [envFilter, setEnvFilter] = useState<EnvFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        envFilter === "all"
          ? "/api/system/schema-history?limit=100"
          : `/api/system/schema-history?limit=100&env=${envFilter}`;
      const res = await authedFetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: LedgerPayload } & LedgerPayload;
      setData(j.data ?? (j as LedgerPayload));
      setLastFetched(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [envFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const recentDestructive = useMemo(() => {
    if (!data) return 0;
    return data.entries.filter((e) => e.destructive).length;
  }, [data]);

  return (
    <StandardPage
      eyebrow="System · v10 Track B.4"
      title="schema history"
      description="Migration audit trail · every db push, every schema change · destructive flag + rollback plan visible"
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/schema-history"
          onReload={() => void load()}
        />
      }
    >
      {error && !data && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">
            Loading ledger…
          </p>
        </Panel>
      )}

      {data && (
        <>
          {/* ── 6-axis summary ─────────────────────────────────── */}
          <Panel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCell
                icon={<Database size={11} />}
                label="total"
                value={data.stats.totalChanges}
                color="text-zinc-200"
              />
              <SummaryCell
                icon={<CheckCircle2 size={11} />}
                label="applied 24h"
                value={data.stats.appliedLast24h}
                color="text-emerald-300"
              />
              <SummaryCell
                icon={<CheckCircle2 size={11} />}
                label="applied 7d"
                value={data.stats.appliedLast7d}
                color="text-emerald-200"
              />
              <SummaryCell
                icon={<Clock size={11} />}
                label="pending"
                value={data.stats.pendingPlanned}
                color={
                  data.stats.pendingPlanned > 0
                    ? "text-amber-300"
                    : "text-zinc-400"
                }
              />
              <SummaryCell
                icon={<XCircle size={11} />}
                label="failed 24h"
                value={data.stats.failedLast24h}
                color={
                  data.stats.failedLast24h > 0
                    ? "text-rose-300"
                    : "text-zinc-400"
                }
              />
              <SummaryCell
                icon={<AlertTriangle size={11} />}
                label="destructive 30d"
                value={data.stats.destructiveLast30d}
                color={
                  data.stats.destructiveLast30d > 0
                    ? "text-rose-200"
                    : "text-zinc-400"
                }
              />
            </div>
          </Panel>

          {/* ── Environment filter ─────────────────────────────── */}
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-zinc-500">env:</span>
            {(["all", "production", "preview", "local"] as const).map((env) => (
              <button
                key={env}
                onClick={() => setEnvFilter(env)}
                className={cn(
                  "rounded px-2 py-1 transition",
                  envFilter === env
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {env}
              </button>
            ))}
          </div>

          {/* ── Ledger entries ─────────────────────────────────── */}
          <Panel>
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                recent changes ({data.entries.length})
              </h2>
              {recentDestructive > 0 && (
                <span className="text-[10px] text-rose-300">
                  {recentDestructive} destructive in window
                </span>
              )}
            </header>

            {data.entries.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-zinc-500">
                No ledger entries for this filter.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {data.entries.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => toggleExpand(e.id)}
                    className="block w-full py-2.5 text-left transition hover:bg-zinc-800/20"
                  >
                    <div className="flex items-center gap-2 px-2">
                      <StatusIcon status={e.status} />
                      <span
                        className={cn(
                          "text-[11px] font-mono uppercase tracking-wider",
                          statusColor(e.status),
                        )}
                      >
                        {e.status}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-[1px] text-[9px] uppercase tracking-wider",
                          envColor(e.environment),
                        )}
                      >
                        {e.environment}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                        {e.changeType}
                      </span>
                      {e.destructive && (
                        <span className="rounded bg-rose-500/20 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-rose-200">
                          destructive
                        </span>
                      )}
                      <span className="ml-auto text-[10px] tabular-nums text-zinc-500">
                        {e.appliedAt ? relTime(e.appliedAt) : relTime(e.createdAt)}
                      </span>
                    </div>
                    <div className="px-2 pt-1 text-[12px] text-zinc-200">
                      {e.title}
                    </div>
                    <div className="px-2 text-[10px] font-mono text-zinc-500">
                      {e.changeKey}
                    </div>
                    {expanded.has(e.id) && (
                      <div className="mt-2 space-y-2 px-2 text-[11px] text-zinc-300">
                        <div>
                          <span className="text-zinc-500">Reason: </span>
                          {e.reason}
                        </div>
                        {e.appliedBy && (
                          <div className="text-zinc-400">
                            Applied by: {e.appliedBy}
                            {e.approvedBy && ` · approved by: ${e.approvedBy}`}
                          </div>
                        )}
                        {e.rollbackPlan && (
                          <div className="rounded border border-amber-500/30 bg-amber-500/[0.04] p-2">
                            <div className="text-[9px] font-mono uppercase tracking-wider text-amber-300">
                              rollback plan
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-[11px] text-amber-100/90">
                              {e.rollbackPlan}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} · v10 B.4 ·
            see <code>docs/DB-MIGRATION-POLICY.md</code> for the contract
          </p>
        </>
      )}
    </StandardPage>
  );
}

function SummaryCell({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>
        <AnimatedCounter value={value} />
      </div>
    </div>
  );
}

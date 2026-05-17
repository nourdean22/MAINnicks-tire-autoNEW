"use client";

/**
 * /system/deployment-truth · v10 Track E.4 · Apr 30.
 *
 * One panel answering: "Is the deployed code, the live schema, the
 * env config, the prompt mode, and the cron health all in agreement
 * right now?"
 *
 * Five sections:
 *   · BUILD — git SHA, branch, deploy timestamp, env
 *   · SCHEMA — drift findings via v8.6 sentinel
 *   · ENV — secret-class env vars (presence, never values)
 *   · NICK PRIME — current prompt-routing mode (off/shadow/on)
 *   · CRON — 24h success rate + oldest stale job
 *
 * Closes the "live deployment truth" gap from the assessment row
 * "Deployment discipline · live Vercel/Neon truth still needs
 * surfaced." Now there's one screen for it.
 */

import { useCallback, useEffect, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Lock,
  GitBranch,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SecretCheck {
  name: string;
  configured: boolean;
  critical: boolean;
}

interface DeploymentTruth {
  generatedAt: string;
  build: {
    sha: string;
    shaShort: string;
    commitMessage: string | null;
    branch: string;
    deploymentId: string | null;
    env: string;
    buildTime: string | null;
    serverTime: string;
  };
  schema: {
    ok: boolean;
    reachable: boolean;
    issuesFound: number;
    topIssues: Array<{
      severity: string;
      expectationTable: string;
      problem: string;
    }>;
  };
  env: {
    checks: SecretCheck[];
    missingCritical: number;
  };
  nickPrime: {
    mode: "off" | "shadow" | "on" | "unknown";
    description: string;
  };
  cron: {
    last24hRuns: number;
    last24hSuccess: number;
    last24hFailures: number;
    successRate: number;
    oldestStaleJob: { jobName: string; lastSeenAt: string | null } | null;
  };
  health: "green" | "yellow" | "red";
}

function HealthDot({ health }: { health: "green" | "yellow" | "red" }) {
  const cls =
    health === "green"
      ? "bg-emerald-400"
      : health === "yellow"
        ? "bg-amber-400 animate-pulse"
        : "bg-rose-400 animate-pulse";
  return <span className={cn("inline-block h-2 w-2 rounded-full", cls)} />;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function DeploymentTruthPage() {
  const [data, setData] = useState<DeploymentTruth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/system/deployment-truth");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: DeploymentTruth } & DeploymentTruth;
      setData(j.data ?? (j as DeploymentTruth));
      setLastFetched(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 60s poll — composed payload, costlier than a single endpoint.
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);

  return (
    <StandardPage
      eyebrow="System · v10 Track E.4"
      title="deployment truth"
      description="Live agreement check · code SHA + schema drift + env presence + prompt mode + cron health · one panel"
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/deployment-truth"
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
            Loading…
          </p>
        </Panel>
      )}

      {data && (
        <>
          {/* Overall health banner */}
          <Panel
            className={cn(
              "border",
              data.health === "green" && "border-emerald-500/30 bg-emerald-500/[0.03]",
              data.health === "yellow" && "border-amber-500/30 bg-amber-500/[0.03]",
              data.health === "red" && "border-rose-500/30 bg-rose-500/[0.03]",
            )}
          >
            <div className="flex items-center gap-3 p-3">
              <HealthDot health={data.health} />
              <div className="text-[11px] font-mono uppercase tracking-wider">
                {data.health === "green"
                  ? "All systems aligned"
                  : data.health === "yellow"
                    ? "Watch — drift or stale signals"
                    : "Action required — critical mismatch"}
              </div>
              <span className="ml-auto text-[10px] text-zinc-500">
                v10 Track E.4 · 60s poll
              </span>
            </div>
          </Panel>

          {/* BUILD */}
          <Panel>
            <SectionHeader icon={<GitBranch size={11} />} title="build" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="commit" value={data.build.shaShort} mono />
              <Field label="branch" value={data.build.branch} mono />
              <Field label="env" value={data.build.env} mono />
              <Field
                label="deployed"
                value={data.build.buildTime ? relTime(data.build.buildTime) : "—"}
              />
              {data.build.commitMessage && (
                <div className="sm:col-span-2 text-[11px] text-zinc-300 truncate">
                  &ldquo;{data.build.commitMessage}&rdquo;
                </div>
              )}
            </div>
          </Panel>

          {/* SCHEMA */}
          <Panel>
            <SectionHeader
              icon={<Database size={11} />}
              title="schema"
              right={
                data.schema.ok ? (
                  <span className="text-[10px] text-emerald-300">aligned</span>
                ) : (
                  <span className="text-[10px] text-amber-300">
                    {data.schema.issuesFound} drift finding(s)
                  </span>
                )
              }
            />
            {!data.schema.reachable ? (
              <p className="text-[11px] text-rose-300">
                ⚠ DB unreachable — sentinel could not run
              </p>
            ) : data.schema.topIssues.length === 0 ? (
              <p className="text-[11px] text-emerald-300">
                <CheckCircle2 size={11} className="inline mr-1" />
                No drift between local schema.prisma and live Neon.
              </p>
            ) : (
              <div className="space-y-1">
                {data.schema.topIssues.map((issue, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-[11px]"
                  >
                    <span
                      className={cn(
                        "rounded px-1 py-[1px] text-[9px] uppercase tracking-wider",
                        issue.severity === "high"
                          ? "bg-rose-500/20 text-rose-200"
                          : issue.severity === "medium"
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-zinc-500/10 text-zinc-300",
                      )}
                    >
                      {issue.severity}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {issue.expectationTable}
                    </span>
                    <span className="text-zinc-300">{issue.problem}</span>
                  </div>
                ))}
                <a
                  href="/system/schema-history"
                  className="mt-1 inline-block text-[10px] text-amber-300 hover:underline"
                >
                  full report →
                </a>
              </div>
            )}
          </Panel>

          {/* ENV */}
          <Panel>
            <SectionHeader
              icon={<Lock size={11} />}
              title="env secrets"
              right={
                data.env.missingCritical > 0 ? (
                  <span className="text-[10px] text-rose-300">
                    {data.env.missingCritical} critical missing
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-300">
                    all critical present
                  </span>
                )
              }
            />
            <div className="grid gap-1 sm:grid-cols-2">
              {data.env.checks.map((c) => (
                <div
                  key={c.name}
                  className={cn(
                    "flex items-center gap-2 text-[11px] font-mono",
                    !c.configured && c.critical && "text-rose-300",
                    !c.configured && !c.critical && "text-zinc-500",
                    c.configured && "text-zinc-300",
                  )}
                >
                  {c.configured ? (
                    <CheckCircle2 size={11} className="text-emerald-300" />
                  ) : c.critical ? (
                    <XCircle size={11} className="text-rose-300" />
                  ) : (
                    <AlertTriangle size={11} className="text-zinc-500" />
                  )}
                  <span>{c.name}</span>
                  {c.critical && (
                    <span className="text-[9px] uppercase text-rose-400/70">
                      critical
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {/* NICK PRIME */}
          <Panel>
            <SectionHeader icon={<Zap size={11} />} title="Nick prime mode" />
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "rounded px-2 py-[2px] text-[11px] font-mono uppercase tracking-wider",
                  data.nickPrime.mode === "on" && "bg-emerald-500/20 text-emerald-200",
                  data.nickPrime.mode === "shadow" && "bg-amber-500/20 text-amber-200",
                  data.nickPrime.mode === "off" && "bg-zinc-500/10 text-zinc-400",
                  data.nickPrime.mode === "unknown" && "bg-rose-500/20 text-rose-300",
                )}
              >
                {data.nickPrime.mode}
              </span>
              <span className="text-[11px] text-zinc-300">
                {data.nickPrime.description}
              </span>
            </div>
          </Panel>

          {/* CRON */}
          <Panel>
            <SectionHeader
              icon={<Clock size={11} />}
              title="cron health · last 24h"
              right={
                <span
                  className={cn(
                    "text-[10px]",
                    data.cron.successRate >= 95 ? "text-emerald-300" : "text-amber-300",
                  )}
                >
                  {data.cron.successRate}% ok
                </span>
              }
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="runs" value={String(data.cron.last24hRuns)} mono />
              <Field
                label="success"
                value={String(data.cron.last24hSuccess)}
                mono
              />
              <Field
                label="failures"
                value={String(data.cron.last24hFailures)}
                mono
                color={
                  data.cron.last24hFailures > 0 ? "text-rose-300" : "text-zinc-300"
                }
              />
            </div>
            {data.cron.oldestStaleJob && (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/[0.04] p-2 text-[10px]">
                <span className="text-amber-300">Stale: </span>
                <span className="font-mono text-amber-100">
                  {data.cron.oldestStaleJob.jobName}
                </span>
                <span className="text-amber-200">
                  {" "}
                  · last seen {relTime(data.cron.oldestStaleJob.lastSeenAt)}
                </span>
              </div>
            )}
          </Panel>

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} · v10 E.4
          </p>
        </>
      )}
    </StandardPage>
  );
}

function SectionHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-zinc-500">{icon}</span>
      <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
        {title}
      </h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 w-20">
        {label}
      </span>
      <span
        className={cn(
          mono && "font-mono",
          color ?? "text-zinc-200",
        )}
      >
        {value}
      </span>
    </div>
  );
}

"use client";

/**
 * components/settings/system-info-card.tsx · 2026-06-02
 *
 * Rebuilt from the prior inline SystemInfo, which rendered ~10 hardcoded
 * string rows masquerading as live telemetry ("brain engines: 60+ files",
 * "cron jobs: 41", "AI provider: Venice GLM-4.7", platform/repos/admin,
 * and a "version" that read `info.appVersion` — a field NO endpoint ever
 * returns, so it always fell back to a literal "v10"). Those are deleted.
 *
 * This card now shows ONLY values the two queries actually return live:
 *   · tools        — toolsHealth.summary.totalTools (runtime category rollup)
 *   · arsenal      — toolsHealth.summary.overallStatus (operational/degraded/partial)
 *   · database     — toolsHealth.dependencies.database.status (live $queryRaw probe)
 *   · memories     — brain.status → memories.total (live COUNT over brain_memories)
 *
 * Build identity (SHA · deployed age) lives in the DeployChip under
 * Diagnostics — the honest "what code is live" signal — so there is
 * deliberately no version row here. Loading renders "…", and a both-
 * queries-failed state renders an explicit "stale" warning rather than
 * silently showing defaults as if they were live.
 */

import { Shield } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

function SystemInfoRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span>{label}</span>
      <span className={color || ""}>{value}</span>
    </div>
  );
}

export function SystemInfoCard() {
  const toolsQuery = trpc.system.toolsHealth.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const brainQuery = trpc.brain.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const info = toolsQuery.data ?? null;
  const overallStatus = info?.summary?.overallStatus ?? null;
  const dbStatus = info?.dependencies?.database?.status ?? null;
  // brain.status → memories is a Record<string, unknown> (getStatus);
  // total is a real COUNT but typed loose — guard the read.
  const memoryCount: number | null =
    typeof brainQuery.data?.memories?.total === "number"
      ? (brainQuery.data.memories.total as number)
      : null;
  // Show "stale" — not silent defaults — only when BOTH live reads fail.
  const healthError = toolsQuery.isError && brainQuery.isError;

  const statusColor = (s: string) =>
    s === "operational" || s === "ok"
      ? "text-green-400"
      : s === "degraded"
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-[var(--text-tertiary)]" />
          <span className="text-[15px] font-semibold text-fg">
            System
          </span>
        </div>
        {/* The dot was hardcoded green — it announced LIVE while both
            reads were erroring. It now tells the truth it already knew. */}
        <div className="flex items-center gap-1.5">
          {healthError ? (
            <>
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span className="text-[11px] text-rose-300 font-mono">STALE</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-green-400 pulse-live" />
              <span className="text-[11px] text-green-400 font-mono">LIVE</span>
            </>
          )}
        </div>
      </div>
      <div className="space-y-1 text-[11px] font-mono text-[var(--text-tertiary)]">
        <SystemInfoRow
          label="tools"
          value={info != null ? `${info.summary?.totalTools ?? "?"}` : "…"}
        />
        <SystemInfoRow
          label="memories"
          value={memoryCount ?? "…"}
          color={memoryCount ? "text-violet-400" : ""}
        />
        <SystemInfoRow
          label="database"
          value={dbStatus ? dbStatus.toUpperCase() : "…"}
          color={dbStatus ? statusColor(dbStatus) : ""}
        />
        {overallStatus && (
          <SystemInfoRow
            label="arsenal"
            value={overallStatus.toUpperCase()}
            color={statusColor(overallStatus)}
          />
        )}
        {healthError && (
          <SystemInfoRow
            label="health"
            value="endpoints unreachable — values stale"
            color="text-amber-400"
          />
        )}
      </div>
    </div>
  );
}

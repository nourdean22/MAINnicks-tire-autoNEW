"use client";

/**
 * SchemaDriftCard · v8.2 BATCH 12 · Apr 29.
 *
 * Pulls /api/system/schema-drift (v8.1 sentinel) and surfaces an
 * at-a-glance status:
 *   · ok=true       → silent (or "✓ schema clean")
 *   · ok=false      → red banner with the count of findings + drilldown
 *   · reachable=false → "DB unreachable" amber banner
 *
 * Drops onto /system/health between the headline and the per-area
 * cards. D5-compliant via FreshnessChip.
 */

import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle, AlertTriangle, ShieldAlert } from "lucide-react";

interface DriftFinding {
  severity: "high" | "medium" | "low";
  problem: string;
  expectation: { kind: string; reason: string; table?: string };
}

interface DriftReport {
  ok: boolean;
  reachable: boolean;
  checkedAt: string;
  findings: DriftFinding[];
  expectationCount: number;
  fromCache?: boolean;
}

const SEV_TINT: Record<string, string> = {
  high: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  medium: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  low: "text-fg-secondary border-edge-default bg-surface-interactive",
};

export function SchemaDriftCard() {
  // Phase VV (2026-05-22) · REST→tRPC · system.schemaDrift. The legacy
  // route's `?force=1` skipped its 30s module-level cache; that cache
  // now lives in the shared service and the procedure takes `{force}`.
  // The reload button flips a `force` flag → React Query keys on it and
  // re-fetches, hitting the uncached path exactly as the old reload did.
  // The legacy route returned the report directly (no `{data}` wrap).
  const [expanded, setExpanded] = useState(false);
  const [force, setForce] = useState(false);
  const driftQuery = trpc.system.schemaDrift.useQuery({ force });
  const report: DriftReport | null = driftQuery.data ?? null;
  const loading = driftQuery.isPending || driftQuery.isFetching;
  const error = driftQuery.error
    ? driftQuery.error.message || "fetch failed"
    : null;
  const load = (forceRefresh = false) => {
    if (forceRefresh && !force) {
      setForce(true); // flips the query key → forced re-fetch
    } else {
      void driftQuery.refetch();
    }
  };

  if (loading && !report) {
    return (
      <GlassCard>
        <p className="text-[11px] text-fg-tertiary">checking schema drift…</p>
      </GlassCard>
    );
  }

  if (error && !report) {
    return (
      <GlassCard>
        <p className="text-[11px] text-rose-400">schema-drift check unavailable: {error}</p>
      </GlassCard>
    );
  }

  if (!report) return null;

  const reachable = report.reachable;
  const ok = report.ok;
  const findingsCount = report.findings.length;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {!reachable ? (
            <AlertTriangle size={14} className="text-amber-400" />
          ) : ok ? (
            <CheckCircle size={14} className="text-emerald-400" />
          ) : (
            <ShieldAlert size={14} className="text-rose-400" />
          )}
          <span className="section-label">Schema drift</span>
        </div>
        <FreshnessChip
          lastFetchedAt={report.checkedAt}
          source="api/system/schema-drift"
          onReload={() => void load(true)}
          compact
        />
      </div>

      {!reachable && (
        <p className="text-[11px] text-amber-300">
          DB unreachable from the sentinel — check Neon connectivity.
        </p>
      )}

      {reachable && ok && (
        <p className="text-[11px] text-emerald-300">
          ✓ {report.expectationCount} expectations all met. No drift.
        </p>
      )}

      {reachable && !ok && (
        <>
          <p className="text-[11px] text-rose-300">
            {findingsCount} drift finding{findingsCount === 1 ? "" : "s"} across{" "}
            {report.expectationCount} expectations.
          </p>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 font-mono text-[11px] text-fg-tertiary hover:text-fg"
          >
            {expanded ? "Hide" : "Show"} findings
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {report.findings.map((f, i) => (
                <li
                  key={i}
                  className={"rounded-control border p-2 text-[11px] " + (SEV_TINT[f.severity] ?? SEV_TINT.low)}
                >
                  <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] opacity-80">
                      {f.severity}
                    </span>
                    {f.expectation.table && (
                      <span className="font-mono text-[11px] opacity-70">
                        {f.expectation.table}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 break-words">{f.problem}</p>
                  <p className="mt-0.5 text-[11px] opacity-60">{f.expectation.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassCard>
  );
}

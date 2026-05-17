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

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
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
  low: "text-zinc-300 border-zinc-500/20 bg-zinc-500/5",
};

export function SchemaDriftCard() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await authedFetch(
        `/api/system/schema-drift${force ? "?force=1" : ""}`,
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: DriftReport } & DriftReport;
      setReport(j.data ?? (j as DriftReport));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !report) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">checking schema drift…</p>
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
            className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
          >
            {expanded ? "hide" : "show"} findings
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {report.findings.map((f, i) => (
                <li
                  key={i}
                  className={"rounded-md border p-2 text-[11px] " + (SEV_TINT[f.severity] ?? SEV_TINT.low)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                      {f.severity}
                    </span>
                    {f.expectation.table && (
                      <span className="font-mono text-[10px] opacity-70">
                        {f.expectation.table}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 break-words">{f.problem}</p>
                  <p className="mt-0.5 text-[10px] opacity-60">{f.expectation.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassCard>
  );
}

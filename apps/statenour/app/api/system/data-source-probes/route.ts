/**
 * GET /api/system/data-source-probes · Wave X.f (2026-05-24) · activation
 *
 * Reader for the data-source-health probe pipeline shipped v10.0.58
 * Wave B. The `/api/cron/data-source-health` cron writes one
 * `BrainMemory(category="data_source_probe", key="<probeName>_<ET-date>")`
 * row per probe per day · pre-fix no operator surface consumed those
 * rows · the canary-feeder pipeline ran for nothing.
 *
 * This endpoint joins persisted probe runs with the probe specs (which
 * declare the empty-days alert threshold per probe) and surfaces a
 * clean per-probe rollup the /system/data-source-health page renders:
 * latest result · consecutive-empty streak · alert state.
 *
 * Note · `/api/system/diagnostics` is a different endpoint (system-wide
 * KPI rollup); this one is probe-specific.
 *
 * Read-only · owner-gated.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { getProbeSpecs } from "@/lib/contracts/data-source-health";

export const dynamic = "force-dynamic";

interface PersistedProbe {
  probe?: string;
  kind?: "personal" | "shop" | "bridge";
  ok?: boolean;
  rowCount?: number;
  latencyMs?: number;
  reason?: string;
  at?: string;
}

function parseProbeContent(raw: string | null | undefined): PersistedProbe | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedProbe;
  } catch {
    return null;
  }
}

export const GET = apiHandler(
  async () => {
    const specs = getProbeSpecs();

    // Pull the last 30 days of probe rows · enough to display the
    // longest threshold (14d for bridge probes) plus headroom for
    // streak computation.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.brainMemory
      .findMany({
        where: {
          category: "data_source_probe",
          createdAt: { gte: since },
          deletedAt: null,
        },
        select: { key: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
      .catch(() => []);

    // Group rows by probe name · within each group sort by createdAt
    // desc · the first item is the latest, the streak is the count
    // of leading entries with `ok && rowCount === 0`.
    const byProbe = new Map<
      string,
      Array<{ at: Date; ok: boolean; rowCount: number; reason: string | null; latencyMs: number }>
    >();
    for (const row of rows) {
      const parsed = parseProbeContent(row.content);
      if (!parsed || !parsed.probe) continue;
      const arr = byProbe.get(parsed.probe) ?? [];
      arr.push({
        at: row.createdAt,
        ok: parsed.ok === true,
        rowCount: Number(parsed.rowCount ?? 0),
        reason: parsed.reason ?? null,
        latencyMs: Number(parsed.latencyMs ?? 0),
      });
      byProbe.set(parsed.probe, arr);
    }

    const probes = specs.map((spec) => {
      const runs = byProbe.get(spec.name) ?? [];
      runs.sort((a, b) => b.at.getTime() - a.at.getTime());
      const latest = runs[0] ?? null;
      // Streak · count leading entries with ok && rowCount === 0.
      // We stop at the first non-empty (or non-ok) result. A failed
      // probe resets the streak (surfaced separately via latest.ok).
      let emptyStreak = 0;
      for (const r of runs) {
        if (r.ok && r.rowCount === 0) emptyStreak++;
        else break;
      }
      const alerting = emptyStreak >= spec.emptyDaysAlertThreshold;
      return {
        name: spec.name,
        label: spec.label,
        kind: spec.kind,
        emptyDaysAlertThreshold: spec.emptyDaysAlertThreshold,
        runs: runs.length,
        latest: latest && {
          at: latest.at.toISOString(),
          ok: latest.ok,
          rowCount: latest.rowCount,
          reason: latest.reason,
          latencyMs: latest.latencyMs,
        },
        emptyStreak,
        alerting,
      };
    });

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      probeCount: probes.length,
      alertingCount: probes.filter((p) => p.alerting).length,
      probes,
    };
  },
  { auth: "owner" },
);

/**
 * Data-source health probes · v10.0.58 · Wave B.
 *
 * The architectural canary that catches the NEXT ghost-feeder
 * before it lives in production for months. v10.0.50→55 closed
 * 203 dead Promise.resolve sites that had been silently shipping
 * empty results since DailyScore + HabitLog retired and customer/
 * job/lead/quote tables moved to nickstire. The audit waves caught
 * them, but only after operator-visible behavior drifted enough
 * to notice.
 *
 * This module probes each high-leverage data feeder on a regular
 * cron tick. For each probe it records `{ ok, rowCount, latencyMs,
 * reason? }` to `BrainMemory` (category="data_source_probe", keyed
 * by probe-name + ET date). The /system/diagnostics surface reads
 * a streak: how many consecutive runs has this probe returned
 * empty? When the streak crosses a probe-specific threshold, a
 * `data_source_dead` alert fires.
 *
 * Why this matters:
 *   - Pre-Wave A, the operating-rhythm cron sent 5 daily Telegrams
 *     with $0 revenue / 0 stale leads / 0 callbacks regardless of
 *     actual shop state because the inputs were dead `Promise.resolve`
 *     placeholders. That bug lived in production for weeks before
 *     v10.0.42 audit caught it.
 *   - Wave A finished the migration. Wave B (this module) protects
 *     the investment by detecting the same class of regression
 *     within hours instead of weeks.
 *
 * NOT in v1:
 *   - Telegram alerts (just persist + dashboard-render for now)
 *   - Per-probe historical trend graphs (data is in BrainMemory;
 *     /system/diagnostics can render later)
 *   - Auto-recovery probes (e.g. retry the bridge, re-fetch shim)
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("contracts/data-source-health");

export interface ProbeResult {
  ok: boolean;
  rowCount: number;
  latencyMs: number;
  reason?: string;
}

export interface ProbeSpec {
  /** Stable probe identifier — used as the BrainMemory key prefix. */
  name: string;
  /** Human label for dashboard rendering. */
  label: string;
  /**
   * Probe runner — must resolve fast. Failures are caught and
   * surfaced as `{ ok: false, reason }` rather than throwing.
   */
  probe: () => Promise<ProbeResult>;
  /**
   * Days of consecutive empty results before this probe is
   * considered "data source dead." Use a higher number for shop
   * data (where empty might be legitimate — e.g. quiet day) and a
   * lower number for personal data (Nour engages daily).
   */
  emptyDaysAlertThreshold: number;
  /**
   * Probe class — informs how the dashboard groups + how the alert
   * is severity-scored.
   */
  kind: "personal" | "shop" | "bridge";
}

const PROBES: ProbeSpec[] = [
  // ── Personal-side legacy shims ──
  {
    name: "legacy.scoreSnapshots",
    label: "Identity-snapshot history (last 7d)",
    probe: timed(async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      const rows = await recentScoreSnapshots(7);
      return { ok: true, rowCount: rows.length, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 2,
    kind: "personal",
  },
  {
    name: "legacy.dailyHabits",
    label: "DAILY-task habit history (last 7d)",
    probe: timed(async () => {
      const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
      const rows = await recentDailyHabits(7);
      return { ok: true, rowCount: rows.length, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 3,
    kind: "personal",
  },

  // ── Shop-side bridge probes ──
  {
    name: "bridge.revenue_today",
    label: "queryNick(revenue_today)",
    probe: timed(async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const res = await queryNick<{ totalDollars?: number; invoiceCount?: number }>(
        "revenue_today",
      );
      if ("error" in res) {
        return { ok: false, rowCount: 0, latencyMs: 0, reason: res.error };
      }
      const count = Number(res.data?.invoiceCount ?? 0);
      return { ok: true, rowCount: count, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 7, // shop can be quiet for a stretch
    kind: "bridge",
  },
  {
    name: "bridge.attention_needed",
    label: "queryNick(attention_needed)",
    probe: timed(async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const res = await queryNick<{ items?: unknown[] }>("attention_needed");
      if ("error" in res) {
        return { ok: false, rowCount: 0, latencyMs: 0, reason: res.error };
      }
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      // attention_needed legitimately can be 0 (no attention items =
      // shop healthy). A consistent zero is informational, not an
      // alert. Threshold is high.
      return { ok: true, rowCount: items.length, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 14,
    kind: "bridge",
  },
  // bridge.stale_leads_count probe REMOVED 2026-05-30 · the nickstire
  // bridge exposes no `stale_leads_count` query — it returns HTTP 400
  // "Unknown query" (verified live on /system/health), so this probe was
  // a PERMANENT false P0, not a real health signal. Bridge liveness is
  // already covered by revenue_today + attention_needed above. NOTE: the
  // remaining `stale_leads_count` callers (operating-rhythm.ts,
  // autonomous-engine.ts) hit the same dead query — the stale-leads alert
  // is silently inert. That's a contract gap to resolve separately (add
  // the query to the nickstire bridge, or remap to leads_urgent /
  // attention_needed), NOT a bridge-health problem.

  // ── Service-layer probes ──
  // listCustomers + listLeads currently return empty in production
  // (no nickstire bridge query yet). Probes are still useful — once
  // the bridge wires up, the "empty days" counter resets and the
  // operator can see when each surface goes live.
  {
    name: "service.listCustomers",
    label: "lib/services/customers.listCustomers()",
    probe: timed(async () => {
      const { listCustomers } = await import("@/lib/services/customers");
      const rows = await listCustomers();
      return { ok: true, rowCount: rows.length, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 30, // expect empty until bridge lands
    kind: "shop",
  },
  {
    name: "service.listLeads",
    label: "lib/services/leads.listLeads()",
    probe: timed(async () => {
      const { listLeads } = await import("@/lib/services/leads");
      const rows = await listLeads();
      return { ok: true, rowCount: rows.length, latencyMs: 0 };
    }),
    emptyDaysAlertThreshold: 30,
    kind: "shop",
  },
];

/**
 * Wraps a probe body so the result carries a measured latencyMs.
 * Catches throws and surfaces them as `{ ok: false, reason }` so a
 * single broken probe never breaks the cron.
 */
function timed(
  body: () => Promise<{ ok: boolean; rowCount: number; latencyMs: number; reason?: string }>,
): () => Promise<ProbeResult> {
  return async () => {
    const start = Date.now();
    try {
      const out = await body();
      return { ...out, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        rowCount: 0,
        latencyMs: Date.now() - start,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

/** Run all probes in parallel and persist per-probe results. */
export async function runHealthProbes(): Promise<{
  total: number;
  ok: number;
  failed: number;
  empty: number;
  results: Array<ProbeResult & { name: string; kind: ProbeSpec["kind"] }>;
}> {
  const results = await Promise.all(
    PROBES.map(async (spec) => {
      const r = await spec.probe();
      return { ...r, name: spec.name, kind: spec.kind };
    }),
  );

  // Persist results — one row per probe per ET date so a streak query
  // can count consecutive empty days.
  const dateKey = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  for (const r of results) {
    const key = `${r.name}_${dateKey}`;
    await prisma.brainMemory
      .upsert({
        where: { category_key: { category: "data_source_probe", key } },
        create: {
          category: "data_source_probe",
          key,
          content: JSON.stringify({
            probe: r.name,
            kind: r.kind,
            ok: r.ok,
            rowCount: r.rowCount,
            latencyMs: r.latencyMs,
            reason: r.reason,
            at: new Date().toISOString(),
          }),
          confidence: 1.0,
          source: "cron:data-source-health",
          // category-ttl.ts declares 30d for this category, but the GC
          // only honors expiresAt — rows written without it accumulated
          // forever (6/day, date-keyed, never re-hit by the upsert).
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          content: JSON.stringify({
            probe: r.name,
            kind: r.kind,
            ok: r.ok,
            rowCount: r.rowCount,
            latencyMs: r.latencyMs,
            reason: r.reason,
            at: new Date().toISOString(),
          }),
        },
      })
      .catch((err) => {
        log.warn("probe_persist_failed", {
          probe: r.name,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    empty: results.filter((r) => r.ok && r.rowCount === 0).length,
    results,
  };
}

/** Expose probe specs for dashboard rendering. */
export function getProbeSpecs(): Array<Omit<ProbeSpec, "probe">> {
  return PROBES.map(({ probe: _probe, ...rest }) => rest);
}

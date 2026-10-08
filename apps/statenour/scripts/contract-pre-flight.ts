/**
 * Contract pre-flight · v10.0.336 · Phase 1 of glitch taxonomy hardening.
 *
 * Pings every nickstire bridge action enumerated in
 * docs/NICKSTIRE-QUERY-CONTRACT.md · reports each as ✅ available, ⚠️
 * unknown-query (nickstire side hasn't shipped it yet · expected for
 * "newly required" actions per the contract), ❌ unexpected error.
 *
 * Run modes:
 *   · `pnpm tsx scripts/contract-pre-flight.ts` · standard run, exits
 *     0 on all-good, 1 on any unexpected failure (unknown queries are
 *     EXPECTED for not-yet-shipped actions and don't fail the run).
 *   · `pnpm tsx scripts/contract-pre-flight.ts --strict` · also fails
 *     on unknown-query errors. Useful when nickstire claims all actions
 *     have shipped and we want to verify.
 *   · `pnpm tsx scripts/contract-pre-flight.ts --json` · machine-
 *     readable output for piping into dashboards / CI.
 *
 * Future: wire as step 16 of the pre-push gate (`scripts/pre-push-check.sh`).
 *
 * Why this exists · the v10.0.331 incident · the chat HUD called
 * `revenue_week` (NOT in the contract) every 30s · we only noticed
 * during a manual investigation. With this script, the drift surfaces
 * at boot/deploy instead of in the operator's daily workflow.
 *
 * Per docs/glitch-taxonomy.md · Category 1 (contract drift).
 */

import { queryNick } from "@/lib/nickstire/query";

interface ActionSpec {
  /** The action name as it appears on the bridge. */
  query: string;
  /**
   * Stub filters that should be safe to send for testing. Pick small/
   * cheap params that won't trigger heavy queries (e.g. window: "today"
   * not "30d").
   */
  filters?: Record<string, unknown>;
  /** Tier · "production" expects success · "newly-required" allows unknown-query. */
  tier: "production" | "newly-required" | "primary-metric";
  /** Where it's used in the codebase (helps debugging when it breaks). */
  consumer: string;
}

// Source-of-truth: docs/NICKSTIRE-QUERY-CONTRACT.md (lines 41-64)
// When the contract changes, update both this list AND the markdown.
const ACTIONS: ActionSpec[] = [
  // ── Business landscape primary metrics ────────────────────────────
  {
    query: "cars_today",
    tier: "production",
    consumer: "<CarsTodayCard> HQ surface",
  },
  {
    query: "estimates_conversion",
    filters: { window: "7d" },
    tier: "production",
    consumer: "HQ conversion tracker",
  },
  {
    query: "estimates_aging",
    filters: { olderThanHours: 48 },
    tier: "production",
    consumer: "Aging-estimate leaderboard",
  },
  {
    query: "drop_off_ratio",
    filters: { window: "today" },
    tier: "production",
    consumer: "Business DNA metric #5",
  },

  // ── Existing actions (already in production use) ───────────────────
  { query: "revenue_today", tier: "production", consumer: "tools.ts, dashboards" },
  {
    query: "revenue_range",
    filters: {
      from: new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    },
    tier: "production",
    consumer: "weeklyReview tool, /api/system/hud (v10.0.331+)",
  },
  { query: "shop_pulse", tier: "production", consumer: "HQ SituationCard" },
  { query: "attention_needed", tier: "production", consumer: "morning brief" },
  {
    query: "lot_brief",
    tier: "production",
    consumer: "morning brief shop slice (camera audit N4, 2026-10-08)",
  },
  { query: "bookings_today", tier: "production", consumer: "EOD debrief" },
  { query: "leads_today", tier: "production", consumer: "EOD debrief" },
  { query: "leads_urgent", tier: "production", consumer: "morning brief" },
  { query: "callbacks_pending", tier: "production", consumer: "morning brief" },
  { query: "work_orders_active", tier: "production", consumer: "Ultron pulse" },
  {
    query: "customer_search",
    filters: { phone: "555-0000", limit: 1 },
    tier: "production",
    consumer: "repeat-customer detection",
  },

  // ── Newly required (nickstire-side may not have shipped yet) ──────
  {
    query: "quotes_pending",
    tier: "newly-required",
    consumer: "predictive-prefetch QUOTES & REVENUE",
  },
  {
    query: "quotes_booked_week",
    tier: "newly-required",
    consumer: "predictive-prefetch revenue trend",
  },
  {
    query: "quotes_stale",
    filters: { olderThanDays: 7 },
    tier: "newly-required",
    consumer: "predictive-prefetch aging",
  },
  {
    query: "leads_open",
    tier: "newly-required",
    consumer: "predictive-prefetch (HUD before v10.0.331 fix)",
  },
  {
    query: "leads_overdue_count",
    tier: "newly-required",
    consumer: "predictive-prefetch",
  },
  {
    query: "leads_today_count",
    tier: "newly-required",
    consumer: "pipeline-controller lead-surge",
  },
  {
    query: "leads_week_count",
    tier: "newly-required",
    consumer: "pipeline-controller lead-surge",
  },
];

interface ProbeResult {
  query: string;
  tier: ActionSpec["tier"];
  consumer: string;
  status: "available" | "unknown-query" | "error";
  durationMs: number;
  errorMessage?: string;
}

async function probe(action: ActionSpec): Promise<ProbeResult> {
  const startedAt = Date.now();
  const result = await queryNick(action.query, action.filters ?? {}, 10000);
  const durationMs = Date.now() - startedAt;

  if ("error" in result) {
    const isUnknownQuery = /unknown query/i.test(result.error);
    return {
      query: action.query,
      tier: action.tier,
      consumer: action.consumer,
      status: isUnknownQuery ? "unknown-query" : "error",
      durationMs,
      errorMessage: result.error.slice(0, 200),
    };
  }

  return {
    query: action.query,
    tier: action.tier,
    consumer: action.consumer,
    status: "available",
    durationMs,
  };
}

function fmtStatus(s: ProbeResult["status"]): string {
  if (s === "available") return "✅ ok";
  if (s === "unknown-query") return "⚠️  unknown-query";
  return "❌ error";
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const json = args.includes("--json");

  if (!process.env.STATENOUR_SYNC_KEY && !process.env.BRIDGE_API_KEY) {
    console.error(
      "[contract-pre-flight] STATENOUR_SYNC_KEY (or BRIDGE_API_KEY) not set · cannot probe.",
    );
    process.exit(2);
  }

  if (!json) {
    console.log(
      `\n🔍 contract pre-flight · ${ACTIONS.length} actions · ` +
        `mode=${strict ? "strict" : "default"}\n`,
    );
  }

  const results: ProbeResult[] = [];
  for (const action of ACTIONS) {
    const r = await probe(action);
    results.push(r);
    if (!json) {
      const tierLabel = `[${r.tier}]`.padEnd(20);
      const queryLabel = r.query.padEnd(28);
      const status = fmtStatus(r.status).padEnd(20);
      const time = `${r.durationMs}ms`.padStart(7);
      console.log(`  ${tierLabel} ${queryLabel} ${status} ${time}`);
      if (r.errorMessage && r.status === "error") {
        console.log(`    └─ ${r.errorMessage}`);
      }
    }
  }

  // Summary
  const available = results.filter((r) => r.status === "available");
  const unknown = results.filter((r) => r.status === "unknown-query");
  const errored = results.filter((r) => r.status === "error");

  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: {
            total: results.length,
            available: available.length,
            unknownQuery: unknown.length,
            errored: errored.length,
          },
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n📊 ${available.length}/${results.length} available · ` +
        `${unknown.length} unknown-query · ${errored.length} errors\n`,
    );
    if (unknown.length > 0) {
      console.log("⚠️  Pending nickstire-side implementation:");
      for (const u of unknown) {
        console.log(`    · ${u.query} (${u.consumer})`);
      }
      console.log("");
    }
    if (errored.length > 0) {
      console.log("❌ Unexpected errors (investigate):");
      for (const e of errored) {
        console.log(`    · ${e.query}: ${e.errorMessage}`);
      }
      console.log("");
    }
  }

  // Exit code
  // - errored = always fails (real problems)
  // - unknown-query = fails only in strict mode (drift signal)
  if (errored.length > 0) process.exit(1);
  if (strict && unknown.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("[contract-pre-flight] fatal:", err);
  process.exit(2);
});

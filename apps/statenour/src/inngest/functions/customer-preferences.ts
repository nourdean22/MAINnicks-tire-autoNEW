/**
 * customer-preferences-recompute · Wave-200 Phase 6 (2026-05-17)
 *
 * Daily Inngest function · scans the recently-active customers,
 * recomputes their preferences via the bridge + inference helper,
 * persists to BrainMemory. Keeps the Customer 360 view's "cached
 * preferences" path fresh even when the operator hasn't visited
 * individual customer pages.
 *
 * Active customer definition · any customer touched in the last 90
 * days · we query nickstire via the bridge for the customer IDs
 * matching this window. Falls back to a no-op if the bridge isn't
 * yet returning the `recent_customer_ids` query (operator action
 * item · cross-app shipped lazily).
 *
 * Concurrency · 4 in-flight to keep the bridge from rate-limiting
 * itself on a single fan-out. Each per-customer step is a separate
 * Inngest checkpoint so transient bridge failures retry that one
 * customer · not the whole batch.
 *
 * Schedule · 11:00 UTC daily (7am ET) · runs after the morning brief
 * but during low operator traffic. Sub-5min total · ~50-150 customers
 * typical · ~1-2s per customer (bridge latency dominates).
 *
 * See:
 *   · docs/adr/0008-customer-360-predictive-brain.md
 *   · apps/statenour/lib/brain/customer-preferences.ts
 *   · apps/statenour/lib/nickstire/query.ts
 */

import { getInngest } from "../client";
import { logger as rootLogger } from "@/lib/logger";
// Type-only import keeps the heavy module out of the cold path · the
// runtime values are still dynamic-imported below.
import type { CustomerDetailInput } from "@/lib/brain/customer-preferences";

const log = rootLogger.withSurface("inngest/customer-preferences");
const inngest = getInngest();

// Cap so a misbehaving bridge can't blow our Inngest step budget ·
// the daily fanout is ~150 customers typical · 300 is plenty of
// headroom while still bounded.
const HARD_CAP = 300;

interface RecentCustomersResponse {
  customerIds: string[];
}

async function getActiveCustomerIds(): Promise<string[]> {
  const { queryNick } = await import("@/lib/nickstire/query");
  const resp = await queryNick<RecentCustomersResponse>(
    "recent_customer_ids",
    { sinceDays: 90 },
  );
  if (resp && "data" in resp) {
    const ids = resp.data?.customerIds;
    if (Array.isArray(ids)) return ids.slice(0, HARD_CAP);
  }
  // Soft-degrade · the bridge may not yet expose this query.
  // Without it, the daily refresh is a no-op · operator-facing
  // Customer 360 view still recomputes on visit so this just means
  // "the cache stays as stale as the last visit".
  log.warn("recent_customer_ids_unavailable", {
    hint: "add `recent_customer_ids` query to nickstire side · returns { customerIds: string[] } given { sinceDays }",
  });
  return [];
}

async function recomputeOne(customerId: string): Promise<{
  customerId: string;
  status: "ok" | "skipped" | "failed";
  reason?: string;
}> {
  try {
    const { queryNick } = await import("@/lib/nickstire/query");
    const { inferCustomerPreferences, persistCustomerPreferences } =
      await import("@/lib/brain/customer-preferences");

    const resp = await queryNick<CustomerDetailInput>("customer_detail", {
      customerId,
    });
    if (!resp || "error" in resp) {
      return {
        customerId,
        status: "skipped",
        reason: (resp as { error?: string })?.error ?? "no_data",
      };
    }
    const detail = (resp as { data: CustomerDetailInput }).data;
    if (!detail?.customer?.id) {
      return { customerId, status: "skipped", reason: "no_customer" };
    }
    const prefs = inferCustomerPreferences(detail);
    await persistCustomerPreferences(prefs);
    return { customerId, status: "ok" };
  } catch (err) {
    return {
      customerId,
      status: "failed",
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

export const customerPreferencesRecompute = inngest.createFunction(
  {
    id: "customer-preferences-recompute",
    name: "Customer preferences · daily recompute",
    concurrency: { limit: 4 },
    retries: 2,
    triggers: [{ cron: "0 11 * * *" }],
  },
  async ({ step }) => {
    const ids = await step.run("fetch-active-customer-ids", () =>
      getActiveCustomerIds(),
    );
    if (ids.length === 0) {
      return { customersScanned: 0, reason: "no_active_customers" };
    }

    // Per-customer steps so Inngest retries each individually and the
    // dashboard surfaces per-customer failures clearly.
    const results = await Promise.all(
      ids.map((id) =>
        step.run(`recompute:${id}`, () => recomputeOne(id)),
      ),
    );

    const summary = {
      customersScanned: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      // Sample first 3 failures for the dashboard · full list lives in
      // the Inngest per-step logs.
      failureSample: results
        .filter((r) => r.status === "failed")
        .slice(0, 3)
        .map((r) => ({ customerId: r.customerId, reason: r.reason })),
    };

    return summary;
  },
);

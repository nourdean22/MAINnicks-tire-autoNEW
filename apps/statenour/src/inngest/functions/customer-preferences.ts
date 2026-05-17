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
import { onInngestFailure } from "../on-failure";
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

interface ActiveIdsResult {
  ids: string[];
  /** "ok" · query returned shape, may have 0 ids.
   *  "missing_query" · bridge soft-degrade · nickstire-side handler
   *    not shipped · this is the documented operator action item,
   *    not an error.
   *  "bridge_down" · bridge unreachable · should retry. */
  source: "ok" | "missing_query" | "bridge_down";
}

async function getActiveCustomerIds(): Promise<ActiveIdsResult> {
  const { queryNick } = await import("@/lib/nickstire/query");
  const resp = await queryNick<RecentCustomersResponse>(
    "recent_customer_ids",
    { sinceDays: 90 },
  );
  if (resp && "data" in resp) {
    const ids = resp.data?.customerIds;
    if (Array.isArray(ids)) return { ids: ids.slice(0, HARD_CAP), source: "ok" };
  }
  const err = resp as { error?: string; statusCode?: number };
  // 2026-05-17 follow-up · distinguish "bridge soft-degrade · missing
  // query handler" (operator action item · documented · not noise)
  // from "bridge unreachable" (real failure · should retry · surfaces
  // differently in the Inngest dashboard).
  if (
    err.statusCode === 400 &&
    typeof err.error === "string" &&
    /unknown query/i.test(err.error)
  ) {
    log.info("recent_customer_ids_unavailable", {
      hint: "operator action item · nickstire side adds `recent_customer_ids` query handler",
    });
    return { ids: [], source: "missing_query" };
  }
  log.warn("recent_customer_ids_bridge_error", {
    statusCode: err.statusCode,
    err: err.error?.slice(0, 200),
  });
  // Throw so Inngest retries · 5xx and timeouts both land here.
  throw new Error(
    `bridge_unreachable · ${err.error?.slice(0, 200) ?? "unknown"}`,
  );
}

async function recomputeOne(customerId: string): Promise<{
  customerId: string;
  status: "ok" | "skipped" | "failed";
  reason?: string;
}> {
  // 2026-05-17 follow-up · transient bridge / DB errors THROW so the
  // per-step Inngest retry kicks in · permanent errors (no_customer ·
  // bad shape) return failed cleanly to surface in the dashboard
  // summary without burning retries.
  const { queryNick } = await import("@/lib/nickstire/query");
  const { inferCustomerPreferences, persistCustomerPreferences } = await import(
    "@/lib/brain/customer-preferences"
  );

  const resp = await queryNick<CustomerDetailInput>("customer_detail", {
    customerId,
  });
  if (resp && "error" in resp) {
    const err = resp as { error: string; statusCode?: number };
    // 5xx or transport failures · retry by throwing.
    if (!err.statusCode || err.statusCode >= 500) {
      throw new Error(`bridge_transient · ${err.error?.slice(0, 200)}`);
    }
    // 4xx is permanent · return clean.
    return {
      customerId,
      status: "skipped",
      reason: err.error ?? "no_data",
    };
  }
  const detail = (resp as { data: CustomerDetailInput })?.data;
  if (!detail?.customer?.id) {
    return { customerId, status: "skipped", reason: "no_customer" };
  }
  const prefs = inferCustomerPreferences(detail);
  // persistCustomerPreferences now THROWS on DB error (Wave-200 follow-up).
  // Allow it to propagate · Inngest retries the step.
  await persistCustomerPreferences(prefs);
  return { customerId, status: "ok" };
}

/** Sanitize a customer ID into a stable Inngest step ID. */
function customerStepId(customerId: string): string {
  return `recompute_${customerId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export const customerPreferencesRecompute = inngest.createFunction(
  {
    id: "customer-preferences-recompute",
    name: "Customer preferences · daily recompute",
    concurrency: { limit: 4 },
    retries: 2,
    triggers: [{ cron: "0 11 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const { ids, source } = await step.run("fetch-active-customer-ids", () =>
      getActiveCustomerIds(),
    );
    if (ids.length === 0) {
      return {
        customersScanned: 0,
        reason:
          source === "missing_query"
            ? "bridge_query_unavailable"
            : "no_active_customers",
      };
    }

    // Per-customer steps so Inngest retries each individually and the
    // dashboard surfaces per-customer failures clearly. Step IDs are
    // sanitized so customer IDs containing `/`, `?`, `=`, or other
    // special chars don't break Inngest's checkpoint key handling.
    const results = await Promise.all(
      ids.map((id) =>
        step.run(customerStepId(id), () => recomputeOne(id)),
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

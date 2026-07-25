/**
 * Customer service · v10.0.53 · Wave A · cleanup.
 *
 * Pre-cleanup: 250 lines, 5 exports (listCustomers, getCustomerById,
 * getDormantCustomers, createCustomer, updateCustomer, deleteCustomer)
 * — all production paths were dead `Promise.resolve(...)` placeholders
 * since the customer table moved to nickstire (TiDB on Railway).
 *
 * Post-cleanup: 2 exports — `listCustomers` + `getDormantCustomers`,
 * the only ones with external consumers (lib/services/dashboard.ts
 * → /api/command/data + /api/ai/operator-brief). The four orphans
 * (getCustomerById, createCustomer, updateCustomer, deleteCustomer)
 * are deleted: they had no callers and CRUD belongs on nickstire
 * admin per the personal/business separation.
 *
 * Production-mode behavior: returns empty array + warn-logs once.
 * Demo mode: unchanged. Consumers (dashboard counts, dormant card)
 * already handle empty cleanly — counts show 0, dormant list hides.
 *
 * The honest empty + clear warning is intentional. Dashboard cards
 * fed by these in production still render with the empty state
 * instead of crashing or pretending to have data. Operator can see
 * the warn line in /system/errors.
 */

import { getDemoState, type DemoCustomer } from "@/lib/demo-store";
import { isDemoMode } from "@/lib/runtime";
import { scanDormantCustomers } from "@/lib/scoring/dormant-customers";
import { serializeForJson } from "@/lib/utils/serialize";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/customers");

// Once-per-process warn so /system/errors gets one signal that the
// nickstire customers bridge is missing, not a flood every request.
let warnedMissingBridge = false;
function warnMissingBridge(method: string) {
  if (warnedMissingBridge) return;
  warnedMissingBridge = true;
  log.warn("bridge_missing", {
    method,
    note: "customer data lives on nickstire admin; no bridge query exposed yet · returning empty",
  });
}

 
function decorateCustomers(customers: Array<DemoCustomer> | any[]) {
  const dormantView = scanDormantCustomers(serializeForJson(customers));
  const viewMap = new Map(dormantView.map((customer) => [customer.id, customer]));

   
  return serializeForJson(customers).map((customer: any) => ({
    ...customer,
    ...viewMap.get(customer.id),
  }));
}

export async function listCustomers() {
  if (isDemoMode) {
    return decorateCustomers(
      [...getDemoState().customers].sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      ),
    );
  }
  warnMissingBridge("listCustomers");
  return decorateCustomers([]);
}

export async function getDormantCustomers(limit = 6) {
  if (isDemoMode) {
    return scanDormantCustomers(serializeForJson(getDemoState().customers))
      .filter((customer) => customer.effectiveRiskStatus !== "HEALTHY")
      .slice(0, limit);
  }
  warnMissingBridge("getDormantCustomers");
  return scanDormantCustomers([])
    .filter((customer) => customer.effectiveRiskStatus !== "HEALTHY")
    .slice(0, limit);
}

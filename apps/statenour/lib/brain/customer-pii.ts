/**
 * Customer identity stays in the shop's own system. bdnick keeps counts and dates, never the
 * person: apps/nickstire/AGENTS.md section 5 asks for customer names and phones to be minimised.
 *
 * Two writers use this: POST /api/sync/business (the 15-minute nickstire payload) and
 * processShopEvent (bridge events into BrainMemory). Existing rows are purged separately.
 */

/** Shown wherever a named line used to be. */
export const SEE_ADMIN_CUSTOMERS = "see Customers in the admin";

const PII_KEYS = new Set(["name", "phone", "customer", "customername", "customerphone", "email", "customeremail"]);

/** Bridge event data without the keys that identify the customer. Top level only: the bridge sends flat objects. */
export function stripEventPii(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !PII_KEYS.has(k.toLowerCase())));
}

function pick(row: unknown, keep: readonly string[]): Record<string, unknown> {
  const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  return Object.fromEntries(keep.filter((k) => k in src).map((k) => [k, src[k]]));
}

/**
 * Allowlists, not denylists, for the two lists nickstire sends as named rows: a field added to
 * the producer later stays out until someone decides it may be stored.
 */
const LIST_KEEP: Record<string, readonly string[]> = {
  atRiskCustomers: ["daysSince", "lastVisit"],
  topSpenders: ["total", "visits"],
};
/** Lists whose rows are otherwise fine; only the identity keys go. */
const LIST_DROP_IDENTITY = new Set(["topItems", "customerJourneys"]);

/** The action plan names the first at-risk customer and the top spender; say how many instead. */
function redactActionPlan(plan: string, atRiskCount: number): string {
  const lines = plan.split("\n").filter((l) => !/^\s*•\s*(CALL NOW|PROTECT):/.test(l));
  if (atRiskCount > 0) {
    const noun = atRiskCount === 1 ? "customer" : "customers";
    lines.push(`• AT-RISK: ${atRiskCount} at-risk ${noun}, ${SEE_ADMIN_CUSTOMERS}.`);
  }
  return lines.join("\n");
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key in LIST_KEEP && Array.isArray(value)) {
      out[key] = value.map((row) => pick(row, LIST_KEEP[key]));
    } else if (LIST_DROP_IDENTITY.has(key) && Array.isArray(value)) {
      out[key] = value.map((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? stripEventPii(row as Record<string, unknown>)
          : row,
      );
    } else if (key !== "actionPlan") {
      out[key] = walk(value);
    }
  }
  if (typeof obj.actionPlan === "string") {
    const atRisk = Array.isArray(obj.atRiskCustomers) ? obj.atRiskCustomers.length : 0;
    out.actionPlan = redactActionPlan(obj.actionPlan, atRisk);
  } else if ("actionPlan" in obj) {
    out.actionPlan = obj.actionPlan;
  }
  return out;
}

/** A nickstire business-sync payload without named customers. Same shape, safe to persist or return. */
export function stripSyncCustomerPii<T>(payload: T): T {
  return walk(payload) as T;
}

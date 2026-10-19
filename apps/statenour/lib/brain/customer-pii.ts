/**
 * Customer identity stays in the shop's own system. bdnick keeps counts and dates, never the
 * person: apps/nickstire/AGENTS.md section 5 asks for customer names and phones to be minimised.
 *
 * Two writers use this: POST /api/sync/business (the 15-minute nickstire payload) and
 * processShopEvent (bridge events into BrainMemory). Existing rows are purged separately.
 */

/** Shown wherever a named line used to be. */
export const SEE_ADMIN_CUSTOMERS = "see Customers in the admin";

const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Free text with phone numbers and email addresses masked. Kept sentences go through this. */
export function scrubText(s: string): string {
  return s.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

function stripIdentityKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !(IDENTITY_KEY.test(k) && !ID_KEY.test(k))));
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
/**
 * Dropped at any depth: nickstire memories and operator patterns quote customers by name inside
 * free text, and decline reasons / recovery notes are staff-written sentences about a person.
 */
const SYNC_DROP_KEYS = new Set(["nickAI", "operatorPatterns", "recoveryNotes", "declineReason"]);

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
    if (SYNC_DROP_KEYS.has(key)) continue;
    if (key in LIST_KEEP && Array.isArray(value)) {
      out[key] = value.map((row) => pick(row, LIST_KEEP[key]));
    } else if (LIST_DROP_IDENTITY.has(key) && Array.isArray(value)) {
      out[key] = value.map((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? (walk(stripIdentityKeys(row as Record<string, unknown>)) as Record<string, unknown>)
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

/**
 * Keys that name a person or a way to reach one. Matched on the whole key, lower-cased, so an id
 * such as `customerId` (a pseudonymous row id) is kept by the id rule below while `customerName`,
 * `phone`, `contact`, `callerPhone` and `reviewerEmail` go.
 */
const IDENTITY_KEY = /(name|phone|mobile|email|contact|customer|caller|reviewer|address|owner|driver|person|who)/i;
const ID_KEY = /^(id|[a-z][a-zA-Z]*Id|[a-z][a-z0-9]*_id|refCode|invoiceNumber|orderNumber|workOrderId)$/;
/**
 * String-valued facts a bridge event may carry. Anything else under an unknown key is dropped.
 * `reason`, `description`, `reviewText`, `symptom` and `problem` are NOT here: they are sentences a
 * customer or staff member typed, and scrubText masks only phones and emails, so a name written in one
 * would be stored. The pipeline reads them from the in-memory event.data, never from this projection.
 */
const SAFE_STRING_KEYS = new Set([
  "type", "timestamp", "source", "kind", "status", "service", "interest", "vehicle", "urgency", "stage",
  "tire", "method", "campaignType", "fromStatus", "toStatus",
  "imageUrl", "scheduledFor", "publishedAt", "state", "platform", "eventId",
]);
/** Free text a social draft legitimately carries; every other event type drops these keys. */
const DRAFT_TEXT_KEYS = new Set(["text", "content"]);

/**
 * The bridge event payload that is allowed into the audit log: ids, counts, amounts and the named
 * event facts above. Names, phones, emails and unknown free-text keys never reach a stored row
 * (the alert and the brain pipeline still get the full `event.data` in memory). The projection is
 * an allowlist for strings; numbers, booleans and null under a non-identity key are kept as counts.
 */
export function scrubBridgePayload(value: unknown, opts: { keepText?: boolean } = {}): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => (v && typeof v === "object" ? scrubBridgePayload(v, opts) : v)).filter((v) => typeof v !== "string");
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEY.test(key) && !ID_KEY.test(key)) continue;
    if (v && typeof v === "object") out[key] = scrubBridgePayload(v, opts);
    else if (typeof v === "string") {
      if (SAFE_STRING_KEYS.has(key) || ID_KEY.test(key) || (opts.keepText && DRAFT_TEXT_KEYS.has(key))) out[key] = scrubText(v);
    } else out[key] = v;
  }
  return out;
}

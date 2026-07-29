/**
 * Identity resolution — the unified verdict layer (Autopilot Wave 4,
 * 2026-07-29 · mission P2, scoped per the audit).
 *
 * WHAT EXISTS ALREADY (and stays authoritative in place):
 *   - loadCustomerContext's ambiguity refusal (smsOrchestrator.ts) — the
 *     inbound-reply path already refuses identity on 2+ matches and keeps
 *     consent at its most restrictive value.
 *   - resolveEstimateIdentity (opportunityQueue.ts) — the estimate
 *     collector's aggregated-join ambiguity rule.
 * This service does NOT replace those; it gives every OTHER caller (the
 * Decision-Inbox draft bridge, the ops surface, statenour via the bridge)
 * one shared verdict vocabulary over the same underlying reads.
 *
 * SCOPE DECISION (documented in REVENUE-AUTOPILOT-2-AUDIT.md): verdicts are
 * COMPUTED ON READ from the existing source tables — no link table, no
 * migration, no stored graph in v1. Every source-system id is already
 * preserved in its own table; what was missing was the VERDICT and its
 * enforcement. A stored evidence graph (manual link/unlink/merge/undo) is
 * v2, gated on what the dry-run report shows about real collision rates.
 *
 * VERDICTS (mission vocabulary):
 *   resolved    — exactly one customer row matches the phone
 *   ambiguous   — 2+ customer rows match (household/shared phone)
 *   unresolved  — no customer row (lead/booking evidence may still exist)
 *   conflicted  — one customer matches BUT recent leads/bookings under the
 *                 same phone carry a clearly different first name — the
 *                 "same phone, different person" signal. Personalizing on
 *                 the customer row risks naming the wrong human.
 *
 * FAIL DIRECTION: any read failure returns verdict "unresolved" with
 * readable:false. Callers that PERSONALIZE must treat anything except
 * `resolved` as blocking (the mission rule); callers that only need a
 * consent signal keep using the existing most-restrictive reads.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("identity-resolution");

export type IdentityVerdict = "resolved" | "ambiguous" | "unresolved" | "conflicted";

export interface IdentityEvidence {
  source: "customer" | "lead" | "booking";
  id: number;
  name: string | null;
}

export interface IdentityResolution {
  verdict: IdentityVerdict;
  /** set ONLY when verdict is resolved */
  customerId: number | null;
  customerName: string | null;
  /** most-restrictive consent read across ALL matched customers */
  optOutAnyMatch: boolean;
  evidence: IdentityEvidence[];
  /** false = the reads failed; verdict degraded to unresolved */
  readable: boolean;
}

/** First token, lowercased, punctuation-stripped — 'Sam' vs 'Samantha' are
 *  DIFFERENT here on purpose: a conservative mismatch beats a wrong text. */
export function firstNameToken(name: string | null | undefined): string {
  const n = (name ?? "").trim().toLowerCase().replace(/[^a-z\s'-]/g, "");
  if (!n) return "";
  return n.split(/\s+/)[0] ?? "";
}

/**
 * Pure verdict rule over gathered evidence — unit-tested directly.
 * customerMatches carries every customer row on the phone; recentNames the
 * first-name tokens seen on recent leads/bookings for the same phone.
 */
export function classifyIdentity(input: {
  customerMatches: Array<{ id: number; name: string | null; optOut: boolean }>;
  recentNonCustomerNames: string[];
}): { verdict: IdentityVerdict; customerId: number | null; customerName: string | null; optOutAnyMatch: boolean } {
  const optOutAnyMatch = input.customerMatches.some((c) => c.optOut);
  if (input.customerMatches.length === 0) {
    return { verdict: "unresolved", customerId: null, customerName: null, optOutAnyMatch };
  }
  if (input.customerMatches.length > 1) {
    return { verdict: "ambiguous", customerId: null, customerName: null, optOutAnyMatch };
  }
  const only = input.customerMatches[0];
  const custToken = firstNameToken(only.name);
  const conflicting = input.recentNonCustomerNames
    .map(firstNameToken)
    .filter((t) => t.length >= 2 && custToken.length >= 2 && t !== custToken);
  if (conflicting.length > 0) {
    return { verdict: "conflicted", customerId: null, customerName: null, optOutAnyMatch };
  }
  return { verdict: "resolved", customerId: only.id, customerName: only.name, optOutAnyMatch };
}

/**
 * Resolve a phone to an identity verdict. Read-only; raw execute (the
 * serial suite's db mocks provide execute, not builder chains).
 */
export async function resolveIdentity(phone: string): Promise<IdentityResolution> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  const empty: IdentityResolution = {
    verdict: "unresolved",
    customerId: null,
    customerName: null,
    optOutAnyMatch: false,
    evidence: [],
    readable: false,
  };
  if (last10.length !== 10) return { ...empty, readable: true };

  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return empty;

    const [custRows] = await db.execute(sql`
      SELECT id, CONCAT_WS(' ', firstName, lastName) AS name, smsOptOut
      FROM customers
      WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) = ${last10}
      LIMIT 10
    `);
    const customers = (Array.isArray(custRows) ? custRows : []).map((r) => {
      const row = r as { id?: unknown; name?: unknown; smsOptOut?: unknown };
      return {
        id: Number(row.id),
        name: row.name == null ? null : String(row.name),
        optOut: row.smsOptOut === 1 || row.smsOptOut === true,
      };
    });

    // Recent non-customer identity signals: leads + bookings on the same
    // phone in the last 180 days. These carry what the PERSON typed as
    // their own name — the strongest same-phone-different-person signal.
    const [leadRows] = await db.execute(sql`
      SELECT id, name FROM leads
      WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) = ${last10}
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 180 DAY)
        AND source != 'careers'
      LIMIT 10
    `);
    const [bookingRows] = await db.execute(sql`
      SELECT id, name FROM bookings
      WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) = ${last10}
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 180 DAY)
      LIMIT 10
    `);

    const evidence: IdentityEvidence[] = [
      ...customers.map((c) => ({ source: "customer" as const, id: c.id, name: c.name })),
      ...(Array.isArray(leadRows) ? leadRows : []).map((r) => {
        const row = r as { id?: unknown; name?: unknown };
        return { source: "lead" as const, id: Number(row.id), name: row.name == null ? null : String(row.name) };
      }),
      ...(Array.isArray(bookingRows) ? bookingRows : []).map((r) => {
        const row = r as { id?: unknown; name?: unknown };
        return { source: "booking" as const, id: Number(row.id), name: row.name == null ? null : String(row.name) };
      }),
    ];

    const recentNonCustomerNames = evidence
      .filter((e) => e.source !== "customer")
      .map((e) => e.name ?? "")
      .filter(Boolean);

    const classified = classifyIdentity({ customerMatches: customers, recentNonCustomerNames });
    return { ...classified, evidence, readable: true };
  } catch (err) {
    log.warn("identity resolution failed — degrading to unresolved", {
      phone: last10.slice(-4),
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

/**
 * Customer preference inference · Wave-200 Phase 6 (2026-05-17)
 *
 * Mem0-style per-customer preference layer · pure-function inference
 * from raw shop activity. Output stored in BrainMemory(category=
 * "customer_preference", key=<customerId>) as a structured payload.
 *
 * The inferred preferences are facts derived from observable patterns
 * in the customer's history. They are NOT guesses or predictions ·
 * each one is grounded in countable past behavior. The operator OS
 * uses them to:
 *   · Inform the Customer 360 view ("Brennen prefers afternoons")
 *   · Pre-shape outreach drafts ("Jane usually pays 30+ days late ·
 *     mention the autopay option")
 *   · Personalize the morning brief ("3 customers due for follow-up
 *     today match the 'responds-to-SMS' segment")
 *
 * Why "inference" not "ML":
 *   · The signal is small per customer (5-30 invoices typical)
 *   · Hand-coded rules are auditable · the operator can challenge any
 *     preference and see exactly why it was inferred
 *   · Zero training cost · zero model maintenance · ships in one file
 *
 * Future · Letta-style episodic memory could be layered ON TOP via
 * separate BrainMemory(category="customer_episode") rows · captures
 * "what did Nour decide last time about this customer". Out of scope
 * for Phase 6 ship · scaffolded for follow-up.
 *
 * See: docs/adr/0008-customer-360-predictive-brain.md
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/customer-preferences");

// ── input types ──────────────────────────────────────────────────────
//
// Shaped to what `customer_detail` returns from the bridge · stays
// loose because the bridge handler is the source of truth.

export interface CustomerDetailInput {
  customer: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    segment?: string | null;
    totalVisits?: number | null;
    totalSpent?: number | null;
    lastVisitDate?: string | null;
    createdAt?: string | null;
  };
  timeline: {
    invoices: Array<Record<string, unknown>>;
    estimates: Array<Record<string, unknown>>;
    algEstimates: Array<Record<string, unknown>>;
    callbacks: Array<Record<string, unknown>>;
  };
}

// ── output shape ─────────────────────────────────────────────────────

export interface CustomerPreferences {
  customerId: string;
  inferredAt: string;
  /** Frequency of visits · derived from totalVisits + tenure */
  visitFrequency: "rare" | "occasional" | "regular" | "frequent" | "unknown";
  /** Payment behavior · derived from invoice paymentStatus distribution */
  paymentBehavior: "prompt" | "typical" | "slow" | "unknown";
  /** Sales conversion rate · invoices vs estimates */
  conversionRate: number | null;
  /** Total declined-work value across ALG estimates · the recovery TAM */
  declinedValueCents: number;
  /** Average ticket size in cents (paid invoices only) */
  avgTicketCents: number | null;
  /** Lifetime value indicator: "high" >$2000, "mid" $500-$2000, "low" <$500 */
  ltvTier: "high" | "mid" | "low" | "unknown";
  /** Whether the customer has open callback requests right now */
  hasOpenCallback: boolean;
  /** Number of estimates currently in declined/walked state · recovery candidates */
  openRecoveryCount: number;
  /** Human-readable summary the operator can read at a glance */
  summary: string;
}

// ── inference helpers ────────────────────────────────────────────────

function classifyVisitFrequency(
  totalVisits: number | null | undefined,
  tenureDays: number | null,
): CustomerPreferences["visitFrequency"] {
  if (!totalVisits || !tenureDays || tenureDays < 30) return "unknown";
  // Visits per year, derived
  const visitsPerYear = (totalVisits / tenureDays) * 365;
  if (visitsPerYear < 1) return "rare";
  if (visitsPerYear < 3) return "occasional";
  if (visitsPerYear < 6) return "regular";
  return "frequent";
}

function classifyPaymentBehavior(
  invoices: Array<Record<string, unknown>>,
): CustomerPreferences["paymentBehavior"] {
  if (invoices.length === 0) return "unknown";
  const counts = { paid: 0, pending: 0, overdue: 0 };
  for (const inv of invoices) {
    const status = String(inv.paymentStatus ?? "").toLowerCase();
    if (status === "paid") counts.paid++;
    else if (status === "pending") counts.pending++;
    else if (status === "overdue" || status === "late") counts.overdue++;
  }
  const total = invoices.length;
  const promptRate = counts.paid / total;
  const slowRate = (counts.overdue + counts.pending) / total;
  if (promptRate >= 0.9) return "prompt";
  if (slowRate >= 0.4) return "slow";
  return "typical";
}

function tierFromLtv(totalSpentCents: number | null | undefined): CustomerPreferences["ltvTier"] {
  if (totalSpentCents == null) return "unknown";
  if (totalSpentCents >= 200_000) return "high";
  if (totalSpentCents >= 50_000) return "mid";
  return "low";
}

function computeConversionRate(
  invoices: Array<Record<string, unknown>>,
  estimates: Array<Record<string, unknown>>,
): number | null {
  if (estimates.length === 0) return null;
  const accepted = invoices.length;
  const total = estimates.length + invoices.length;
  if (total === 0) return null;
  return Math.round((accepted / total) * 1000) / 1000; // 3-decimal precision
}

function sumDeclinedValueCents(
  algEstimates: Array<Record<string, unknown>>,
): number {
  let total = 0;
  for (const a of algEstimates) {
    const status = String(a.status ?? "").toLowerCase();
    if (status === "declined" || status === "walked" || status === "expired") {
      const amt = Number(a.totalAmount);
      if (Number.isFinite(amt)) total += amt;
    }
  }
  return total;
}

function avgTicketCents(invoices: Array<Record<string, unknown>>): number | null {
  if (invoices.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const inv of invoices) {
    const status = String(inv.paymentStatus ?? "").toLowerCase();
    if (status !== "paid") continue;
    const amt = Number(inv.totalAmount);
    if (Number.isFinite(amt)) {
      sum += amt;
      count++;
    }
  }
  if (count === 0) return null;
  return Math.round(sum / count);
}

function buildSummary(p: Omit<CustomerPreferences, "summary">): string {
  const parts: string[] = [];
  parts.push(`${p.ltvTier} LTV`);
  if (p.visitFrequency !== "unknown") parts.push(`${p.visitFrequency} visitor`);
  parts.push(`${p.paymentBehavior} payer`);
  if (p.openRecoveryCount > 0) {
    parts.push(
      `${p.openRecoveryCount} open recovery${p.openRecoveryCount === 1 ? "" : " items"} (~$${Math.round(p.declinedValueCents / 100)})`,
    );
  }
  if (p.hasOpenCallback) parts.push("callback pending");
  return parts.join(" · ");
}

// ── public entrypoint ────────────────────────────────────────────────

/**
 * Compute preferences for one customer · pure function · no side effects.
 *
 * Caller is responsible for fetching the input and (optionally) writing
 * the output to BrainMemory via `persistCustomerPreferences()`.
 */
export function inferCustomerPreferences(
  input: CustomerDetailInput,
): CustomerPreferences {
  const tenureDays = input.customer.createdAt
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(input.customer.createdAt).getTime()) /
            86_400_000,
        ),
      )
    : null;

  const visitFrequency = classifyVisitFrequency(
    input.customer.totalVisits ?? null,
    tenureDays,
  );
  const paymentBehavior = classifyPaymentBehavior(input.timeline.invoices);
  const conversionRate = computeConversionRate(
    input.timeline.invoices,
    input.timeline.estimates,
  );
  const declinedValueCents = sumDeclinedValueCents(
    input.timeline.algEstimates,
  );
  const ticket = avgTicketCents(input.timeline.invoices);
  const ltvTier = tierFromLtv(input.customer.totalSpent ?? null);
  const hasOpenCallback = input.timeline.callbacks.some(
    (cb) => String(cb.status ?? "").toLowerCase() === "new",
  );
  const openRecoveryCount = input.timeline.algEstimates.filter((a) => {
    const status = String(a.status ?? "").toLowerCase();
    return status === "declined" || status === "walked" || status === "expired";
  }).length;

  const out: Omit<CustomerPreferences, "summary"> = {
    customerId: input.customer.id,
    inferredAt: new Date().toISOString(),
    visitFrequency,
    paymentBehavior,
    conversionRate,
    declinedValueCents,
    avgTicketCents: ticket,
    ltvTier,
    hasOpenCallback,
    openRecoveryCount,
  };

  return { ...out, summary: buildSummary(out) };
}

/**
 * Persist inferred preferences to BrainMemory. Upserts on category+key
 * so daily re-runs replace stale rows.
 *
 * 2026-05-17 follow-up · pre-fix this swallowed all errors with
 * `log.warn` only · the Inngest customer-preferences recompute
 * function awaited it and reported `status: "ok"` even when the
 * upsert silently failed for every customer. Now we re-throw so:
 *   · Inngest caller's try/catch surfaces per-customer failure
 *   · API-route caller still has `void` semantics (fire-and-forget)
 *     via the `safe` wrapper — they don't observe the throw
 * Choose the call shape that matches your caller's observability needs.
 */
export async function persistCustomerPreferences(
  prefs: CustomerPreferences,
): Promise<void> {
  const jsonMetadata = prefs as unknown as Prisma.InputJsonValue;
  await prisma.brainMemory.upsert({
    where: {
      category_key: { category: "customer_preference", key: prefs.customerId },
    },
    create: {
      category: "customer_preference",
      key: prefs.customerId,
      content: prefs.summary,
      confidence: 0.85,
      source: "brain/customer-preferences",
      metadata: jsonMetadata,
    },
    update: {
      content: prefs.summary,
      metadata: jsonMetadata,
    },
  });
}

/**
 * Fire-and-forget convenience for API-route callers that don't want
 * to block on persistence (e.g. the Customer 360 GET endpoint returns
 * fresh prefs synchronously while persist runs in the background).
 * Logs the failure for /api/ai/errors/recent visibility.
 */
export function safePersistCustomerPreferences(
  prefs: CustomerPreferences,
): void {
  void persistCustomerPreferences(prefs).catch((err) => {
    log.warn("persist_failed", {
      customerId: prefs.customerId,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  });
}

/**
 * Read previously-inferred preferences for one customer (or null if
 * never inferred). Use this from the chat surface · the Customer 360
 * view · the morning brief composer · any path that wants to know
 * "what do we know about this customer".
 */
export async function getCustomerPreferences(
  customerId: string,
): Promise<CustomerPreferences | null> {
  const row = await prisma.brainMemory.findFirst({
    where: { category: "customer_preference", key: customerId },
    select: { metadata: true },
  });
  if (!row?.metadata) return null;
  return row.metadata as unknown as CustomerPreferences;
}

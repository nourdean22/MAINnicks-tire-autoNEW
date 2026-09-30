/**
 * moneyRisks — pure derivation for the "Today's Money Risks" card.
 *
 * Cash-register protection, not vanity metric: answers "what needs attention
 * before it costs us money today?" from data the Today surface already holds.
 *
 * SOURCE · the already-cached `adminDashboard.overviewMediumBundle` (leads +
 * callbacks). The `$ at risk` figure is the SAME derivation LeadsBrief uses
 * (sum of `estimatedValueCents` over uncontacted-new leads past the 4h SLA) —
 * computed here, not invented, so the two surfaces can never disagree.
 *
 * HONESTY · `$ at risk` is only ever > 0 when leads carry a real
 * `estimatedValueCents`; the card renders the dollar line only when it is.
 * `deriveMoneyRisks` returns `topItem === null` when nothing is at risk, and
 * the component hides the whole card in that case (no empty vanity card).
 *
 * Pure + side-effect-free so the thresholds below are unit-tested in
 * client/src/__tests__/money-risks.test.ts.
 */

import { isCallbackDuplicateLead } from "@shared/leadSource";
import { type TileProvenance, provenanceOf } from "@shared/tileProvenance";
import { tileMetricProvenance } from "./todayPulse";

/** 4h uncontacted = SLA breach. Matches LeadsBrief's red tier + the visual SLA timer. */
export const SLA_BREACH_MS = 4 * 60 * 60 * 1000;
/** A callback left unanswered past 4h is a money risk (missed-call → walk-away). */
export const CALLBACK_WAIT_MS = 4 * 60 * 60 * 1000;
/** $500+ exposed in stale leads escalates the card to high severity. */
export const HIGH_AT_RISK_CENTS = 50_000;

/** Lead statuses that still owe a follow-up (mirror of LeadsBrief active set). */
const STALE_LEAD_STATUS = "new";
/** Callback statuses that are still waiting on the operator. */
const WAITING_CALLBACK_STATUSES = new Set(["new", "pending"]);

/** Narrow structural view of a lead row — assignable from the bundle's Drizzle row. */
export interface RiskLead {
  status: string;
  createdAt: string | Date;
  estimatedValueCents?: number | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Source + callback link — used to exclude callback artifacts that are
   *  already counted on the Callbacks surface (avoids double-counting one
   *  caller as both a stale lead AND a waiting callback). */
  source?: string | null;
  callbackId?: number | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

/** Narrow structural view of a callback row. */
export interface RiskCallback {
  status: string;
  createdAt: string | Date;
  name?: string | null;
  phone?: string | null;
}

export type RiskSeverity = "low" | "medium" | "high";

export interface MoneyRiskItem {
  kind: "lead" | "callback";
  name: string;
  ageMs: number;
  phone: string | null;
}

export interface MoneyRisksResult {
  /** New leads uncontacted past the 4h SLA. */
  staleLeadCount: number;
  /** Callbacks still waiting past 4h. */
  callbacksWaitingCount: number;
  /** Σ estimatedValueCents over stale leads — 0 when no leads carry an estimate. */
  atRiskCents: number;
  /** staleLeadCount + callbacksWaitingCount. */
  totalRisks: number;
  severity: RiskSeverity;
  /** The single oldest/most-urgent item, or null when nothing is at risk. */
  topItem: MoneyRiskItem | null;
  /** Which surface to check first (owns the single oldest item), or null. */
  primary: "leads" | "callbacks" | null;
}

function ageMs(createdAt: string | Date, now: number): number {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  return now - t;
}

function leadName(l: RiskLead): string {
  return (l.name && l.name.trim()) || (l.email && l.email.trim()) || "Lead";
}

/**
 * Reduce the Today bundle's leads + callbacks into the money-risk summary.
 * `now` is injected (not read from the clock) so the thresholds are testable.
 */
export function deriveMoneyRisks(
  leads: RiskLead[] | null | undefined,
  callbacks: RiskCallback[] | null | undefined,
  now: number,
): MoneyRisksResult {
  let staleLeadCount = 0;
  let callbacksWaitingCount = 0;
  let atRiskCents = 0;
  let topItem: MoneyRiskItem | null = null;

  const consider = (candidate: MoneyRiskItem) => {
    if (!topItem || candidate.ageMs > topItem.ageMs) topItem = candidate;
  };

  for (const l of leads ?? []) {
    if (l.status !== STALE_LEAD_STATUS) continue;
    // A callback-form lead linked to a callback_requests row is the SAME person
    // already counted in the callbacks loop below — skip it so one caller isn't
    // counted twice. Voice rack-check leads (no callbackId, no callback_requests
    // row) are NOT excluded — they have no other place to be counted.
    if (isCallbackDuplicateLead(l)) continue;
    const age = ageMs(l.createdAt, now);
    if (age < SLA_BREACH_MS) continue;
    staleLeadCount += 1;
    atRiskCents += l.estimatedValueCents ?? 0;
    consider({ kind: "lead", name: leadName(l), ageMs: age, phone: l.phone ?? null });
  }

  for (const c of callbacks ?? []) {
    if (!WAITING_CALLBACK_STATUSES.has(c.status)) continue;
    const age = ageMs(c.createdAt, now);
    if (age < CALLBACK_WAIT_MS) continue;
    callbacksWaitingCount += 1;
    consider({ kind: "callback", name: (c.name && c.name.trim()) || "Caller", ageMs: age, phone: c.phone ?? null });
  }

  const totalRisks = staleLeadCount + callbacksWaitingCount;

  let severity: RiskSeverity;
  if (atRiskCents >= HIGH_AT_RISK_CENTS || totalRisks >= 4) severity = "high";
  else if (totalRisks >= 2 || atRiskCents > 0) severity = "medium";
  else severity = "low";

  // The single oldest item decides which surface the operator clears first.
  const primary: MoneyRisksResult["primary"] =
    topItem === null ? null : (topItem as MoneyRiskItem).kind === "lead" ? "leads" : "callbacks";

  return { staleLeadCount, callbacksWaitingCount, atRiskCents, totalRisks, severity, topItem, primary };
}

/**
 * Q-23 phase 4 · which bundle reads this card could NOT trust.
 *
 * `overviewMediumBundle` runs leads and callbacks as separate settled reads and
 * reports each in `slices` (server/services/adminBundle.ts). A failed slice
 * arrives as `null`, which `deriveMoneyRisks` reads as an empty list, so a
 * leads-only failure used to render as "no stale leads", and a failure of both
 * as no card at all: the same picture as a clean day. A failed slice is
 * UNKNOWN, never zero.
 *
 * `slices` absent (a server that predates the map) is treated as readable, the
 * behaviour this card always had.
 */
export interface RiskSlices {
  leads?: { available: boolean } | null;
  callbacks?: { available: boolean } | null;
}

export function unreadableRiskSlices(slices: RiskSlices | null | undefined): {
  leads: boolean;
  callbacks: boolean;
} {
  return {
    leads: slices?.leads?.available === false,
    callbacks: slices?.callbacks?.available === false,
  };
}

/**
 * Q-23 phase 5 · the severity badge the card shows. An unread slice may be
 * hiding the worst item, so the badge never reads LOW while one is unread:
 * the floor is MEDIUM. A derived MEDIUM or HIGH is shown as is.
 */
export function displayedRiskSeverity(severity: RiskSeverity, anyUnread: boolean): RiskSeverity {
  return anyUnread && severity === "low" ? "medium" : severity;
}

/**
 * Q-23 phase 4 · the MEASURED / ESTIMATE word each number on this card wears.
 *
 * Both counts are rows the database returned, so they are MEASURED. The dollar
 * figure is the sum of quotes stored on stale leads (`estimatedValueCents` is set
 * only when a quote was given, see opportunityQueue.collectStaleLeads), which is
 * the contract's "Potential pipeline value": quoted work, not money received. The
 * label follows METRICS-CONTRACT.md if the contract ever reclassifies it.
 */
export function moneyRisksProvenance(): {
  staleLeads: TileProvenance;
  callbacksWaiting: TileProvenance;
  atRisk: TileProvenance;
  unreadable: TileProvenance;
} {
  return {
    staleLeads: provenanceOf("observed"),
    callbacksWaiting: provenanceOf("observed"),
    atRisk: tileMetricProvenance("Potential pipeline value"),
    unreadable: provenanceOf("observed", "unavailable"),
  };
}

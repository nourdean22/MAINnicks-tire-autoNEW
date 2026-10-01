/**
 * dataFreshness — Q-23 phase 9 · how current the shop data on this screen is.
 *
 * Estate plan §9 item 4: the money radar has to say how old its inputs are, or
 * every other tile reads as live when it may be days behind. Three inputs feed
 * the numbers on Intelligence HQ, and each already has a reader:
 *
 *   - ShopDriver connection · `adminSecurity.integrationFreshness` (alg_probe_log),
 *     classified by the same `classifyIntegrationFreshness` the Overview card uses;
 *   - invoice mirror · `controlCenter.todayPulse` revenue.throughDate, classified by
 *     the same `mirrorFreshness` the "Today, for real" card uses;
 *   - SMS gateway · `sms.gatewayHealth`, the reader every gateway badge uses.
 *
 * No new server reader: a second definition of "stale" or "offline" is how the
 * badges drifted apart before (see GATEWAY_OFFLINE_MINUTES).
 *
 * The rule every row keeps: a failed read is UNMEASURED and says "unknown", never
 * a healthy state and never an offline one. "We could not ask" and "we asked and
 * it is down" are different findings, and only the second blames the device.
 *
 * Pure + side-effect-free, like its siblings ./todayPulse and ./moneyRisks.
 */

import { type TileProvenance, provenanceOf } from "@shared/tileProvenance";
import { classifyIntegrationFreshness } from "@/lib/integrationFreshness";
import { mirrorFreshness } from "./todayPulse";

/** Same window as the Overview "Integration freshness" card. */
const SHOPDRIVER_STALE_AFTER_MINUTES = 24 * 60;

export interface FreshnessRow {
  key: "shopdriver" | "invoices" | "sms";
  label: string;
  /** Short state, e.g. "fresh · 12m old", "offline", "unknown". */
  status: string;
  detail: string | null;
  /** null while the first read is still in flight: no tag, no claim. */
  provenance: TileProvenance | null;
  /** True when the operator should look: stale, failing, offline or unread. */
  loud: boolean;
}

/** The slice of a react-query result these views read. */
export interface QuerySlice<T> {
  data: T | undefined;
  isError: boolean;
}

const MEASURED = provenanceOf("observed");
const UNMEASURED = provenanceOf("observed", "unavailable");

function checking(key: FreshnessRow["key"], label: string): FreshnessRow {
  return { key, label, status: "checking…", detail: null, provenance: null, loud: false };
}

function unread(key: FreshnessRow["key"], label: string, detail: string): FreshnessRow {
  return { key, label, status: "unknown", detail, provenance: UNMEASURED, loud: true };
}

function ageText(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

// ─── ShopDriver connection ────────────────────────────────────────────────

export interface IntegrationFreshnessPayload {
  readable?: boolean | null;
  connected?: boolean | null;
  lastSuccessfulAt?: string | Date | null;
  failuresSinceLastSuccess?: number | null;
  lastAttemptOutcome?: string | null;
}

export function shopDriverRow(q: QuerySlice<IntegrationFreshnessPayload>, now: Date): FreshnessRow {
  const label = "ShopDriver connection";
  if (q.isError) return unread("shopdriver", label, "The probe log could not be read. Unknown, not down.");
  if (!q.data) return checking("shopdriver", label);
  const f = classifyIntegrationFreshness({
    connected: q.data.connected,
    lastSuccessfulAt: q.data.lastSuccessfulAt,
    staleAfterMinutes: SHOPDRIVER_STALE_AFTER_MINUTES,
    now,
    readable: q.data.readable,
    failuresSinceLastSuccess: q.data.failuresSinceLastSuccess,
    lastAttemptOutcome: q.data.lastAttemptOutcome,
  });
  switch (f.state) {
    case "fresh":
      return { key: "shopdriver", label, status: f.label, detail: null, provenance: MEASURED, loud: false };
    case "stale":
      return {
        key: "shopdriver", label, status: f.label,
        detail: "No successful ShopDriver probe in the last 24h. Numbers from ShopDriver may be old.",
        provenance: MEASURED, loud: true,
      };
    case "failing":
      return { key: "shopdriver", label, status: f.label, detail: null, provenance: MEASURED, loud: true };
    case "offline":
      return {
        key: "shopdriver", label, status: "never connected",
        detail: "The probe log has no successful ShopDriver login.",
        provenance: MEASURED, loud: true,
      };
    case "unknown":
      return unread("shopdriver", label, `${f.label}. Unknown, not down.`);
  }
}

// ─── Invoice mirror ───────────────────────────────────────────────────────

export type TodayPulseFreshnessPayload =
  | { available: true; revenue: { throughDate: Date | string | null } }
  | { available: false };

export function invoiceMirrorRow(q: QuerySlice<TodayPulseFreshnessPayload>, now: Date): FreshnessRow {
  const label = "Invoice mirror";
  if (q.isError || (q.data && !q.data.available)) {
    return unread("invoices", label, "The newest invoice date could not be read.");
  }
  if (!q.data) return checking("invoices", label);
  const raw = q.data.revenue.throughDate;
  const through = raw == null ? null : raw instanceof Date ? raw : new Date(raw);
  if (through && Number.isNaN(through.getTime())) {
    return unread("invoices", label, "The newest invoice date is not a valid date.");
  }
  const f = mirrorFreshness(through, now);
  if (!through) {
    // A read that found no invoice at all is a measured finding, and a loud one.
    return { key: "invoices", label, status: f.label, detail: "Revenue on this screen is not measured.", provenance: MEASURED, loud: true };
  }
  return {
    key: "invoices",
    label,
    status: f.label,
    detail: f.stale ? "Revenue on this screen is understated until the mirror catches up." : null,
    provenance: MEASURED,
    loud: f.stale,
  };
}

// ─── SMS gateway ──────────────────────────────────────────────────────────

export interface GatewayHealthPayload {
  configured: boolean;
  online: boolean;
  /** false when the vendor API could not be asked; true or absent otherwise. */
  readable?: boolean;
  lastSeen?: string | null;
  ageMinutes?: number;
  error?: string;
}

export function smsGatewayRow(q: QuerySlice<GatewayHealthPayload>): FreshnessRow {
  const label = "SMS gateway";
  if (q.isError) return unread("sms", label, "The gateway status could not be read. Unknown, not offline.");
  if (!q.data) return checking("sms", label);
  const g = q.data;
  if (!g.configured) {
    return { key: "sms", label, status: "not configured", detail: "Shop texts cannot send from the gateway.", provenance: MEASURED, loud: true };
  }
  if (g.readable === false) {
    return unread("sms", label, `The gateway service did not answer${g.error ? ` (${g.error})` : ""}. Unknown, not offline.`);
  }
  const seen = typeof g.ageMinutes === "number" && g.lastSeen ? ` · seen ${ageText(g.ageMinutes)} ago` : "";
  if (g.online) {
    return { key: "sms", label, status: `online${seen}`, detail: null, provenance: MEASURED, loud: false };
  }
  return {
    key: "sms",
    label,
    status: g.lastSeen ? `offline${seen}` : "offline",
    detail: g.lastSeen ? "Shop texts are not going out from the gateway phone." : (g.error ?? "No gateway phone has checked in."),
    provenance: MEASURED,
    loud: true,
  };
}

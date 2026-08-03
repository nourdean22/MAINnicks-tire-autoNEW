/**
 * Builds the admin sidebar's `AdminSignal[]` from what the shell already fetches.
 *
 * NO NEW QUERIES. Every source here is already polled by `Admin.tsx`, so adding
 * signals costs zero extra round-trips. The three-state model and the fold live
 * in `@shared/adminSignal`; this file only maps fetch results onto them.
 *
 * ── PER-SLICE, NOT PER-QUERY ───────────────────────────────────────────────
 *
 * `getOverviewMediumBundle()` runs its five reads through `Promise.allSettled`
 * and returns a `slices` map saying which ones actually succeeded
 * (server/services/adminBundle.ts:122-146). Its own comment is the doctrine:
 * "An empty list is only real when its slice is available."
 *
 * The shell fetched that map and threw it away. That matters more than a whole-
 * query failure, because a PARTIAL failure is invisible: the tRPC query resolves
 * fine (so `isError` is false and the DegradedDataBanner never fires), while
 * `getAdminActionableCounts` turns the failed slice's `undefined` into `[]` and
 * reports 0. adminBundle.ts:85-92 records exactly this — "a leads-only or
 * callbacks-only failure rendered a clean queue".
 *
 * So each signal is gated on ITS OWN slice, not on one shared boolean.
 */
import {
  type AdminSignal,
  type SignalSeverity,
  reading,
} from "@shared/adminSignal";

import type { AdminActionableCounts } from "./adminActionableCounts";

/** Mirrors SliceStatus in server/services/adminBundle.ts. */
export interface SliceState {
  available: boolean;
  error: string | null;
}

export interface BundleSlices {
  stats: SliceState;
  bookings: SliceState;
  leads: SliceState;
  callbacks: SliceState;
  health: SliceState;
}

type SliceName = keyof BundleSlices;

export interface AdminSignalInputs {
  /** tRPC-level failure of adminDashboard.overviewMediumBundle. */
  bundleFailed: boolean;
  /** `undefined` until the first response lands. Distinguishes loading from empty. */
  slices: BundleSlices | undefined;
  /** Derived from the bundle. Its fields are 0 when a slice failed — hence `slices`. */
  counts: AdminActionableCounts;
  stats: { tires?: { new?: number } | null; memberships?: { warning?: number } | null } | null;
  /** contentAdmin.operationsSignal */
  opsFailed: boolean;
  opsUnknown: boolean;
  opsTotal: number | undefined;
}

const BUNDLE = "adminDashboard.overviewMediumBundle";
const OPS = "contentAdmin.operationsSignal";

function bundleSignal(
  id: string,
  section: string,
  label: string,
  slice: SliceName,
  value: number | undefined,
  severity: SignalSeverity,
  inputs: AdminSignalInputs,
): AdminSignal {
  const sliceState = inputs.slices?.[slice];
  const sliceFailed = sliceState?.available === false;
  const sourceLabel = `${BUNDLE} (${slice})`;

  return {
    id,
    section,
    label,
    severity,
    source: sourceLabel,
    updatedAt: null,
    reading: reading({
      failed: inputs.bundleFailed || sliceFailed,
      // Not loaded yet: no badge, rather than a confident 0 built from the `?? []`
      // fallbacks while the first request is still in flight.
      value: inputs.slices === undefined ? undefined : value,
      sourceLabel: sliceFailed && sliceState?.error ? `${sourceLabel}: ${sliceState.error}` : sourceLabel,
      notMeasuredReason: `${sourceLabel} has not reported yet`,
    }),
  };
}

/**
 * Every signal the shell can produce from data it ALREADY has.
 *
 * Sections deliberately absent — `customers`, `growth`, `content`, `campaigns`,
 * `voiceReceptionist`, `opsHub`, `settings`, `intelligence`, `trafficFunnel` —
 * emit NO signal and therefore NO badge. That is the honest state: nothing
 * cheap that the shell already fetches measures them. The switch this replaced
 * rendered `0` for all of them, which reads as "no problems here" for questions
 * the system had never asked.
 *
 * Wiring those needs new queries and is deliberately a separate change, so the
 * cost of each new poll is reviewed on its own.
 */
export function buildAdminSignals(inputs: AdminSignalInputs): AdminSignal[] {
  const { counts } = inputs;

  const opsReading = reading({
    failed: inputs.opsFailed,
    unknown: inputs.opsUnknown,
    value: inputs.opsTotal,
    sourceLabel: OPS,
    notMeasuredReason: `${OPS} has not reported yet`,
  });

  return [
    // ── Today ──────────────────────────────────────────────────────────────
    // Three signals rather than one pre-summed `counts.total`, so the tooltip
    // can name WHICH work is outstanding and each is gated on its own slice.
    // The fold sums to exactly the number `counts.total` produced.
    bundleSignal("new-bookings", "overview", "new bookings", "bookings", counts.newBookings, "warning", inputs),
    bundleSignal("actionable-leads", "overview", "open leads", "leads", counts.actionableLeads, "warning", inputs),
    bundleSignal("pending-callbacks", "overview", "pending callbacks", "callbacks", counts.pendingCallbacks, "urgent", inputs),
    {
      // Publishing lands on Today as well as Instagram: Today is where the
      // operator starts, and a signal you only see after navigating to the right
      // place is not a signal. Three reels once sat held for 32 hours behind a
      // silent sidebar.
      id: "ops-overview",
      section: "overview",
      label: "publishing items held",
      severity: "urgent",
      source: OPS,
      updatedAt: null,
      reading: opsReading,
    },

    // ── Sales Pipeline ─────────────────────────────────────────────────────
    bundleSignal("new-leads", "leads", "new leads", "leads", counts.newLeads, "warning", inputs),

    // ── Tires ──────────────────────────────────────────────────────────────
    bundleSignal("new-tire-orders", "tireOrders", "new tire orders", "stats", inputs.stats?.tires?.new, "warning", inputs),

    // ── Nonstop Nick ───────────────────────────────────────────────────────
    bundleSignal(
      "membership-warnings",
      "memberships",
      "membership warnings",
      "stats",
      inputs.stats?.memberships?.warning,
      "warning",
      inputs,
    ),

    // ── Instagram ──────────────────────────────────────────────────────────
    {
      id: "ops-instagram",
      section: "instagram",
      label: "publishing items held",
      severity: "urgent",
      source: OPS,
      updatedAt: null,
      reading: opsReading,
    },
  ];
}

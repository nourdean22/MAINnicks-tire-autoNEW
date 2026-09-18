/**
 * RECOVERY QUEUE BUILDER — turns call rows into the short list a human works.
 *
 * WHAT CHANGED AND WHY. `getMissedRevenueQueue` returned one row per CALL for
 * ninety days, with `queueStatus` defaulting to "pending" whenever no human had
 * ever stamped it. That produced a 1,118-row wall labelled "Missed Revenue" —
 * a number that was never a count of recoverable demand:
 *
 *   - the classifier scored the assistant's own greeting as customer demand, so
 *     silent calls and "what time do you close?" both produced rows
 *     (fixed upstream in `vapiCallClassifier.ts`, 2026-09-18);
 *   - `walk_in_directed` — the outcome the assistant is TRYING to produce — was
 *     counted as missed revenue;
 *   - `tech_failure` — which the same dashboard excludes from every quality
 *     denominator as "not a valid conversation" — was counted as an operator
 *     obligation;
 *   - a caller whose transfer failed and who redialled twice became three rows
 *     AND earned "Repeat Caller (+3)", so repetition INFLATED the backlog it
 *     was describing;
 *   - "+3" fired on any number seen twice in ninety days, so brakes in June and
 *     tires in September scored as urgency.
 *
 * THE SHAPE NOW: one CUSTOMER with one NEED is one episode, regardless of how
 * many times they called or texted. Lane assignment and priority come from
 * `shared/callTaxonomy.ts` — the single kernel — so the operator surface, the
 * scorecard and the ROI model can no longer disagree about what a call meant.
 *
 * Pure and total: no DB, no clock beyond an injected `now`. The router does IO;
 * every decision lives here, where it is unit-tested.
 */
import {
  disposeCall,
  episodeKey,
  intentFamily,
  type CallDisposition,
  type CallLane,
  type CallOutcome,
} from "@shared/callTaxonomy";
import type { ExtractedDemand } from "@shared/callDemandExtraction";

/** The row shape the router selects. Deliberately narrow. */
export interface QueueSourceRow {
  id: number;
  vapiCallId: string | null;
  phoneNumber: string | null;
  customerName: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  aiSummary: string | null;
  evalScore: number | null;
  evalOutcome: string | null;
  createdAt: Date;
  metadata: unknown;
}

export interface QueueEpisode {
  episodeKey: string;
  /** Newest call in the episode — the one whose context the operator needs. */
  latestCallId: number;
  vapiCallId: string | null;
  phoneNumber: string | null;
  customerName: string | null;
  intents: string[];
  intentFamily: string;
  outcome: CallOutcome;
  aiSummary: string | null;
  firstCallAt: Date;
  latestCallAt: Date;
  /** How many calls collapsed into this episode. A badge, NOT extra rows. */
  contactCount: number;
  ageMinutes: number;
  queueStatus: string;
  disposition: CallDisposition;
  /** Every call id in the episode, so the drawer can show the full timeline. */
  callIds: number[];
  /**
   * Buying specifics extracted from the caller's own turns. Every field may be
   * null — extraction fails closed, and the SMS compiler degrades gracefully
   * rather than inventing a size.
   */
  demand: ExtractedDemand;
  /** True when a VERIFIED transfer failure is on record for this episode. */
  transferFailed: boolean;
}

const EMPTY_DEMAND: ExtractedDemand = {
  tireSize: null, quantity: null, condition: null,
  vehicle: null, urgency: null, hasCapturedSpecifics: false,
};

/** Read the persisted demand record, tolerating rows written before it existed. */
function demandFrom(meta: Record<string, unknown>): ExtractedDemand {
  const d = meta.demand;
  if (!d || typeof d !== "object") return EMPTY_DEMAND;
  const r = d as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    tireSize: str(r.tireSize),
    quantity: typeof r.quantity === "number" ? r.quantity : null,
    condition: r.condition === "new" || r.condition === "used" ? r.condition : null,
    vehicle: str(r.vehicle),
    urgency:
      r.urgency === "today" || r.urgency === "this_week" || r.urgency === "flexible"
        ? r.urgency
        : null,
    hasCapturedSpecifics: r.hasCapturedSpecifics === true,
  };
}

export interface RecoveryQueueResult {
  /** Recovery-lane episodes, highest priority first. This is "Needs Attention". */
  episodes: QueueEpisode[];
  /**
   * Honest denominators. Counts of EPISODES per lane — including the states
   * that are deliberately not obligations, so "where did the other 1,100 go?"
   * has an answer on screen instead of a support question.
   */
  laneCounts: Record<CallLane, number>;
  /** Episodes excluded from recovery, by stated reason. Never silently dropped. */
  exclusionCounts: Record<string, number>;
  /** Raw call rows considered — the denominator the old UI reported as leads. */
  sourceCallCount: number;
  /**
   * Episodes whose speaker attribution failed. This is an UNKNOWN, not a zero:
   * it must be visible and driven down, never averaged into "no demand".
   */
  unclassifiedCount: number;
}

const asRecord = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
};

/** Last 10 digits — the join key used everywhere else in this app. */
export const phoneLast10 = (p: string | null): string =>
  (p ?? "").replace(/\D/g, "").slice(-10);

/**
 * Facts the kernel needs that live in the row's metadata.
 *
 * `customerSpeech` has been written by the VAPI webhook since 2026-07-26 and
 * read by NOTHING until now — the BUILT-UNWIRED pattern again. Its `unparsed`
 * flag is what separates "we could not read this call" from "the caller said
 * nothing", which the kernel keeps as two different lanes.
 */
function speechFacts(meta: Record<string, unknown>): {
  speakerAttribution: "messages" | "transcript" | "unavailable";
  hasCustomerSpeech: boolean;
} {
  const cs = asRecord(meta.customerSpeech);
  if (!Object.keys(cs).length) {
    // No record written (pre-2026-07-26 rows, or a failed analytics write).
    // UNKNOWN, never "silent" — asserting absence we never measured is the
    // exact defect this queue is being repaired for.
    return { speakerAttribution: "unavailable", hasCustomerSpeech: false };
  }
  if (cs.unparsed === true) return { speakerAttribution: "unavailable", hasCustomerSpeech: false };
  const first = typeof cs.first === "string" ? cs.first : null;
  return { speakerAttribution: "transcript", hasCustomerSpeech: first !== null };
}

/**
 * Build the recovery queue from raw call rows.
 *
 * `now` is injected so the SLA and decay maths are deterministic under test.
 */
export function buildRecoveryQueue(
  rows: readonly QueueSourceRow[],
  now: Date,
  opts: { windowMinutes?: number } = {},
): RecoveryQueueResult {
  const grouped = new Map<string, QueueSourceRow[]>();

  for (const row of rows) {
    const meta = asRecord(row.metadata);
    const intents = Array.isArray(meta.intents) ? (meta.intents as string[]) : [];
    const key = episodeKey(
      phoneLast10(row.phoneNumber) || `anon-${row.id}`,
      intentFamily(intents),
      row.createdAt,
      opts.windowMinutes,
    );
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const laneCounts: Record<CallLane, number> = {
    recovery: 0, arrival: 0, operations: 0, safety: 0,
    engineering: 0, none: 0, unclassified: 0,
  };
  const exclusionCounts: Record<string, number> = {};
  const episodes: QueueEpisode[] = [];

  for (const [key, callsUnsorted] of grouped) {
    const calls = [...callsUnsorted].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const latest = calls[calls.length - 1];
    const meta = asRecord(latest.metadata);
    const intents = Array.isArray(meta.intents) ? (meta.intents as string[]) : [];
    const ageMinutes = Math.max(
      0,
      Math.floor((now.getTime() - latest.createdAt.getTime()) / 60_000),
    );
    const { speakerAttribution, hasCustomerSpeech } = speechFacts(meta);

    const disposition = disposeCall({
      outcome: (latest.evalOutcome as CallOutcome) ?? "unknown",
      speakerAttribution,
      hasCustomerSpeech,
      durationSeconds: latest.durationSeconds ?? 0,
      ageMinutes,
      // Repetition is a PRIORITY signal within one episode — never a row count,
      // and never the old 90-day "seen this number before" heuristic.
      repeatWithinWindow: calls.length > 1,
      transferFailed: meta.transferFailed === true,
      safetyFlag: meta.safetyFlag === true,
      existingVehicleAtShop: meta.existingVehicleAtShop === true,
      invoiceMatched: meta.invoiceMatched === true,
      expectedArrivalOpen: meta.expectedArrivalOpen === true,
      hasCapturedSpecifics: intents.includes("tire_size_request") || meta.hasCapturedSpecifics === true,
    });

    laneCounts[disposition.lane] += 1;
    if (disposition.excludedBecause) {
      exclusionCounts[disposition.excludedBecause] =
        (exclusionCounts[disposition.excludedBecause] ?? 0) + 1;
    }

    if (disposition.queueEligible) {
      episodes.push({
        episodeKey: key,
        latestCallId: latest.id,
        vapiCallId: latest.vapiCallId,
        phoneNumber: latest.phoneNumber,
        customerName: latest.customerName,
        intents,
        intentFamily: intentFamily(intents),
        outcome: (latest.evalOutcome as CallOutcome) ?? "unknown",
        aiSummary: latest.aiSummary,
        firstCallAt: calls[0].createdAt,
        latestCallAt: latest.createdAt,
        contactCount: calls.length,
        ageMinutes,
        queueStatus: typeof meta.queueStatus === "string" ? meta.queueStatus : "pending",
        disposition,
        callIds: calls.map((c) => c.id),
        demand: demandFrom(meta),
        transferFailed: meta.transferFailed === true,
      });
    }
  }

  episodes.sort((a, b) => {
    if (b.disposition.priority !== a.disposition.priority) {
      return b.disposition.priority - a.disposition.priority;
    }
    return b.latestCallAt.getTime() - a.latestCallAt.getTime();
  });

  return {
    episodes,
    laneCounts,
    exclusionCounts,
    sourceCallCount: rows.length,
    unclassifiedCount: laneCounts.unclassified,
  };
}

/** Episodes past their SLA clock — what the daily triage opens with. */
export function breachedSla(result: RecoveryQueueResult): QueueEpisode[] {
  return result.episodes.filter(
    (e) => e.disposition.slaMinutes !== null && e.ageMinutes > e.disposition.slaMinutes,
  );
}

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
import { isTransferFailure } from "../lib/warmTransferConnect";
import { phoneLast10 } from "../lib/phone";

/** An open expected-arrival row, as arrivalSignalsForQueue supplies it. */
export interface OpenExpectation {
  /** vapiCallId for voice rows, conversation id for SMS rows, null for manual. */
  sourceRef: string | null;
  /** UNIX milliseconds the row was created, formatted in SQL. */
  createdAtMs: number;
}

/**
 * Did an invoice land AFTER this call? Compared as instants, not days. Review
 * on PR #2488 caught the day version: a customer who paid for one visit in the
 * morning and called that afternoon about a NEW need was "already invoiced"
 * and dropped from recovery. The invoice instant is UNIX_TIMESTAMP'd in SQL;
 * the call's createdAt is driver-parsed, which on an Eastern dev box can read
 * a few hours LATE. A late-reading call can only make this stricter — it can
 * delay a true "already invoiced", never fabricate one.
 */
function invoicedAfterCall(
  byPhone: ReadonlyMap<string, number> | undefined,
  phone: string,
  callAt: Date,
): boolean {
  const invoicedAtMs = byPhone?.get(phone);
  if (invoicedAtMs == null) return false;
  return invoicedAtMs >= callAt.getTime();
}

/**
 * How long after an episode's latest call an open expectation still belongs to
 * it. Voice rows are matched EXACTLY by sourceRef (the bookSlot handler stamps
 * the vapiCallId), so this window only decides SMS/manual rows and voice rows
 * whose call the queue did not select. Two days covers "I'll come tomorrow"
 * texted the day after the call; it does not reach a month-old episode.
 */
const EXPECTATION_AFTER_CALL_MS = 48 * 60 * 60_000;
/** Recording lag: bookSlot writes the row during the call, never before it. */
const EXPECTATION_BEFORE_CALL_MS = 60 * 60_000;

/**
 * Does an open expectation belong to THIS episode? Review on PR #2488 caught
 * the phone-only version: a customer with a month-old no-show episode who says
 * "coming tomorrow" today would have reclassified the OLD episode as
 * expected_to_arrive and hidden it from recovery. An expectation counts only
 * if its source call is one of the episode's calls, or it was recorded in the
 * window around the episode's latest call.
 */
function expectationBelongsToEpisode(
  byPhone: ReadonlyMap<string, readonly OpenExpectation[]> | undefined,
  phone: string,
  episodeCallIds: ReadonlySet<string>,
  latestCallAt: Date,
): boolean {
  const open = byPhone?.get(phone);
  if (!open || open.length === 0) return false;
  const t = latestCallAt.getTime();
  return open.some(
    (e) =>
      (e.sourceRef != null && episodeCallIds.has(e.sourceRef)) ||
      (e.createdAtMs >= t - EXPECTATION_BEFORE_CALL_MS && e.createdAtMs <= t + EXPECTATION_AFTER_CALL_MS),
  );
}

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
  opts: {
    windowMinutes?: number;
    /**
     * Last-10 phones with an OPEN expected arrival.
     *
     * Injected rather than read from row metadata, because nothing writes an
     * `expectedArrivalOpen` flag onto a call — the arrivals live in their own
     * table. Without this the `arrival` lane could never fire and every
     * walk-in would fall back into recovery, which is the exact behaviour this
     * queue was being repaired for. A reader with no writer is not a feature.
     */
    expectedArrivalPhones?: ReadonlySet<string>;
    /**
     * Last-10 phone -> the OPEN expected-arrival rows for it (still `expected`,
     * not past the reconcile window). An expectation only counts for an
     * episode when its source call is one of the episode's calls, or it was
     * recorded within the window around the episode's latest call — a
     * phone-wide set (the first version) let "coming tomorrow" said today
     * reclassify a month-old no-show episode as expected_to_arrive.
     * Supersedes `expectedArrivalPhones`, which is kept only for callers and
     * tests that still pass a bare set; when both are given, this one wins.
     */
    openExpectations?: ReadonlyMap<string, readonly OpenExpectation[]>;
    /**
     * Last-10 phone -> UNIX ms of the most recent invoice an expected arrival
     * reconciled to. `invoiceMatched` becomes true only when that instant is
     * AT OR AFTER the episode's latest call: a visit last week must not
     * suppress a new need today, and — the case review caught — neither may
     * a visit paid for this MORNING suppress a new need called in this
     * AFTERNOON. This fact means "money in the till for THIS call", never
     * "has ever paid us".
     *
     * Replaces `invoicedPhones`, a set this function accepted and no caller
     * ever supplied — so kernel rule 5 ("already invoiced") had never fired,
     * and a walk-in who came and paid fell through to "no arrival matched"
     * the moment their arrival row reconciled. A reader with no writer is not
     * a feature, and this one was quietly manufacturing recovery work for
     * customers who had already paid.
     */
    invoicedAfter?: ReadonlyMap<string, number>;
  } = {},
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
    const phone = phoneLast10(latest.phoneNumber);
    /**
     * Computed ONCE. Feeding the disposition a derived value while exposing a
     * different one on the episode is exactly the split-brain this whole wave
     * exists to remove — and it is how the first draft of this file shipped.
     *
     * EVIDENCE ORDER. `artifact.transfers[].status` is the provider's own
     * per-attempt outcome and outranks everything else: a `connected` verdict
     * means the caller reached a human, so the episode is NOT a failed handoff
     * even if some other reason looks like one. Only when the provider gave us
     * no verdict do we fall back to VAPI's `*-transfer-*` error reasons.
     *
     * Note what is still NOT inferred: `assistant-forwarded-call` means the
     * transfer was INITIATED. It never implies either verdict, in either
     * direction. A call carrying only that reason stays unresolved here.
     */
    const artifactVerdicts = calls
      .map((c) => asRecord(asRecord(c.metadata).transferArtifact).verdict)
      .filter((v): v is string => typeof v === "string");
    const transferFailed = artifactVerdicts.includes("connected")
      ? false
      : artifactVerdicts.includes("not_connected")
        ? true
        : calls.some((c) => isTransferFailure(c.endedReason));

    const disposition = disposeCall({
      outcome: (latest.evalOutcome as CallOutcome) ?? "unknown",
      speakerAttribution,
      hasCustomerSpeech,
      durationSeconds: latest.durationSeconds ?? 0,
      ageMinutes,
      // Repetition is a PRIORITY signal within one episode — never a row count,
      // and never the old 90-day "seen this number before" heuristic.
      repeatWithinWindow: calls.length > 1,
      /**
       * VERIFIED failure only — VAPI's own `*-transfer-*` error reasons, via the
       * same predicate `transferOutcomeEvidence` uses. Never inferred from
       * `assistant-forwarded-call`, which Vapi's docs confirm means the transfer
       * was INITIATED, not answered: a call that rang an empty counter and hit
       * voicemail carries that reason too.
       */
      transferFailed,
      safetyFlag: meta.safetyFlag === true,
      existingVehicleAtShop: meta.existingVehicleAtShop === true,
      invoiceMatched:
        invoicedAfterCall(opts.invoicedAfter, phone, latest.createdAt) || meta.invoiceMatched === true,
      expectedArrivalOpen:
        (opts.openExpectations
          ? expectationBelongsToEpisode(
              opts.openExpectations,
              phone,
              new Set(calls.map((c) => c.vapiCallId).filter((id): id is string => typeof id === "string" && id.length > 0)),
              latest.createdAt,
            )
          : opts.expectedArrivalPhones?.has(phone) === true) || meta.expectedArrivalOpen === true,
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
        transferFailed,
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

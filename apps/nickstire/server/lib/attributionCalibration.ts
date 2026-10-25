/**
 * BAND CALIBRATION: how often each inferred evidence band turns out right, from the
 * records that exist, so a band may confirm itself only once it has earned it.
 *
 * Nour, 2026-10-25: "isnt the voice system self learning and autonimic? it should be
 * learning more n more n doing the attribution by itself." Until this file, nothing
 * measured the phone+time recipe: one human ruling existed in two months, and the card
 * said "nobody has measured". Two sources of truth do exist and both feed this:
 *
 *   human          the operator's Confirm / Reject on the card (ambiguous counted apart)
 *   recorded_link  a voice arrival this call created, reconciled to an invoice by the
 *                  arrival reconciler, or a lead taken on the call uniquely linked to a
 *                  paid invoice. The recipe is run with the link hidden and its single
 *                  claim is scored against the linked invoice.
 *
 * Ruling (PR body): a band is OPEN, and the reconciliation cron may confirm its rows,
 * when it has n >= 20 scored cases and right / n >= 0.90. Under 20 the rate is UNKNOWN
 * (null), never 0 and never 100. Every human ruling moves the next calibration, and a
 * band that drops under the line closes again on the next run. Auto rulings are refused
 * as input: the gate does not grade its own homework.
 *
 * Caveat the card must carry: the arrival reconciler also keys on the phone, so
 * agreement with it proves the recipe picks the same sale, not that the call caused the
 * visit. The time-reversal control (same-phone sale in the 14 days BEFORE a call) is the
 * honest companion number and is reported beside the rate.
 *
 * Pure and total.
 */
import { bandOf, type ConfidenceBand } from "./attributionConfidenceBands";
import {
  buildCallInvoiceCandidates,
  type CallObservation,
  type PaidInvoiceObservation,
} from "../services/revenueAttribution";

export type CalibratedBand = Extract<ConfidenceBand, "strong" | "weak">;

export interface BandRuling {
  band: CalibratedBand;
  decision: "confirmed" | "rejected" | "ambiguous";
  source: "human" | "recorded_link" | "auto";
}

const CALIBRATION_THRESHOLD = { minN: 20, minPrecision: 0.9 } as const;

export interface BandCalibration {
  right: number;
  wrong: number;
  /** right + wrong. Ambiguous rulings are not in it. */
  n: number;
  ambiguous: number;
  /** right / n, or null (UNKNOWN) while n is under the threshold. */
  precision: number | null;
  /** True when this band may confirm its own rows. */
  open: boolean;
  human: { confirmed: number; rejected: number; ambiguous: number };
  recordedLink: { right: number; wrong: number };
}

export interface CalibrationReport {
  threshold: typeof CALIBRATION_THRESHOLD;
  bands: Record<CalibratedBand, BandCalibration>;
  anyOpen: boolean;
  /** Auto rulings seen and refused as input. */
  refusedAuto: number;
}

function emptyBand(): BandCalibration {
  return {
    right: 0,
    wrong: 0,
    n: 0,
    ambiguous: 0,
    precision: null,
    open: false,
    human: { confirmed: 0, rejected: 0, ambiguous: 0 },
    recordedLink: { right: 0, wrong: 0 },
  };
}

export function calibrateBands(rulings: readonly BandRuling[]): CalibrationReport {
  const bands: Record<CalibratedBand, BandCalibration> = { strong: emptyBand(), weak: emptyBand() };
  let refusedAuto = 0;
  for (const r of rulings) {
    if (r.source === "auto") { refusedAuto += 1; continue; }
    const b = bands[r.band];
    if (!b) continue;
    if (r.source === "human") {
      b.human[r.decision] += 1;
      if (r.decision === "ambiguous") { b.ambiguous += 1; continue; }
    } else {
      if (r.decision === "ambiguous") continue;
      b.recordedLink[r.decision === "confirmed" ? "right" : "wrong"] += 1;
    }
    if (r.decision === "confirmed") b.right += 1; else b.wrong += 1;
  }
  for (const b of Object.values(bands)) {
    b.n = b.right + b.wrong;
    b.precision = b.n >= CALIBRATION_THRESHOLD.minN ? b.right / b.n : null;
    b.open = b.precision != null && b.precision >= CALIBRATION_THRESHOLD.minPrecision;
  }
  return { threshold: CALIBRATION_THRESHOLD, bands, anyOpen: Object.values(bands).some((b) => b.open), refusedAuto };
}

export interface RecordedLink {
  callId: number;
  invoiceId: number;
}

/**
 * Run the recipe blind (no lead links) on each linked call and score its single claim
 * against the recorded invoice. A call with no single claim is counted, not scored.
 */
export function scoreRecordedLinks(args: {
  links: readonly RecordedLink[];
  calls: readonly CallObservation[];
  paidInvoices: readonly PaidInvoiceObservation[];
  maxDays?: number;
}): { rulings: BandRuling[]; noClaim: number; missingCall: number } {
  const callById = new Map(args.calls.map((c) => [c.callId, c]));
  const rulings: BandRuling[] = [];
  let noClaim = 0;
  let missingCall = 0;
  const linked: CallObservation[] = [];
  const truth = new Map<number, number>();
  for (const l of args.links) {
    const c = callById.get(l.callId);
    if (!c) { missingCall += 1; continue; }
    linked.push({ ...c, leadId: null });
    truth.set(l.callId, l.invoiceId);
  }
  const blind = buildCallInvoiceCandidates({ calls: linked, paidInvoices: args.paidInvoices, leadLinks: [], maxDays: args.maxDays });
  for (const r of blind) {
    const band = bandOf(r.confidence);
    if (r.invoiceId == null || (band !== "strong" && band !== "weak")) { noClaim += 1; continue; }
    rulings.push({ band, decision: r.invoiceId === truth.get(r.callId) ? "confirmed" : "rejected", source: "recorded_link" });
  }
  return { rulings, noClaim, missingCall };
}

export type CalibrationStateLike =
  | (CalibrationReport & { status: "ok"; control: { callsWithPhone: number; after14d: number; before14d: number } })
  | { status: "failed"; error: string };

const BAND_WORDS: Record<CalibratedBand, string> = {
  weak: "Same-phone-and-timing matches",
  strong: "Same-phone-timing-and-service matches",
};

function bandWords(name: string, b: BandCalibration, minN: number, minPrecision: number): string {
  if (b.precision == null) {
    return `${name}: ${b.n} checked so far (right ${b.right}). Under ${minN}, so no measured rate yet and every one still comes here.`;
  }
  const sources = [
    b.recordedLink.right + b.recordedLink.wrong > 0 ? `${b.recordedLink.right} of ${b.recordedLink.right + b.recordedLink.wrong} against the shop's arrival records` : null,
    b.human.confirmed + b.human.rejected > 0 ? `${b.human.confirmed} of ${b.human.confirmed + b.human.rejected} of your rulings` : null,
  ].filter(Boolean).join(", ");
  if (b.open) return `${name} were right ${b.right} of ${b.n} times (${sources}), so they confirm themselves now; a ruling of yours that says otherwise counts against them.`;
  return `${name} were right ${b.right} of ${b.n} times (${sources}), under the ${Math.round(minPrecision * 100)}% line, so every one still comes here.`;
}

/** The sentences the card prints. A failed read is said as failed, never as a zero. */
export function calibrationWords(cal: CalibrationStateLike): { status: "ok" | "failed"; weak: string; strong: string; control: string | null } {
  if (cal.status !== "ok") {
    const failed = `The hit rate could not be measured (${cal.error}). Until it reads again, nothing confirms itself and every match comes here.`;
    return { status: "failed", weak: failed, strong: failed, control: null };
  }
  const { minN, minPrecision } = cal.threshold;
  const pct = (n: number) => (cal.control.callsWithPhone > 0 ? `${Math.round((n / cal.control.callsWithPhone) * 1000) / 10}%` : "0%");
  return {
    status: "ok",
    weak: bandWords(BAND_WORDS.weak, cal.bands.weak, minN, minPrecision),
    strong: bandWords(BAND_WORDS.strong, cal.bands.strong, minN, minPrecision),
    control: `For scale: a same-phone sale follows ${pct(cal.control.after14d)} of calls within 14 days, and precedes ${pct(cal.control.before14d)} of calls within 14 days, which the call cannot have caused. A match says the caller came in; it does not prove the call is why.`,
  };
}

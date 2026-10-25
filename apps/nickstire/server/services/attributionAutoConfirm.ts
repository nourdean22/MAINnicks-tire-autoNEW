/**
 * AUTO-CONFIRM: the reconciliation cron confirms its own weak matches once the band has
 * earned it (job 2026-10-25-attribution-self-learning, PR 2).
 *
 * Two steps, both fail CLOSED:
 *   loadCalibration   reads the operator's rulings and the recorded links (SELECT only) and
 *                     measures each band (lib/attributionCalibration). A read that throws is a
 *                     closed gate and a `failed` status on the run, never an open one.
 *   autoConfirmCalibrated
 *                     for this run's manual_review candidates whose band is open, collapses
 *                     same-invoice claims (an invoice is paid once) and writes ONE confirmed
 *                     ruling per invoice, decided_by `auto:calibration-v1`, with the measured
 *                     numbers on the row. The write is INSERT ... SELECT ... WHERE NOT EXISTS
 *                     on the exact facts it read (no current ruling for the call, no confirmed
 *                     ruling for the invoice) and the unique key (call_id, current_slot) is the
 *                     compare-and-swap: a racer loses with a duplicate-key error and is counted
 *                     as skipped, never thrown.
 *
 * A human ruling later supersedes an auto one (resolveAttributionDecision clears current_slot),
 * and that ruling feeds the next calibration; auto rulings never do.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { isDuplicateKeyError } from "../lib/dbErrors";
import { readRows } from "../lib/dbResult";
import { createLogger } from "../lib/logger";
import { collapseByInvoice } from "../lib/attributionDedupe";
import { bandOf } from "../lib/attributionConfidenceBands";
import {
  calibrateBands,
  scoreRecordedLinks,
  type BandRuling,
  type CalibrationReport,
} from "../lib/attributionCalibration";
import { normalizePhone, type CallObservation, type PaidInvoiceObservation } from "./revenueAttribution";

const log = createLogger("attribution-auto-confirm");

const AUTO_DECIDER = "auto:calibration-v1";

type Db = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export interface CalibrationRead extends CalibrationReport {
  status: "ok";
  measuredAt: string;
  inputs: {
    humanRulings: number;
    recordedLinks: number;
    linksScored: number;
    linksNoClaim: number;
    linksMissingCall: number;
  };
  /**
   * Time-reversal control (base-rate-check): calls with a same-phone paid invoice in the 14
   * days AFTER the call (what the recipe claims) and in the 14 days BEFORE it (which the call
   * cannot have caused). The gap is the share of matches the call plausibly produced.
   */
  control: { callsWithPhone: number; after14d: number; before14d: number };
}

export type CalibrationState = CalibrationRead | { status: "failed"; error: string };

const MAX_DAYS = 14;
const DAY_MS = 86_400_000;

/** SELECT only. Throws on any read failure: the caller treats that as a closed gate. */
export async function loadCalibration(db: Db): Promise<CalibrationRead> {
  const [rulingRows, linkRows, callRows, invoiceRows] = await Promise.all([
    db.execute(sql`
      SELECT d.decision, d.decided_by AS decidedBy,
             COALESCE(cq.confidence, cl.confidence) AS confidence
      FROM revenue_attribution_decisions d
      LEFT JOIN revenue_reconciliation_candidates cq
        ON cq.call_id = d.call_id
       AND cq.run_id = JSON_UNQUOTE(JSON_EXTRACT(d.evidence_json, '$.queuedRunId'))
      LEFT JOIN (
        SELECT c.call_id, c.confidence
        FROM revenue_reconciliation_candidates c
        INNER JOIN (
          SELECT call_id, MAX(created_at) AS latest_created_at
          FROM revenue_reconciliation_candidates
          GROUP BY call_id
        ) latest ON latest.call_id = c.call_id AND latest.latest_created_at = c.created_at
      ) cl ON cl.call_id = d.call_id
      WHERE d.current_slot = 1
    `),
    db.execute(sql`
      SELECT v.id AS callId, a.reconciledInvoiceId AS invoiceId
      FROM expected_arrivals a
      INNER JOIN vapi_call_logs v ON v.vapiCallId = a.sourceRef
      WHERE a.source = 'voice' AND a.reconciledInvoiceId IS NOT NULL
      UNION
      SELECT v.id AS callId, l.invoiceId AS invoiceId
      FROM vapi_call_logs v
      INNER JOIN leads l ON l.id = v.leadId
      WHERE l.invoiceId IS NOT NULL
        AND (SELECT COUNT(*) FROM leads l2 WHERE l2.invoiceId = l.invoiceId) = 1
    `),
    db.execute(sql`
      SELECT id AS callId, phoneNumber, leadId, serviceMention, createdAt AS occurredAt
      FROM vapi_call_logs
    `),
    db.execute(sql`
      SELECT id AS invoiceId, customerPhone, customerId, serviceDescription,
             invoiceDate AS paidAt, totalAmount AS amountCents
      FROM invoices
      WHERE paymentStatus = 'paid'
    `),
  ]);

  const rulings: BandRuling[] = [];
  let humanRulings = 0;
  for (const r of readRows(rulingRows)) {
    const band = bandOf(r.confidence == null ? null : Number(r.confidence));
    if (band !== "strong" && band !== "weak") continue;
    const decision = String(r.decision) as BandRuling["decision"];
    const auto = String(r.decidedBy ?? "").startsWith("auto:");
    if (!auto) humanRulings += 1;
    rulings.push({ band, decision, source: auto ? "auto" : "human" });
  }

  const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
  const calls: CallObservation[] = readRows(callRows).map((r) => ({
    callId: Number(r.callId),
    phoneNumber: r.phoneNumber == null ? null : String(r.phoneNumber),
    leadId: r.leadId == null ? null : Number(r.leadId),
    serviceMention: r.serviceMention == null ? null : String(r.serviceMention),
    occurredAt: toDate(r.occurredAt),
  }));
  const paidInvoices: PaidInvoiceObservation[] = readRows(invoiceRows).map((r) => ({
    invoiceId: Number(r.invoiceId),
    customerPhone: r.customerPhone == null ? null : String(r.customerPhone),
    customerId: r.customerId == null ? null : Number(r.customerId),
    serviceDescription: r.serviceDescription == null ? null : String(r.serviceDescription),
    paidAt: toDate(r.paidAt),
    amountCents: Number(r.amountCents ?? 0),
  }));
  const links = readRows(linkRows).map((r) => ({ callId: Number(r.callId), invoiceId: Number(r.invoiceId) }));
  const scored = scoreRecordedLinks({ links, calls, paidInvoices, maxDays: MAX_DAYS });

  // Time-reversal control over the unfiltered population.
  const byPhone = new Map<string, number[]>();
  for (const i of paidInvoices) {
    const p = normalizePhone(i.customerPhone);
    if (!p) continue;
    const arr = byPhone.get(p) ?? [];
    arr.push(i.paidAt.getTime());
    byPhone.set(p, arr);
  }
  const control = { callsWithPhone: 0, after14d: 0, before14d: 0 };
  for (const c of calls) {
    const p = normalizePhone(c.phoneNumber);
    if (!p) continue;
    control.callsWithPhone += 1;
    const t = c.occurredAt.getTime();
    const times = byPhone.get(p) ?? [];
    if (times.some((x) => x - t >= 0 && x - t <= MAX_DAYS * DAY_MS)) control.after14d += 1;
    if (times.some((x) => t - x > 0 && t - x <= MAX_DAYS * DAY_MS)) control.before14d += 1;
  }

  return {
    status: "ok",
    measuredAt: new Date().toISOString(),
    ...calibrateBands([...rulings, ...scored.rulings]),
    inputs: {
      humanRulings,
      recordedLinks: links.length,
      linksScored: scored.rulings.length,
      linksNoClaim: scored.noClaim,
      linksMissingCall: scored.missingCall,
    },
    control,
  };
}

export interface AutoConfirmCandidate {
  callId: number;
  invoiceId: number | null;
  resolution: string;
  confidence: number | null;
  matchMethod: string;
  leadId: number | null;
  bookingId: number | null;
  occurredAt: Date;
}

export interface AutoConfirmResult {
  status: "ok" | "closed" | "failed";
  eligible: number;
  confirmed: number;
  /** Same-invoice repeat calls folded into one ruling, or an invoice already confirmed. */
  skipped: number;
  error?: string;
}

function affected(result: unknown): number {
  const r = result as { affectedRows?: number } | Array<{ affectedRows?: number }>;
  return Number((Array.isArray(r) ? r[0]?.affectedRows : r?.affectedRows) ?? 0);
}

export async function autoConfirmCalibrated(
  db: Db,
  args: { runId: string; candidates: readonly AutoConfirmCandidate[]; calibration: CalibrationState },
): Promise<AutoConfirmResult> {
  const { calibration } = args;
  if (calibration.status !== "ok") return { status: "failed", eligible: 0, confirmed: 0, skipped: 0, error: calibration.error };
  if (!calibration.anyOpen) return { status: "closed", eligible: 0, confirmed: 0, skipped: 0 };

  const eligible = args.candidates.filter((c) => {
    if (c.resolution !== "manual_review" || c.invoiceId == null) return false;
    const band = bandOf(c.confidence);
    return (band === "strong" || band === "weak") && calibration.bands[band].open;
  });
  const collapsed = collapseByInvoice(
    eligible.map((c, i) => ({ ...c, id: i, resolution: c.resolution, createdAt: c.occurredAt })),
  );
  let confirmed = 0;
  let skipped = collapsed.duplicates.length;
  for (const p of collapsed.primary) {
    const band = bandOf(p.confidence) as "strong" | "weak";
    const b = calibration.bands[band];
    const evidence = {
      via: "auto_confirm",
      band,
      right: b.right,
      n: b.n,
      precision: b.precision,
      threshold: calibration.threshold,
      measuredAt: calibration.measuredAt,
      queuedRunId: args.runId,
    };
    try {
      const res = await db.execute(sql`
        INSERT INTO revenue_attribution_decisions
          (id, call_id, lead_id, booking_id, invoice_id, work_order_id, decision,
           evidence_level, match_method, confidence, evidence_json, decided_by,
           supersedes_decision_id, current_slot)
        SELECT ${randomUUID()}, ${p.callId}, ${p.leadId ?? null}, ${p.bookingId ?? null}, ${p.invoiceId}, NULL, 'confirmed',
               'inferred', ${p.matchMethod}, ${p.confidence}, ${JSON.stringify(evidence)}, ${AUTO_DECIDER},
               NULL, 1
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 FROM revenue_attribution_decisions x
          WHERE x.call_id = ${p.callId} AND x.current_slot = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM revenue_attribution_decisions y
          WHERE y.invoice_id = ${p.invoiceId} AND y.current_slot = 1 AND y.decision = 'confirmed'
        )
      `);
      if (affected(res) === 1) confirmed += 1; else skipped += 1;
    } catch (e) {
      if (isDuplicateKeyError(e)) { skipped += 1; continue; }
      log.warn("auto-confirm insert failed", { callId: p.callId, error: e instanceof Error ? e.message : String(e) });
      return { status: "failed", eligible: eligible.length, confirmed, skipped, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { status: "ok", eligible: eligible.length, confirmed, skipped };
}

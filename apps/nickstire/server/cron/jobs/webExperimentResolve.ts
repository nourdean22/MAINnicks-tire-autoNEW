/**
 * Web experiment resolver — the daily verdict for every ARMED web experiment.
 *
 * For each experiment whose flag is on: read the exposed visitors, RE-DERIVE
 * each visitor's arm from the visitor id (the beacon endpoint is public and
 * best-effort, so the arm stored in eventData is a claim to be checked, not a
 * fact), count the exposed visitors who later fired the primary and guardrail
 * events, hand the counts to the pure kernel, and:
 *
 *   · PROPOSE a winner or a guardrail breach to the operator over Telegram —
 *     never apply it (the flag and the arm copy stay exactly as they are).
 *   · Write a RealityEvent + an EvidenceClaim to the ledger in statenour,
 *     bound to the owning goal contract's hash, so the verdict, its grade and
 *     the frozen success criteria it was judged against outlive this log line.
 *
 * Stateless on purpose: the mSPRT p-value is always-valid at every read, so
 * there is nothing to carry between days. Refusals (insufficient_data /
 * no_signal / invalid_design / integrity) are results, not errors.
 *
 * Quiet by default: with no armed experiment this is a flag read and a
 * details string, and that must stay distinguishable from a productive run.
 */
import { sql } from "drizzle-orm";
import { excludeNonHumanTraffic } from "../../lib/trafficClass";
import { createLogger } from "../../lib/logger";
import { experimentVerdictKey } from "../../services/bridgeKeys";
import { assignByKey, evaluateWebExperiment, type ArmMetricCounts, type WebExperimentDefinition, type WebExperimentVerdict } from "../../../shared/experimentKernel";
import { EXPERIMENT_EXPOSURE_EVENT, WEB_EXPERIMENTS, experimentAssignmentKey } from "../../../shared/webExperiments";
import { authorityFor, gradeSatisfies } from "../../../shared/goalContract";
import { goalContractFor } from "../../../goals";

const log = createLogger("cron:web-experiment-resolve");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

/** How exposures survived re-derivation. Reported with every verdict. */
export interface ExposureIntegrity {
  /** Distinct visitors that logged at least one exposure. */
  visitors: number;
  /** Visitors whose reported arm(s) match the arm derived from their visitor id. */
  accepted: number;
  /** Visitors that reported an arm the key does not derive to, or more than one arm. */
  rejected: number;
}

/** Above this share of rejected visitors the randomisation itself is suspect. */
const MAX_REJECTED_SHARE = 0.05;

/**
 * Exposed visitors -> accepted arm (derived, never trusted) and first exposure
 * time. A visitor that reported a mismatching arm, or two arms, is dropped
 * entirely: they were either forged or double-assigned, and neither can be
 * placed honestly.
 */
export function deriveExposures(
  def: WebExperimentDefinition,
  rows: Array<{ sessionId: string; reportedArm: string | null; firstExposure: Date }>,
): { accepted: Map<string, { armId: string; firstExposure: Date }>; integrity: ExposureIntegrity } {
  const armIds = def.arms.map((a) => a.armId);
  const byVisitor = new Map<string, { reported: Set<string>; firstExposure: Date }>();
  for (const r of rows) {
    const v = byVisitor.get(r.sessionId) ?? { reported: new Set<string>(), firstExposure: r.firstExposure };
    v.reported.add(r.reportedArm ?? "");
    if (r.firstExposure < v.firstExposure) v.firstExposure = r.firstExposure;
    byVisitor.set(r.sessionId, v);
  }
  const accepted = new Map<string, { armId: string; firstExposure: Date }>();
  let rejected = 0;
  for (const [sessionId, v] of byVisitor) {
    const derived = assignByKey(armIds, experimentAssignmentKey(sessionId, def.experimentId));
    if (v.reported.size === 1 && v.reported.has(derived)) accepted.set(sessionId, { armId: derived, firstExposure: v.firstExposure });
    else rejected++;
  }
  return { accepted, integrity: { visitors: byVisitor.size, accepted: accepted.size, rejected } };
}

/** Count, per arm, accepted visitors who fired each metric AFTER their first exposure. */
export function countConversions(
  def: WebExperimentDefinition,
  accepted: Map<string, { armId: string; firstExposure: Date }>,
  conversions: Map<string, Map<string, Date>>, // metric -> sessionId -> first time
): ArmMetricCounts[] {
  const metrics = [def.primaryMetric, ...def.guardrails.map((g) => g.metric)];
  return def.arms.map((arm) => {
    const visitors = [...accepted.entries()].filter(([, v]) => v.armId === arm.armId);
    const out: ArmMetricCounts = { armId: arm.armId, exposures: visitors.length, conversions: {} };
    for (const metric of metrics) {
      const firstByVisitor = conversions.get(metric) ?? new Map<string, Date>();
      out.conversions[metric] = visitors.filter(([sid, v]) => {
        const t = firstByVisitor.get(sid);
        return t !== undefined && t >= v.firstExposure;
      }).length;
    }
    return out;
  });
}

/**
 * Raw reads from customer_events. TiDB is MySQL-compatible: JSON access is
 * JSON_UNQUOTE(JSON_EXTRACT(...)), never ->> sugar; DATETIME bounds are
 * 'YYYY-MM-DD HH:MM:SS' literals, never ISO strings with 'T' and 'Z'.
 */
async function gatherArmCounts(def: WebExperimentDefinition): Promise<{ counts: ArmMetricCounts[]; integrity: ExposureIntegrity }> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { counts: [], integrity: { visitors: 0, accepted: 0, rejected: 0 } };

  const exec = async (q: ReturnType<typeof sql>) => {
    const result = (await d.execute(q)) as unknown;
    return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as Record<string, unknown>[]) : [];
  };
  const since = new Date(def.preregisteredAt).toISOString().slice(0, 19).replace("T", " ");

  const exposureRows = await exec(sql`
    SELECT sessionId,
           JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.props.armId')) AS reportedArm,
           MIN(createdAt) AS firstExposure
    FROM customer_events
    WHERE eventName = ${EXPERIMENT_EXPOSURE_EVENT}
      AND sessionId IS NOT NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.element')) = ${def.experimentId}
      AND createdAt >= ${since}
      AND ${excludeNonHumanTraffic()}
    GROUP BY sessionId, reportedArm
  `);
  const { accepted, integrity } = deriveExposures(
    def,
    exposureRows.map((r) => ({ sessionId: String(r.sessionId), reportedArm: r.reportedArm == null ? null : String(r.reportedArm), firstExposure: new Date(r.firstExposure as string | Date) })),
  );

  const metrics = [def.primaryMetric, ...def.guardrails.map((g) => g.metric)];
  const conversions = new Map<string, Map<string, Date>>();
  for (const metric of metrics) {
    const rows = await exec(sql`
      SELECT sessionId, MIN(createdAt) AS firstAt
      FROM customer_events
      WHERE eventName = ${metric}
        AND sessionId IS NOT NULL
        AND createdAt >= ${since}
        AND ${excludeNonHumanTraffic()}
      GROUP BY sessionId
    `);
    conversions.set(metric, new Map(rows.map((r) => [String(r.sessionId), new Date(r.firstAt as string | Date)])));
  }
  return { counts: countConversions(def, accepted, conversions), integrity };
}

function telegramLine(def: WebExperimentDefinition, v: WebExperimentVerdict): string | null {
  if (v.status === "winner") {
    return `WEB EXPERIMENT ${def.experimentId}: "${v.variantValue}" leads on ${def.primaryMetric} — ${v.note}. Proposal: make it the default and retire the experiment. Nothing changes until you act (flag stays on; arm copy unchanged).`;
  }
  if (v.status === "guardrail_breach") {
    return `WEB EXPERIMENT ${def.experimentId}: guardrail ${v.metric} BREACHED — ${v.note}. Proposal: turn the flag off now. Nothing changes until you act.`;
  }
  if (v.status === "invalid_design") {
    return `WEB EXPERIMENT ${def.experimentId}: refused — ${v.note}. The result cannot be trusted; fix the design before reading it.`;
  }
  return null;
}

export async function processWebExperimentResolve(): Promise<ProcessResult> {
  const { armedWebExperimentIds } = await import("../../services/webExperimentFlags");
  const armedIds = new Set(await armedWebExperimentIds());
  const armed: WebExperimentDefinition[] = WEB_EXPERIMENTS.filter((e) => armedIds.has(e.experimentId));
  if (!armed.length) return { recordsProcessed: 0, details: "no armed web experiments" };

  const outcomes: string[] = [];
  let resolved = 0;
  for (const def of armed) {
    try {
      // No owning contract = never pre-registered = no graded verdict, ever.
      const owning = goalContractFor(def);
      if (!owning) {
        outcomes.push(`${def.experimentId}: no goal contract — refused`);
        log.warn("armed experiment has no owning goal contract; refusing to judge it", { experimentId: def.experimentId });
        continue;
      }
      const { counts, integrity } = await gatherArmCounts(def);
      const rejectedShare = integrity.visitors > 0 ? integrity.rejected / integrity.visitors : 0;
      const verdict: WebExperimentVerdict =
        integrity.visitors >= 100 && rejectedShare > MAX_REJECTED_SHARE
          ? {
              status: "invalid_design",
              note: `${integrity.rejected} of ${integrity.visitors} exposed visitors reported an arm their visitor id does not derive to (${(rejectedShare * 100).toFixed(1)}%) — forged or double-assigned exposures; the split cannot be trusted`,
            }
          : evaluateWebExperiment(def, counts);
      resolved++;
      outcomes.push(`${def.experimentId}: ${verdict.status}`);
      log.info("web experiment evaluated", { experimentId: def.experimentId, status: verdict.status, counts, integrity, contractHash: owning.hash });

      const line = telegramLine(def, verdict);
      if (line) {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(line).catch(() => undefined);
      }

      const { postToEvidenceLedger } = await import("../../services/evidenceLedger");
      const decisive = verdict.status === "winner" || verdict.status === "guardrail_breach";
      // Evidence thermostat: a randomized verdict is H4. What that grade may
      // AUTHORISE (a promotion recommendation, never a merge) and whether it
      // meets the contract's minimum are written beside the verdict, so the
      // operator reads the authority with the number instead of inferring it.
      const grade = "H4" as const;
      const authority = decisive ? authorityFor(grade) : authorityFor("H1");
      const meetsContractMinimum = decisive && gradeSatisfies(grade, owning.contract.minimumEvidence);
      const verdictOccurredAt = new Date().toISOString();
      await postToEvidenceLedger({
        events: [
          {
            eventType: "experiment.verdict",
            eventVersion: 1,
            occurredAt: verdictOccurredAt,
            observedAt: verdictOccurredAt,
            correlationId: `experiment:${def.experimentId}:${owning.hash}`,
            retentionClass: "evidence",
            objects: [
              { type: "experiment", id: def.experimentId },
              { type: "goal", id: owning.contract.goalId },
              ...def.surfaces.map((s) => ({ type: "route", id: s })),
            ],
            source: { system: "nickstire", uri: "cron:web-experiment-resolve" },
            experiment: { experimentId: def.experimentId, contractHash: owning.hash },
            quality: "derived",
            privacy: "internal",
            payload: { status: verdict.status, note: verdict.note, counts, integrity, authority, meetsContractMinimum, minimumEvidence: owning.contract.minimumEvidence },
          },
        ],
        claims: decisive
          ? [
              {
                claimText: `${verdict.note} [authority: ${authority}; ${meetsContractMinimum ? "meets" : "does NOT meet"} the contract minimum of ${owning.contract.minimumEvidence}]`,
                grade,
                hypothesisId: def.experimentId,
                goalId: owning.contract.goalId,
                contractHash: owning.hash,
                disposition: verdict.status === "winner" ? "supported" : "refuted",
                createdBy: "cron",
                // Lineage: this claim rests on the verdict event posted in the same
                // batch (index 0). The ledger resolves the index to the event's id.
                sourceEventIndexes: [0],
                confidence: 1 - ("primary" in verdict ? verdict.primary.pValue : 1),
              },
            ]
          : [],
      }, {
        // ADR-0019 §4: one fact per (experiment, contract, status[, winning arm]).
        // The daily re-post of an unchanged verdict dedupes in StateNour; a new
        // status, a new winning arm or a re-registered contract is a new fact.
        idempotencyKey: experimentVerdictKey(def.experimentId, owning.hash, verdict),
      });
    } catch (error) {
      outcomes.push(`${def.experimentId}: ERROR`);
      log.warn("web experiment resolve failed", { experimentId: def.experimentId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { recordsProcessed: resolved, details: `${armed.length} armed · ${outcomes.join(" · ")}` };
}

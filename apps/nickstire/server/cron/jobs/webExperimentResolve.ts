/**
 * Web experiment resolver — the daily verdict for every ARMED web experiment.
 *
 * For each experiment whose flag is on: count, per arm, the distinct visitors
 * exposed and the distinct exposed visitors who later fired the primary and
 * guardrail events, hand the counts to the pure kernel, and:
 *
 *   · PROPOSE a winner or a guardrail breach to the operator over Telegram —
 *     never apply it (the flag and the arm copy stay exactly as they are).
 *   · Write a RealityEvent + an EvidenceClaim to the ledger in statenour, so
 *     the verdict and its grade outlive this cron's log line.
 *
 * Stateless on purpose: the mSPRT p-value is always-valid at every read, so
 * there is nothing to carry between days. A day's result IS the record — the
 * ledger keeps it, and the kernel refuses (insufficient_data / no_signal /
 * invalid_design) rather than inventing a verdict on a thin day.
 *
 * Quiet by default: with no armed experiment this is a flag read and a
 * details string, and that must stay distinguishable from a productive run.
 */
import { sql } from "drizzle-orm";
import { createLogger } from "../../lib/logger";
import { evaluateWebExperiment, type ArmMetricCounts, type WebExperimentDefinition, type WebExperimentVerdict } from "../../../shared/experimentKernel";
import { EXPERIMENT_EXPOSURE_EVENT, WEB_EXPERIMENTS, webExperimentFlagKey } from "../../../shared/webExperiments";

const log = createLogger("cron:web-experiment-resolve");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

/**
 * Per-arm counts from customer_events. Exposure = first `experiment_exposure`
 * row per visitor for this experiment; a conversion counts once per exposed
 * visitor and only AFTER that first exposure. TiDB is MySQL-compatible: JSON
 * access is JSON_UNQUOTE(JSON_EXTRACT(...)), never ->> sugar.
 */
export async function gatherArmCounts(def: WebExperimentDefinition): Promise<ArmMetricCounts[]> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return [];
  const metrics = [def.primaryMetric, ...def.guardrails.map((g) => g.metric)];

  const exec = async (q: ReturnType<typeof sql>) => {
    const result = (await d.execute(q)) as unknown;
    return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as Record<string, unknown>[]) : [];
  };

  const out: ArmMetricCounts[] = [];
  for (const arm of def.arms) {
    const exposureRows = await exec(sql`
      SELECT COUNT(*) AS n FROM (
        SELECT sessionId
        FROM customer_events
        WHERE eventName = ${EXPERIMENT_EXPOSURE_EVENT}
          AND sessionId IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.element')) = ${def.experimentId}
          AND JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.props.armId')) = ${arm.armId}
          AND createdAt >= ${def.preregisteredAt}
        GROUP BY sessionId
      ) exposed
    `);
    const exposures = Number(exposureRows[0]?.n ?? 0);
    const conversions: Record<string, number> = {};
    for (const metric of metrics) {
      const rows = await exec(sql`
        SELECT COUNT(DISTINCT c.sessionId) AS n
        FROM (
          SELECT sessionId, MIN(createdAt) AS firstExposure
          FROM customer_events
          WHERE eventName = ${EXPERIMENT_EXPOSURE_EVENT}
            AND sessionId IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.element')) = ${def.experimentId}
            AND JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.props.armId')) = ${arm.armId}
            AND createdAt >= ${def.preregisteredAt}
          GROUP BY sessionId
        ) e
        JOIN customer_events c
          ON c.sessionId = e.sessionId
         AND c.eventName = ${metric}
         AND c.createdAt >= e.firstExposure
      `);
      conversions[metric] = Number(rows[0]?.n ?? 0);
    }
    out.push({ armId: arm.armId, exposures, conversions });
  }
  return out;
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
  const { isEnabled } = await import("../../services/featureFlags");
  const armed: WebExperimentDefinition[] = [];
  for (const e of WEB_EXPERIMENTS) {
    if (await isEnabled(webExperimentFlagKey(e.experimentId) as Parameters<typeof isEnabled>[0])) armed.push(e);
  }
  if (!armed.length) return { recordsProcessed: 0, details: "no armed web experiments" };

  const outcomes: string[] = [];
  let resolved = 0;
  for (const def of armed) {
    try {
      const counts = await gatherArmCounts(def);
      const verdict = evaluateWebExperiment(def, counts);
      resolved++;
      outcomes.push(`${def.experimentId}: ${verdict.status}`);
      log.info("web experiment evaluated", { experimentId: def.experimentId, status: verdict.status, counts });

      const line = telegramLine(def, verdict);
      if (line) {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(line).catch(() => undefined);
      }

      const { postToEvidenceLedger } = await import("../../services/evidenceLedger");
      const decisive = verdict.status === "winner" || verdict.status === "guardrail_breach";
      await postToEvidenceLedger({
        events: [
          {
            eventType: "experiment.verdict",
            objects: [{ type: "experiment", id: def.experimentId }, ...def.surfaces.map((s) => ({ type: "route", id: s }))],
            source: { system: "nickstire", uri: "cron:web-experiment-resolve" },
            experiment: { experimentId: def.experimentId },
            quality: "derived",
            privacy: "internal",
            payload: { status: verdict.status, note: verdict.note, counts },
          },
        ],
        claims: decisive
          ? [
              {
                claimText: verdict.note,
                grade: "H4",
                hypothesisId: def.experimentId,
                disposition: verdict.status === "winner" ? "supported" : "refuted",
                createdBy: "cron",
                confidence: 1 - ("primary" in verdict ? verdict.primary.pValue : 1),
              },
            ]
          : [],
      });
    } catch (error) {
      outcomes.push(`${def.experimentId}: ERROR`);
      log.warn("web experiment resolve failed", { experimentId: def.experimentId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { recordsProcessed: resolved, details: `${armed.length} armed · ${outcomes.join(" · ")}` };
}

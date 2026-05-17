/**
 * /api/cron/schema-drift-watch · v8.6 BATCH 35 · Apr 29.
 *
 * Runs the v8.1 schema-drift sentinel every 6h. When findings appear,
 * emits a BrainMemory category="schema_drift_alert" so the v8.5
 * alert→Telegram bridge can push the warning to Nour's phone.
 *
 * Idempotent: the BrainMemory's @@unique([category, key]) prevents
 * duplicate writes for the same finding within the same hour.
 *
 * Composition:
 *   sentinel → BrainMemory schema_drift_alert
 *            → alert-telegram-push (next 15min)
 *            → Telegram message
 *
 * One-stop "did the DB schema drift?" pipeline, fully closed loop.
 */

import { cronHandler } from "@/lib/utils/http";
import { runSchemaDriftCheck } from "@/lib/db/schema-sentinel";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/schema-drift-watch");

const ALERT_CATEGORY = "schema_drift_alert";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runSchemaDriftCheck();

    if (!report.reachable) {
      // DB unreachable — already reported via the sentinel's findings.
      // Don't write an alert (we can't write to the DB anyway).
      return {
        ok: false,
        durationMs: Date.now() - started,
        reachable: false,
        message: "DB unreachable from sentinel",
      };
    }

    if (report.ok) {
      return {
        ok: true,
        durationMs: Date.now() - started,
        findings: 0,
        alertWritten: false,
      };
    }

    // Findings present. Bucket the alert by hour so a re-run within
    // the same hour doesn't double-write. The brain_memory unique
    // ([category, key]) handles dedup automatically.
    const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const summary =
      `Schema drift detected (${report.findings.length} findings, ` +
      `${report.findings.filter((f) => f.severity === "high").length} high). ` +
      `First: ${report.findings[0]?.problem.slice(0, 200) ?? "(none)"}`;

    let alertWritten = false;
    try {
      await prisma.brainMemory.create({
        data: {
          category: ALERT_CATEGORY,
          key: hourKey,
          content: summary,
          confidence: 0.95,
          source: "cron:schema-drift-watch",
          metadata: {
            checkedAt: report.checkedAt,
            expectationCount: report.expectationCount,
            findingCount: report.findings.length,
            highCount: report.findings.filter((f) => f.severity === "high").length,
            findings: report.findings.slice(0, 20).map((f) => ({
              severity: f.severity,
              problem: f.problem,
              reason: f.expectation.reason,
            })),
          } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      });
      alertWritten = true;
    } catch (err: unknown) {
      // P2002 = already alerted this hour
      if (!(err && typeof err === "object" && (err as { code?: string }).code === "P2002")) {
        log.warn("alert_write_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      ok: true,
      durationMs: Date.now() - started,
      findings: report.findings.length,
      highSeverity: report.findings.filter((f) => f.severity === "high").length,
      alertWritten,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "schema-drift-watch failed",
    };
  }
});

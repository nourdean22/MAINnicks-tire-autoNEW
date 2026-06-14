/**
 * Backfill vapiCallLogs with new unified classification, outcomes, scores, and metadata intents.
 * 
 * Usage:
 *   pnpm run script backfill-vapi-classification [--dry-run] [--limit N]
 */

import { getDb } from "../../server/db";
import { vapiCallLogs } from "../../drizzle/schema";
import { eq, gte, and } from "drizzle-orm";
import { createLogger } from "../../server/lib/logger";
import { classifyCall } from "../../server/services/vapiCallClassifier";
import { getCallStateHistory } from "../../server/services/voice-call-state";

const log = createLogger("scripts:backfill-vapi-classification");

interface CliArgs {
  dryRun: boolean;
  limit: number;
}

interface VapiCallDetail {
  id: string;
  analysis?: {
    summary?: string;
    successEvaluation?: "pass" | "fail" | string;
    structuredData?: {
      outcome?: string;
      sentiment?: "positive" | "neutral" | "negative" | string;
    };
  };
  endedReason?: string;
  durationSeconds?: number;
  type?: string;
  transcript?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, limit: 1000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
  }
  return args;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  log.info("starting classification backfill", args);

  const d = await getDb();
  if (!d) {
    log.error("DB unavailable");
    process.exit(1);
  }

  // 90 days lookback
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const rows = await d
    .select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      endedReason: vapiCallLogs.endedReason,
      aiSummary: vapiCallLogs.aiSummary,
      serviceMention: vapiCallLogs.serviceMention,
      convertedToLead: vapiCallLogs.convertedToLead,
      createdAt: vapiCallLogs.createdAt,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      metadata: vapiCallLogs.metadata,
    })
    .from(vapiCallLogs)
    .where(gte(vapiCallLogs.createdAt, cutoff))
    .limit(args.limit);

  log.info(`loaded ${rows.length} call logs from last 90 days`);

  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_BASE = "https://api.vapi.ai";
  
  let updated = 0;
  let skippedOutbound = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      log.info(`[${i + 1}/${rows.length}] processing call ${row.vapiCallId}`);

      let analysis: VapiCallDetail["analysis"] = undefined;
      let callType: string | null = null;
      let transcript: string | null = null;

      if (VAPI_API_KEY) {
        try {
          const resp = await fetch(`${VAPI_BASE}/call/${row.vapiCallId}`, {
            headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
          });
          if (resp.ok) {
            const detail = await resp.json() as VapiCallDetail;
            analysis = detail.analysis;
            callType = detail.type ?? null;
            transcript = detail.transcript ?? null;
          } else if (resp.status === 429) {
            log.warn("Rate limited, sleeping 2 seconds...");
            await sleep(2000);
            i--; // retry this call
            continue;
          }
        } catch (e) {
          log.warn(`VAPI fetch failed for ${row.vapiCallId}`, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Skip outbound calls
      if (callType === "outboundPhoneCall") {
        if (!args.dryRun) {
          await d.update(vapiCallLogs).set({
            evalOutcome: "outbound",
            evalReasoning: "Outbound call (follow-up / confirmation / recovery) — excluded from the inbound receptionist eval.",
            evalAt: new Date(),
          }).where(eq(vapiCallLogs.id, row.id));
        }
        skippedOutbound++;
        continue;
      }

      // Check tool ground truth
      let reachedTool = false;
      try {
        const states = await getCallStateHistory(row.vapiCallId);
        reachedTool = states.some((s) => s.state === "tool_called" || s.state === "confirmed");
      } catch { /* ignored */ }

      const classificationInput = {
        durationSeconds: row.durationSeconds ?? 0,
        endedReason: row.endedReason,
        aiSummary: row.aiSummary || analysis?.summary || null,
        transcript: transcript,
        convertedToLead: row.convertedToLead,
        leadId: row.leadId,
        callbackId: row.callbackId,
        sentiment: analysis?.structuredData?.sentiment,
        evalOutcome: analysis?.structuredData?.outcome,
        successEvaluation: analysis?.successEvaluation,
        reachedTool,
      };

      const result = classifyCall(classificationInput);
      const score = result.score;
      const bucketed = result.outcome;
      const reasoning = result.reasoning;

      let queueStatus: string | undefined = undefined;
      let queueUrgency: number | undefined = undefined;

      const candidates = ["lost_opportunity", "callback_needed", "walk_in_directed", "tech_failure"];
      if (candidates.includes(result.outcome)) {
        queueStatus = "pending";
        // compute urgency
        if (result.outcome === "callback_needed") {
          queueUrgency = 9;
        } else if (result.outcome === "lost_opportunity") {
          if (result.intents.includes("new_tire") || result.intents.includes("used_tire") || result.intents.includes("brakes")) {
            queueUrgency = 8;
          } else if (result.intents.length > 0) {
            queueUrgency = 7;
          } else {
            queueUrgency = 6;
          }
        } else if (result.outcome === "walk_in_directed") {
          queueUrgency = 6;
        } else if (result.outcome === "tech_failure") {
          queueUrgency = 5;
        } else {
          queueUrgency = 4;
        }
      }

      const existingMetadata = typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : (row.metadata || {});

      const updatedMetadata = {
        ...existingMetadata,
        intents: result.intents,
        ...(queueStatus ? { queueStatus, queueUrgency } : {}),
      };

      log.info(`[Classification] ID: ${row.vapiCallId} | Outcome: ${bucketed} | Score: ${score} | Intents: ${result.intents.join(",")}`);

      if (!args.dryRun) {
        await d
          .update(vapiCallLogs)
          .set({
            evalScore: score,
            evalOutcome: bucketed,
            evalReasoning: reasoning,
            evalAt: new Date(),
            metadata: updatedMetadata,
          })
          .where(eq(vapiCallLogs.id, row.id));
      }
      updated++;
      
      // small delay to prevent hammering VAPI API
      await sleep(100);

    } catch (e) {
      errorCount++;
      log.error(`failed to process call ${row.vapiCallId}`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  log.info("backfill completed", {
    dryRun: args.dryRun,
    totalProcessed: updated + skippedOutbound,
    updated,
    skippedOutbound,
    errors: errorCount,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("backfill failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });

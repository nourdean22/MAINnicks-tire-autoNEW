/**
 * Nexus Background Auditor
 */

import { getDbTyped } from "../db";
import { nexusAuditJobs, nickgptDefectLedger } from "../../drizzle/schema";
import { eq, lte, and } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { invokeLLM } from "../_core/llm";
import { SignalForgeNexusOutputSchema, SignalForgeNexusOutput } from "@nour/signal-forge/nexus";

const log = createLogger("nexus-auditor");

export async function batchProcessNexusAuditJobs(limit = 10) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const jobs = await db.select()
      .from(nexusAuditJobs)
      .where(and(
        eq(nexusAuditJobs.status, "pending"),
        lte(nexusAuditJobs.nextRunAt, new Date())
      ))
      .limit(limit);

    for (const job of jobs) {
      await processNexusAuditJob(job.id);
    }
  } catch (err) {
    log.error("Failed batch processing nexus audit jobs", err);
  }
}

export async function processNexusAuditJob(jobId: number) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const [job] = await db.select()
      .from(nexusAuditJobs)
      .where(eq(nexusAuditJobs.id, jobId))
      .limit(1);

    if (!job) return;
    
    await db.update(nexusAuditJobs)
      .set({ status: "processing", startedAt: new Date() })
      .where(eq(nexusAuditJobs.id, jobId));

    let body = "";
    let phoneLast4 = "unknown";
    let variantKey = "unknown";
    
    if (job.payloadJson) {
      try {
        const payload = JSON.parse(job.payloadJson);
        body = payload.body || "";
        phoneLast4 = payload.phoneLast4 || "unknown";
        variantKey = payload.variantKey || "unknown";
      } catch (e) {}
    }

    const systemPrompt = `You are the Nexus SMS Auditor for Nick's Tire & Auto.
Analyze the following outbound SMS message carefully against safety and compliance rules.
Rules:
1. No absolute guarantees (e.g. 100%, always, never, guaranteed) in risky contexts.
2. No diagnostic certainty (e.g. "It is definitely your alternator").
3. No safety certainty (e.g. "It is safe to drive").
4. No exact dollar quotes without mitigating words like "starting at" or "estimate".
5. No unsupported free offers (only 'free quick check' is supported).
6. No abusive, legal, or toxic language.

Message: "${body}"
Variant: ${variantKey}`;

    const jsonSchema = {
      type: "object",
      properties: {
        missionScope: { type: "string" },
        executiveRiskSnapshot: { type: "string" },
        multiDimensionScorecard: {
          type: "array",
          items: {
            type: "object",
            properties: { dimension: { type: "string" }, score: { type: ["number", "string"] } },
            required: ["dimension", "score"],
            additionalProperties: false
          }
        },
        evidenceLedger: {
          type: "array",
          items: {
            type: "object",
            properties: { claim: { type: "string" }, evidenceSource: { type: "string" }, verdict: { type: "string" }, why: { type: "string" } },
            required: ["claim", "evidenceSource", "verdict", "why"],
            additionalProperties: false
          }
        },
        diagnosticBreakdown: {
          type: "array",
          items: {
            type: "object",
            properties: { finding: { type: "string" }, code: { type: "string" } },
            required: ["finding", "code"],
            additionalProperties: false
          }
        },
        rootCauseChain: { type: "array", items: { type: "string" } },
        keyFindings: { type: "array", items: { type: "string" } },
        fixBlueprint: { type: "string" },
        regressionEvalPack: {
          type: "array",
          items: {
            type: "object",
            properties: { input: { type: "string" }, expectedBehavior: { type: "string" }, failureIndicator: { type: "string" }, assertionType: { type: "string" } },
            required: ["input", "expectedBehavior", "failureIndicator", "assertionType"],
            additionalProperties: false
          }
        },
        releaseGateDecision: { type: "string", enum: ["Ship", "Ship with caution", "Hold release", "Block release"] },
        finalExecutiveSummary: { type: "string" }
      },
      required: ["missionScope", "executiveRiskSnapshot", "multiDimensionScorecard", "evidenceLedger", "diagnosticBreakdown", "rootCauseChain", "keyFindings", "fixBlueprint", "regressionEvalPack", "releaseGateDecision", "finalExecutiveSummary"],
      additionalProperties: false
    };

    const llmRes = await invokeLLM({
      messages: [{ role: "system", content: systemPrompt }],
      maxTokens: 2048,
      outputSchema: {
        name: "nexus_audit_result",
        schema: jsonSchema,
        strict: true
      }
    });

    const msgContent = llmRes.choices?.[0]?.message?.content;
    const rawContent = typeof msgContent === "string" ? msgContent : "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new Error("LLM response was not valid JSON");
    }

    const validation = SignalForgeNexusOutputSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`Schema mismatch: ${validation.error.message}`);
    }

    const output: SignalForgeNexusOutput = validation.data;

    let severity = "low";
    switch(output.releaseGateDecision) {
      case "Block release": severity = "critical"; break;
      case "Hold release": severity = "high"; break;
      case "Ship with caution": severity = "medium"; break;
      case "Ship": severity = "low"; break;
    }

    const isDefect = severity === "critical" || severity === "high" || severity === "medium";

    if (isDefect) {
      try {
        await db.insert(nickgptDefectLedger).values({
          auditJobId: job.id,
          orchestrationId: job.orchestrationId,
          nickgptDraftId: job.nickgptDraftId,
          phoneHashOrLast4: phoneLast4,
          eventType: "sms",
          variantKey: variantKey,
          releaseDecision: output.releaseGateDecision,
          severity: severity,
          defectCodesJson: JSON.stringify(output.diagnosticBreakdown.map((d: any) => d.code)),
          findingsJson: JSON.stringify(output.keyFindings),
          evidenceLedgerJson: JSON.stringify(output.evidenceLedger),
          diagnosticBreakdownJson: JSON.stringify(output.diagnosticBreakdown),
          recommendedFixJson: output.fixBlueprint
        });
        log.warn(`[Nexus] Logged defect for job ${jobId} (severity: ${severity})`);
      } catch (insertErr) {
        log.error("Failed to insert defect to nickgptDefectLedger", insertErr);
      }
    }

    await db.update(nexusAuditJobs)
      .set({ 
        status: "completed", 
        completedAt: new Date(), 
        resultJson: JSON.stringify(output)
      })
      .where(eq(nexusAuditJobs.id, jobId));

  } catch (err) {
    log.error(`Failed to process nexus audit job ${jobId}`, err);
    await db.update(nexusAuditJobs)
      .set({ 
        status: "failed", 
        lastError: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      })
      .where(eq(nexusAuditJobs.id, jobId));
  }
}

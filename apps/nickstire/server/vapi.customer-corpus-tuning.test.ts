import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

describe("VAPI corpus-grounded conversation rules", () => {
  it("starts neutral instead of assuming a used-tire caller", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("# START NEUTRAL");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Most callers want USED TIRES");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Default TIRE-FIRST");
  });

  it("keeps turns short and interactive", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/ONE idea per turn/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/at most ONE question per turn/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/aim for 18 spoken words or fewer/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/deliver ONE beat, pause for the caller/);
  });

  it("does not invent a midday queue condition", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("line gets long mid-day");
  });

  it("does not use the unsupported dealer-chain superiority claim", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Cheaper than the dealer, faster than the chains, more honest than both");
  });

  it("does not diagnose squeaking brakes as probably just pads", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("often still just the pads");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("brake problems usually get more expensive when they wait");
  });
  it("does not use universal competitor-charge claims", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("any other shop charges to even look");
  });

  it("keeps the weekly optimizer aligned with neutral-first behavior", () => {
    const src = readFileSync(new URL("./services/promptEvolution.ts", import.meta.url), "utf8");
    expect(src).not.toContain("keep the tire-first default");
    expect(src).toContain("start neutral and identify the caller's need before specializing");
  });

  it("gives weekly prompt evolution a job-specific budget above the 4-minute default", () => {
    const src = readFileSync(new URL("./cron/scheduler.ts", import.meta.url), "utf8");
    const start = src.indexOf('name: "prompt-evolution-weekly"');
    const end = src.indexOf("},", start);
    const block = src.slice(start, end + 2);
    // 50 minutes since 2026-10-09: a full cycle replays ~170 times at ~20 s each (promptEvolutionWeekly RUN_BUDGET_MS 45 min stops the runner first).
    expect(block).toContain("timeoutMs: 50 * 60 * 1000");
  });

  it("does not stamp every Vapi status update as a greeted call", () => {
    const src = readFileSync(new URL("./routes/webhooks/vapi.ts", import.meta.url), "utf8");
    expect(src).toContain('case "status-update"');
    expect(src).toContain('status === "in-progress"');
    expect(src).not.toContain('case "status-update":\n      case "call-start"');
    expect(src).toContain('case "speech-update"');
  });
  it("persists provider-delivered behavior metadata instead of reconstructing a current-code version later", () => {
    const src = readFileSync(new URL("./routes/webhooks/vapi.ts", import.meta.url), "utf8");
    expect(src).toContain("$.behavior");
    expect(src).toContain("vapi_assistant_metadata");
    expect(src).toContain("assistant_metadata_unavailable");
    expect(src).toContain("meta.nickBehaviorHash");
  });
  it("carries behavior and call-linked arrival evidence into revenue reconciliation without upgrading the verdict", () => {
    const src = readFileSync(new URL("./services/revenueReconciliation.ts", import.meta.url), "utf8");
    expect(src).toContain("metadata: vapiCallLogs.metadata");
    expect(src).toContain("vapiCallId: vapiCallLogs.vapiCallId");
    expect(src).toContain('eq(expectedArrivals.source, "voice")');
    expect(src).toContain('link: "sourceRef=vapiCallId"');
    expect(src).toContain('"reconciled_same_invoice"');
    expect(src).toContain('"reconciled_other_invoice"');
    expect(src).toContain('"same_candidate_invoice"');
    expect(src).toContain('"different_invoice"');
    expect(src).toContain("Number(row.reconciledInvoiceId) === Number(candidate.invoiceId)");
    expect(src).toContain("...(behavior.hash ? { behavior } : {})");
    expect(src).toContain("...(arrivalEvidence ? { arrival: arrivalEvidence } : {})");
  });
  it("labels weekly prompt evolution as offline evidence, not a proven business winner", () => {
    const src = readFileSync(new URL("./cron/jobs/promptEvolutionWeekly.ts", import.meta.url), "utf8");
    // 2026-10-09: the runner now owns the stage (a sealed confirmation can leave a
    // candidate "offline_candidate_unconfirmed"); the job copies it through, and the
    // runner can only ever emit offline stages -- never a served/production one.
    expect(src).toContain("promotionStage: result.promotionStage");
    const runner = readFileSync(new URL("./services/promptEvolution.ts", import.meta.url), "utf8");
    expect(runner).toMatch(/promotionStage: outcome === "accepted" \? "offline_candidate" : outcome === "accepted-unconfirmed" \? "offline_candidate_unconfirmed" : "none"/);
    expect(src).toContain('businessOutcomeEvidence: "not_measured_candidate_has_not_served"');
    expect(src).toContain("OFFLINE CANDIDATE passed the paired holdout permutation test");
    expect(src).toContain("arrival/revenue impact is unmeasured");
  });
  it("uses TiDB JSON functions for Vapi metadata and never logs bound PII params", () => {
    const src = readFileSync(new URL("./routes/webhooks/vapi.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/CAST\(\$\{JSON\.stringify\((?:behavior|speech|stored|claims)\)\} AS JSON\)/);
    for (const value of ["behavior", "speech", "stored", "claims"]) {
      expect(src).toContain(`JSON_EXTRACT(\${JSON.stringify(${value})}, '$')`);
    }
    expect(src).toContain("VAPI_METADATA_CUSTOMER_SPEECH_PERSIST_FAILED");
    expect(src).toContain("VAPI_METADATA_TRANSFER_ARTIFACT_PERSIST_FAILED");
    expect(src).toContain("VAPI_METADATA_VOICE_CLAIM_PERSIST_FAILED");
    expect(src).toContain("transfer artifact persisted");
    expect(src).not.toContain("error: transferErr instanceof Error ? transferErr.message");
    expect(src).not.toContain("error: speechErr instanceof Error ? speechErr.message");
    expect(src).not.toContain("error: claimErr instanceof Error ? claimErr.message");
  });

  it("runs the richer demand classifier in shadow without changing the incumbent decision path", () => {
    const src = readFileSync(new URL("./cron/jobs/vapiCallEval.ts", import.meta.url), "utf8");
    expect(src).toContain("classifyVoiceDemand(speech.firstSubstantive)");
    expect(src).toContain("demandShadowV1");
    expect(src).toContain("VOICE_DEMAND_CLASSIFIER_VERSION");
    expect(src).toContain("incumbentIntents: result.intents");
    expect(src).toContain("incumbentOutcome: result.outcome");
    expect(src).toContain("demandShadowClassified");
    expect(src).toContain("demandShadowUnclear");
    expect(src).toContain("demandShadowLowConfidence");
    // The real disposition still consumes the incumbent result, not shadow.
    expect(src).toContain("outcome: result.outcome");
    expect(src).not.toContain("outcome: demandShadow.intent");
  });

});

import { SignalControlForgeOutputSchema } from "../control-forge/schemas/output.js";
import { SignalForgeNexusOutputSchema } from "../nexus/schemas/output.js";

// Note: Section headers exactly matching requirements for testing
export function renderControlForgeMarkdown(data: any): string {
  // Simple check
  if (!data || !data.executiveVerdict) {
    throw new Error("Invalid output data");
  }

  // 1 through 19 exact order
  return `
# 1. Executive Verdict
${data.executiveVerdict}

# 2. Confidence Level
${data.confidenceLevel}

# 3. Task Restatement
${data.taskRestatement}

# 4. Objective Breakdown
${data.objectiveBreakdown?.join("\\n- ")}

# 5. Input Audit
${data.inputAudit}

# 6. Constraint Audit
${data.constraintAudit}

# 7. Risk Audit
${data.riskAudit}

# 8. Workflow Score Breakdown
Score: ${data.workflowScoreBreakdown?.totalScore || 0}
Dimensions:
${data.workflowScoreBreakdown?.dimensions?.map((d: any) => `- ${d.dimension}: ${d.score}`).join("\\n")}

# 9. Workflow Decision
${data.workflowDecision}

# 10. Why This Design Wins
${data.whyThisDesignWins}

# 11. Architecture Summary
${data.architectureSummary}

# 12. Role Roster
${data.roleRoster?.map((r: any) => `## ${r.roleName}\\nMission: ${r.mission}`).join("\\n\\n")}

# 13. Handoff Contracts
${data.handoffContracts?.map((h: any) => `From ${h.sourceRole} to ${h.targetRole}`).join("\\n")}

# 14. Validation Gates
${data.validationGates?.map((g: any) => `Gate: ${g.description}`).join("\\n")}

# 15. Failure Containment Plan
${data.failureContainmentPlan?.map((f: any) => `Detection: ${f.detection} -> Fallback: ${f.fallback}`).join("\\n")}

# 16. Prompt Stubs
${data.promptStubs?.map((p: any) => `Stub for ${p.roleName}\\n\`\`\`\\n${p.stub}\\n\`\`\``).join("\\n\\n")}

# 17. Compact Output Schemas
${data.compactOutputSchemas?.map((s: any) => `Schema: ${s.schemaName}`).join("\\n")}

# 18. Implementation Notes
${data.implementationNotes}

# 19. Final Recommendation
${data.finalRecommendation}
  `.trim() + "\\n";
}

export function renderNexusMarkdown(data: any): string {
  if (!data || !data.missionScope) {
    throw new Error("Invalid output data");
  }

  // 1 through 11 exact order
  return `
# 1. Mission Scope
${data.missionScope}

# 2. Executive Risk Snapshot
${data.executiveRiskSnapshot}

# 3. Multi-Dimension Scorecard
${data.multiDimensionScorecard?.map((s: any) => `- ${s.dimension}: ${s.score}`).join("\\n")}

# 4. Evidence Ledger
${data.evidenceLedger?.map((e: any) => `Claim: ${e.claim}\\nVerdict: ${e.verdict}\\nWhy: ${e.why}`).join("\\n\\n")}

# 5. Diagnostic Breakdown
${data.diagnosticBreakdown?.map((d: any) => `Finding: ${d.finding}\\nCode: ${d.code}`).join("\\n\\n")}

# 6. Root Cause Chain
${data.rootCauseChain?.join("\\n-> ")}

# 7. Key Findings
${data.keyFindings?.join("\\n- ")}

# 8. Fix Blueprint
${data.fixBlueprint}

# 9. Regression Eval Pack
${data.regressionEvalPack?.map((r: any) => `Test: ${r.input} -> Expected: ${r.expectedBehavior}`).join("\\n")}

# 10. Release Gate Decision
${data.releaseGateDecision}

# 11. Final Executive Summary
${data.finalExecutiveSummary}
  `.trim() + "\\n";
}

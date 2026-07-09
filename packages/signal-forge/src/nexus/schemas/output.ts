import { z } from "zod";

export const EvidenceLedgerSchema = z.object({
  claim: z.string(),
  evidenceSource: z.string(),
  verdict: z.string(), // "supported", "unsupported", "weakly supported", "unverifiable", "structural risk"
  why: z.string()
});

export const DefectFindingSchema = z.object({
  finding: z.string(),
  code: z.string()
});

export const RegressionEvalSchema = z.object({
  input: z.string(),
  expectedBehavior: z.string(),
  failureIndicator: z.string(),
  assertionType: z.string()
});

export const SignalForgeNexusOutputSchema = z.object({
  missionScope: z.string(),
  executiveRiskSnapshot: z.string(),
  multiDimensionScorecard: z.array(z.object({
    dimension: z.string(),
    score: z.union([z.number(), z.literal("N/A")])
  })),
  evidenceLedger: z.array(EvidenceLedgerSchema),
  diagnosticBreakdown: z.array(DefectFindingSchema),
  rootCauseChain: z.array(z.string()),
  keyFindings: z.array(z.string()),
  fixBlueprint: z.string(),
  regressionEvalPack: z.array(RegressionEvalSchema),
  releaseGateDecision: z.enum(["Ship", "Ship with caution", "Hold release", "Block release"]),
  finalExecutiveSummary: z.string()
});

export type SignalForgeNexusOutput = z.infer<typeof SignalForgeNexusOutputSchema>;

import { z } from "zod";

export const SignalForgeNexusInputSchema = z.object({
  auditObjective: z.string(),
  systemOrAgentContext: z.string(),
  traceAndEvidence: z.string(),
  referenceRulesOrMaterial: z.string(),
  outputPreferences: z.string(),
  businessRiskContext: z.string().optional(),
  systemName: z.string().optional(),
  modelStack: z.string().optional(),
  workflowType: z.string().optional(),
  toolsUsed: z.array(z.string()).optional(),
  retrievedChunks: z.array(z.string()).optional(),
  finalAnswer: z.string().optional(),
  toolCalls: z.array(z.string()).optional(),
  toolResults: z.array(z.string()).optional(),
  logs: z.array(z.string()).optional(),
  citations: z.array(z.string()).optional(),
  incidentNotes: z.string().optional(),
  expectedBehavior: z.string().optional(),
  policyRules: z.array(z.string()).optional(),
  escalationRules: z.array(z.string()).optional(),
  deploymentPressure: z.string().optional(),
  knownFailureSymptoms: z.array(z.string()).optional(),
  strictnessLevel: z.string().optional(),
  releaseDecisionRequired: z.boolean().optional(),
  regressionTestCount: z.number().optional(),
});

export type SignalForgeNexusInput = z.infer<typeof SignalForgeNexusInputSchema>;

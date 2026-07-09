import { z } from "zod";

export const RoleSchema = z.object({
  roleName: z.string(),
  mission: z.string(),
  whyThisRoleExists: z.string(),
  scopeBoundary: z.string(),
  inputs: z.array(z.string()),
  outputContract: z.string(),
  allowedTools: z.array(z.string()),
  forbiddenTools: z.array(z.string()),
  successCondition: z.string(),
  failureTriggers: z.array(z.string()),
  retryRule: z.string(),
  fallbackRule: z.string(),
  handoffTarget: z.string(),
  promptStub: z.string(),
});

export const SignalControlForgeOutputSchema = z.object({
  executiveVerdict: z.string(),
  confidenceLevel: z.string(),
  taskRestatement: z.string(),
  objectiveBreakdown: z.array(z.string()),
  inputAudit: z.string(),
  constraintAudit: z.string(),
  riskAudit: z.string(),
  workflowScoreBreakdown: z.object({
    totalScore: z.number(),
    dimensions: z.array(z.object({
      dimension: z.string(),
      score: z.number()
    }))
  }),
  workflowDecision: z.enum(["single_agent", "single_agent_with_tools", "multi_agent"]),
  whyThisDesignWins: z.string(),
  architectureSummary: z.string(),
  roleRoster: z.array(RoleSchema),
  handoffContracts: z.array(z.object({
    sourceRole: z.string(),
    targetRole: z.string(),
    contract: z.string()
  })),
  validationGates: z.array(z.object({
    description: z.string(),
    failureResponse: z.string()
  })),
  failureContainmentPlan: z.array(z.object({
    detection: z.string(),
    fallback: z.string()
  })),
  promptStubs: z.array(z.object({
    roleName: z.string(),
    stub: z.string()
  })),
  compactOutputSchemas: z.array(z.object({
    schemaName: z.string(),
    schemaStructure: z.unknown()
  })),
  implementationNotes: z.string(),
  finalRecommendation: z.string(),
});

export type SignalControlForgeOutput = z.infer<typeof SignalControlForgeOutputSchema>;

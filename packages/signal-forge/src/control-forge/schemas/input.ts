import { z } from "zod";

export const SignalControlForgeInputSchema = z.object({
  promptProductName: z.string(),
  defaultLanguage: z.string(),
  primaryUseCase: z.string(),
  designPrinciple: z.string(),
  coreTask: z.string(),
  contextAndMaterials: z.string(),
  toolsAndLimits: z.string(),
  deliverablePackage: z.string(),
  precisionRequirements: z.string(),
  maxAgentCount: z.number().optional(),
  preferredWorkflowStyle: z.string().optional(),
  runtimeLimitSeconds: z.number().optional(),
  budgetLimit: z.number().optional(),
  allowedTools: z.array(z.string()).optional(),
  forbiddenTools: z.array(z.string()).optional(),
  complianceLimits: z.array(z.string()).optional(),
  privacyLimits: z.array(z.string()).optional(),
  platformRestrictions: z.array(z.string()).optional(),
  outputConsumer: z.string().optional(),
  successDefinition: z.string().optional(),
  failureDefinition: z.string().optional(),
  sourceMaterials: z.array(z.string()).optional(),
  evidenceRequirements: z.string().optional(),
  approvalRequirements: z.string().optional(),
  examples: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type SignalControlForgeInput = z.infer<typeof SignalControlForgeInputSchema>;

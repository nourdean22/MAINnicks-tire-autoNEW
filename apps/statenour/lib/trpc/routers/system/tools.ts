import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import {
  getToolCapabilities,
  getToolHealthSummary,
  getMissingEnvForTool
} from "@/lib/tools/tool-registry";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { buildToolGapReport } from "@/lib/observability/tool-gap-report";
import { buildDecisionPlaneReport } from "@/lib/observability/decision-plane-report";
import {
  buildDecisionPlaneReplayReport,
  recordDecisionPlaneOutcome,
  RecordDecisionPlaneOutcomeSchema,
} from "@/lib/ai/decision-plane/replay";
import {
  buildCapabilityLifecycleReport,
  proposeCapability,
  transitionCapabilityProposal,
  CapabilityProposalSchema,
  CapabilityTransitionSchema,
} from "@/lib/tools/capability-lifecycle";
import {
  buildCostPerOutcomeAttribution,
  recordValueObservation,
  ValueObservationSchema,
} from "@/lib/intelligence/value-attribution";

const ToolActionRequestSchema = z.object({
  toolId: z.string(),
  actionType: z.string(),
  targetDomain: z.string().optional(),
  requestedBy: z.string().optional(),
  externalMutation: z.boolean().optional(),
  memoryWriteRequested: z.boolean().optional(),
  costEstimate: z.number().optional(),
  destructive: z.boolean().optional(),
  containsExternalContent: z.boolean().optional(),
  hasPriorApproval: z.boolean().optional(),
});

export const toolsProcedures = {
  getTools: operatorProcedure.query(async () => {
    const capabilities = getToolCapabilities();
    const healthSummary = getToolHealthSummary();

    return capabilities.map((cap) => {
      const healthInfo = healthSummary.find((h) => h.id === cap.id);
      return {
        ...cap,
        health: healthInfo?.health ?? "inert",
        missingEnv: healthInfo?.missingEnv ?? [],
      };
    });
  }),

  toolGapReport: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => buildToolGapReport(input?.windowDays ?? 30)),

  decisionPlaneReport: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => buildDecisionPlaneReport(input?.windowDays ?? 30)),

  decisionPlaneReplayReport: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => buildDecisionPlaneReplayReport(input?.windowDays ?? 30)),

  recordDecisionPlaneOutcome: operatorProcedure
    .input(RecordDecisionPlaneOutcomeSchema)
    .mutation(async ({ input }) => recordDecisionPlaneOutcome(input)),

  capabilityLifecycleReport: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => buildCapabilityLifecycleReport(input?.windowDays ?? 30)),

  proposeCapability: operatorProcedure
    .input(CapabilityProposalSchema)
    .mutation(async ({ input }) => proposeCapability(input)),

  transitionCapabilityProposal: operatorProcedure
    .input(CapabilityTransitionSchema)
    .mutation(async ({ input }) => transitionCapabilityProposal(input)),

  costPerOutcomeAttribution: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(7) }).optional())
    .query(async ({ input }) => buildCostPerOutcomeAttribution(input?.windowDays ?? 7)),

  recordValueObservation: operatorProcedure
    .input(ValueObservationSchema)
    .mutation(async ({ input }) => recordValueObservation(input)),

  evaluateTool: operatorProcedure
    .input(ToolActionRequestSchema)
    .mutation(async ({ input }) => {
      return evaluateToolAction(input);
    }),
};

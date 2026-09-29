import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import {
  getToolCapabilities,
  getToolHealthSummary,
  getMissingEnvForTool
} from "@/lib/tools/tool-registry";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { buildToolGapReport } from "@/lib/observability/tool-gap-report";

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

  evaluateTool: operatorProcedure
    .input(ToolActionRequestSchema)
    .mutation(async ({ input }) => {
      return evaluateToolAction(input);
    }),
};

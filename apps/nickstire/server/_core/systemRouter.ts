import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getLlmLedgerSummary } from "../services/llmLedgerRead";

export const systemRouter = router({
  /**
   * Per-lane LLM usage — the first consumer the llm_calls table has ever had.
   *
   * Lives on `system.` deliberately: shared/adminPermissions.ts maps that
   * prefix to settings.manage (owner/manager), and these rows carry model
   * names, lane names and the first 200 chars of provider errors — closer to
   * system telemetry than to a reports.view dashboard read. Putting it here
   * also means no change to the permission resolver, so
   * adminPermissionCoverage.test.ts keeps its shape.
   */
  llmLedger: adminProcedure
    .input(z.object({ windowDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7) }))
    .query(({ input }) => getLlmLedgerSummary(input.windowDays)),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});

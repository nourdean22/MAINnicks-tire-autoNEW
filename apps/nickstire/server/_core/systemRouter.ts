import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getLlmLedgerSummary } from "../services/llmLedgerRead";

export const systemRouter = router({
  /**
   * Per-lane LLM usage — the first consumer the llm_calls table has ever had.
   *
   * Permission is an EXACT-PATH override to reports.view in
   * shared/adminPermissions.ts, not the `system.*` prefix default. The first
   * draft relied on that prefix (settings.manage) and shipped a
   * guaranteed-forbidden panel: this mounts on Intelligence HQ's default tab,
   * registry.tsx grants that section to `viewer`, and viewer does not hold
   * settings.manage — so a viewer's only possible outcome was a failed request
   * rendered as "Ledger unreadable", blaming the database for a permission
   * decision. reports.view matches what `intelligence.*` on the same page
   * already uses, and the projection deliberately excludes the `error` column
   * so no provider error text or prompt fragment leaves the server.
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

/**
 * Vapi Admin Router — manage the AI receptionist from /admin.
 *
 * Endpoints:
 *  · status         — connection state + assistant count (admin badge)
 *  · createAssistant — one-time setup mutation
 *  · updateAssistant — re-push the latest prompt + tools to Vapi
 *  · recentCalls    — paginated call log for admin monitor panel
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";

export const vapiRouter = router({
  status: adminProcedure.query(async () => {
    const { getVapiStatus } = await import("../services/vapi");
    return getVapiStatus();
  }),

  createAssistant: adminProcedure
    .input(z.object({ serverUrl: z.string().url().optional() }).optional())
    .mutation(async ({ input }) => {
      const { createProductionAssistant } = await import("../services/vapi");
      // Default the webhook to nickstire.org/api/webhooks/vapi if not provided
      const serverUrl = input?.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      return createProductionAssistant(serverUrl);
    }),

  updateAssistant: adminProcedure
    .input(z.object({
      assistantId: z.string().min(1).max(100),
      serverUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateAssistant } = await import("../services/vapi");
      const serverUrl = input.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      return updateAssistant(input.assistantId, serverUrl);
    }),

  recentCalls: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentCalls } = await import("../services/vapi");
      return getRecentCalls(input?.limit ?? 20);
    }),
});

/**
 * Callback router — handles callback request submissions and admin management.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { createCallbackRequest, getCallbackRequests, updateCallbackStatus } from "../db";
import { notifyOwner } from "../_core/notification";
import { syncLeadToSheet } from "../sheets-sync";
import { sendSms, callbackConfirmationSms } from "../sms";
import { z } from "zod";
import { leads } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const callbackRouter = router({
  submit: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(7).max(20),
      context: z.string().optional(),
      sourcePage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await createCallbackRequest({
        name: input.name,
        phone: input.phone,
        context: input.context || null,
        sourcePage: input.sourcePage || null,
      });

      const d = await db();
      if (d) {
        await d.insert(leads).values({
          name: input.name,
          phone: input.phone,
          source: "callback",
          problem: input.context || "Callback request from " + (input.sourcePage || "website"),
          urgencyScore: 4,
          urgencyReason: "Customer requested immediate callback",
        }).catch(() => {});
      }

      await notifyOwner({
        title: `Callback Request: ${input.name}`,
        content: `Phone: ${input.phone}\nPage: ${input.sourcePage || "Unknown"}\nContext: ${input.context || "None"}\n\nPlease call back ASAP.`,
      }).catch(() => {});

      sendSms(input.phone, callbackConfirmationSms(input.name)).catch(err =>
        console.error("[SMS] Callback confirmation failed:", err)
      );

      syncLeadToSheet({
        name: input.name,
        phone: input.phone,
        source: "callback",
        problem: "Callback request",
        urgencyScore: 4,
        urgencyReason: "Customer requested callback",
      }).catch(() => {});

      return result;
    }),

  list: adminProcedure.query(async () => {
    return getCallbackRequests();
  }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "called", "no-answer", "completed"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateCallbackStatus(input.id, input.status, input.notes);
    }),
});

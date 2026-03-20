/**
 * Lead router — handles lead capture, CRM, and AI scoring.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { notifyNewLead } from "../email-notify";
import { scoreLead } from "../gemini";
import { syncLeadToSheet, getSpreadsheetUrl, isSheetConfigured } from "../sheets-sync";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { leads } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const leadRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(7).max(20),
        email: z.string().email().optional().or(z.literal("")),
        vehicle: z.string().optional(),
        problem: z.string().optional(),
        source: z.enum(["popup", "chat", "booking", "manual", "callback", "fleet"]).default("popup"),
        companyName: z.string().optional(),
        fleetSize: z.number().optional(),
        vehicleTypes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
      // Sanitize user inputs
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      const email = input.email ? sanitizeEmail(input.email) : null;
      const vehicle = sanitizeText(input.vehicle);
      const problem = sanitizeText(input.problem);

      const d = await db();
      if (!d) throw new Error("Database not available");

      let scoring = { score: 3, reason: "Manual review recommended", recommendedService: "General Repair" };
      if (problem) {
        scoring = await scoreLead(problem, vehicle);
      }
      if (input.source === "fleet") {
        scoring.score = 5;
        scoring.reason = "Fleet/commercial account inquiry";
        scoring.recommendedService = "Fleet Services";
      }

      await d.insert(leads).values({
        name,
        phone,
        email: email || null,
        vehicle: vehicle || null,
        problem: problem || null,
        source: input.source,
        urgencyScore: scoring.score,
        urgencyReason: scoring.reason,
        recommendedService: scoring.recommendedService,
        companyName: input.companyName || null,
        fleetSize: input.fleetSize || null,
        vehicleTypes: input.vehicleTypes || null,
      });

      syncLeadToSheet({
        name: input.name,
        phone: input.phone,
        email: input.email,
        vehicle: input.vehicle,
        problem: input.problem,
        source: input.source,
        urgencyScore: scoring.score,
        urgencyReason: scoring.reason,
        recommendedService: scoring.recommendedService,
      }).catch(err => console.error("[Sheets] Lead sync failed:", err));

      // Send email notification for all leads (routing handles urgency)
      notifyNewLead({
        name: input.name,
        phone: input.phone,
        email: input.email || undefined,
        source: input.source,
        vehicle: input.vehicle || undefined,
        problem: input.problem || undefined,
        urgencyScore: scoring.score,
        urgencyReason: scoring.reason,
        recommendedService: scoring.recommendedService,
        companyName: input.companyName || undefined,
        fleetSize: input.fleetSize || undefined,
        vehicleTypes: input.vehicleTypes || undefined,
      }).catch(err => console.error("[Lead] Email notification failed:", err));

      return {
        success: true,
        urgencyScore: scoring.score,
        recommendedService: scoring.recommendedService,
      };
      } catch (err) {
        console.error("[Lead] Submit failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We couldn't save your information. Please call us at (216) 862-0005." });
      }
    }),

  list: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(leads).orderBy(desc(leads.createdAt));
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["new", "contacted", "booked", "closed", "lost"]).optional(),
        contacted: z.number().min(0).max(1).optional(),
        contactedBy: z.string().optional(),
        contactNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const { id, ...updates } = input;
      const setObj: Record<string, unknown> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.contacted !== undefined) {
        setObj.contacted = updates.contacted;
        if (updates.contacted === 1) setObj.contactedAt = new Date();
      }
      if (updates.contactedBy !== undefined) setObj.contactedBy = updates.contactedBy;
      if (updates.contactNotes !== undefined) setObj.contactNotes = updates.contactNotes;
      await d.update(leads).set(setObj).where(eq(leads.id, id));
      return { success: true };
    }),

  sheetUrl: adminProcedure.query(() => {
    return { url: getSpreadsheetUrl(), configured: isSheetConfigured() };
  }),
});

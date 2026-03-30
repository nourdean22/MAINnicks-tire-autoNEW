/**
 * Fleet Router — Multi-vehicle fleet account management
 */
import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";

export const fleetRouter = router({
  inquiry: publicProcedure
    .input(z.object({
      companyName: z.string().min(1).max(200),
      contactName: z.string().min(1).max(200),
      contactPhone: z.string().min(10).max(20),
      contactEmail: z.string().email().optional(),
      fleetSize: z.number().min(1),
      vehicleTypes: z.string().optional(),
      servicesNeeded: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Create as a lead with fleet tag
      const { getDb } = await import("../db");
      const { leads } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(leads).values({
        name: `${input.contactName} (${input.companyName})`,
        phone: input.contactPhone,
        email: input.contactEmail ?? undefined,
        problem: `Fleet: ${input.fleetSize} vehicles - ${input.servicesNeeded || "General"}. ${input.notes || `Vehicle types: ${input.vehicleTypes || "Mixed"}`}`,
        source: "fleet",
        companyName: input.companyName,
        fleetSize: input.fleetSize,
        vehicleTypes: input.vehicleTypes || null,
      });
      return { success: true, message: "Fleet inquiry received. We'll call you within 1 business day." };
    }),

  getInquiries: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { leads } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];
    return db.select().from(leads).where(eq(leads.source, "fleet"));
  }),
});

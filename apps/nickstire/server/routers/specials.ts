/**
 * Specials/Promotions Router — CRUD for active deals
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:specials");
export const specialsRouter = router({
  getActive: publicProcedure.query(async () => {
    try {
      const { cached } = await import("../lib/cache");
      return cached("specials:active", 300, async () => {
        const { getDb } = await import("../db");
        const { specials } = await import("../../drizzle/schema");
        const db = await getDb();
        if (!db) return [];
        const now = new Date();
        const results = await db.select().from(specials)
          .where(eq(specials.isActive, true))
          .limit(20);
        return results.filter((s: typeof specials.$inferSelect) => !s.expiresAt || new Date(s.expiresAt) > now);
      });
    } catch (err) {
      log.error("[Specials] Failed to fetch specials:", err instanceof Error ? err.message : err);
      return [];
    }
  }),

  /** Admin: ALL specials regardless of active/expiry, newest-first. Powers the manager's audit/history view. */
  all: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { specials } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return [];
    return db.select().from(specials).orderBy(desc(specials.createdAt));
  }),

  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      description: z.string().optional(),
      discountType: z.enum(["percent", "fixed", "free_service", "bundle"]),
      discountValue: z.number().optional(),
      serviceCategory: z.string().optional(),
      couponCode: z.string().optional(),
      startsAt: z.string(),
      expiresAt: z.string().optional(),
      maxUses: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { specials } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      await db.insert(specials).values({
        id,
        title: input.title,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue ? String(input.discountValue) : undefined,
        serviceCategory: input.serviceCategory,
        couponCode: input.couponCode,
        startsAt: new Date(input.startsAt),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        maxUses: input.maxUses,
      });
      return { id, success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { specials } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(specials).where(eq(specials.id, input.id));
      return { success: true };
    }),

  /** Seed DB with standard specials (run once from admin) */
  seed: adminProcedure.mutation(async () => {
    const { getDb } = await import("../db");
    const { specials } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Relative date window so seeded specials are live immediately and
    // stay visible for 30 days. Hardcoded April/May 2026 windows were
    // already expired by the time anyone clicked Seed, so getActive's
    // expiry filter hid them instantly. Discount VALUES are unchanged.
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const SEED_SPECIALS = [
      { title: "Conventional Oil Change", description: "Full conventional oil change with filter replacement. Includes complimentary multi-point vehicle inspection.", discountType: "fixed" as const, discountValue: "20", serviceCategory: "oil-change", couponCode: "OILSAVE20", startsAt, expiresAt, maxUses: 100 },
      { title: "Economy Brake Pad Replacement", description: "New economy brake pads installed per axle. Includes rotor inspection and brake system check.", discountType: "fixed" as const, discountValue: "50", serviceCategory: "brakes", couponCode: "BRAKES50", startsAt, expiresAt, maxUses: 50 },
      { title: "Free Diagnostic Scan", description: "Check engine light on? Free OBD-II diagnostic scan with any repair over $200.", discountType: "free_service" as const, discountValue: "89.99", serviceCategory: "diagnostics", couponCode: "FREESCAN", startsAt, expiresAt, maxUses: 100 },
      { title: "Tire Rotation", description: "Extend tire life with professional 4-tire rotation. Includes pressure check and visual inspection. Free for life when you buy your tires from us.", discountType: "fixed" as const, discountValue: "10", serviceCategory: "tires", couponCode: "ROTATE10", startsAt, expiresAt, maxUses: 100 },
      { title: "AC System Inspection", description: "Refrigerant level check and visual inspection of AC components. Stay cool this summer.", discountType: "fixed" as const, discountValue: "40", serviceCategory: "ac-repair", couponCode: "COOLOFF40", startsAt, expiresAt, maxUses: 50 },
      { title: "Winter Prep Package", description: "Battery load test, coolant strength check, brake inspection, and full tire evaluation — all in one visit.", discountType: "fixed" as const, discountValue: "60", serviceCategory: "general-repair", couponCode: "WINTERPREP", startsAt, expiresAt, maxUses: 100 },
    ];

    let seeded = 0;
    for (const s of SEED_SPECIALS) {
      try {
        await db.insert(specials).values({ id: randomUUID(), ...s, isActive: true });
        seeded++;
      } catch {
        // May already exist — skip
      }
    }

    // Clear cache
    try { const { cacheDelete } = await import("../lib/cache"); await cacheDelete("specials:active"); } catch {}

    return { seeded, total: SEED_SPECIALS.length };
  }),
});

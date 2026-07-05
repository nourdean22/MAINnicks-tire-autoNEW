/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, router } from "../../_core/trpc";
import { getAnalyticsSnapshots, getBookingServiceBreakdown } from "../../db";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { bookings, leads } from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";



export const analyticsRouter = router({
  snapshots: adminProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      return getAnalyticsSnapshots(input?.days ?? 30);
    }),
  serviceBreakdown: adminProcedure.query(async () => {
    return getBookingServiceBreakdown();
  }),
  funnel: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { bookings: 0, leads: 0, completed: 0, converted: 0 };
    const [bookingCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings);
    const [leadCount] = await d.select({ count: sql<number>`count(*)` }).from(leads);
    const [completedCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings).where(eq(bookings.status, "completed"));
    const [convertedCount] = await d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "booked"));
    return {
      bookings: bookingCount?.count ?? 0,
      leads: leadCount?.count ?? 0,
      completed: completedCount?.count ?? 0,
      converted: convertedCount?.count ?? 0,
    };
  }),
});

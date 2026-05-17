/**
 * Advanced Features Router — Job Assignments, Invoices, CLV, KPIs, Customer Portal
 * AUDIT-FIXED: Rate limiting, session cleanup, invoice CRUD, optimized KPI, auto-stage
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { z } from "zod";
import { BUSINESS } from "../../../shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { eq, desc, gte, lte, and, sql, asc } from "drizzle-orm";
import {
  jobAssignments, invoices, customerMetrics, kpiSnapshots, portalSessions,
  bookings, customers, technicians, reviewRequests, leads, serviceHistory,
} from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:advanced");
// ─── JOB ASSIGNMENTS ────────────────────────────────────
// ─── JOB ASSIGNMENTS ────────────────────────────────────
export const jobAssignmentsRouter = router({
  /** Assign a technician to a booking — also auto-updates stage to inspecting */
  assign: adminProcedure
    .input(z.object({
      bookingId: z.number(),
      technicianId: z.number(),
      estimatedHours: z.string().max(20).optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      // Check if already assigned
      const existing = await d.select().from(jobAssignments)
        .where(and(eq(jobAssignments.bookingId, input.bookingId), eq(jobAssignments.technicianId, input.technicianId)))
        .limit(1);
      if (existing.length > 0) {
        await d.update(jobAssignments).set({
          estimatedHours: input.estimatedHours || null,
          notes: input.notes || null,
        }).where(eq(jobAssignments.id, existing[0].id));
        return { success: true, id: existing[0].id };
      }
      const result = await d.insert(jobAssignments).values({
        bookingId: input.bookingId,
        technicianId: input.technicianId,
        estimatedHours: input.estimatedHours || null,
        notes: input.notes || null,
      });

      // Auto-update booking stage to "inspecting" if still "received"
      const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
      if (booking && booking.stage === "received") {
        await d.update(bookings).set({
          stage: "inspecting",
          stageUpdatedAt: new Date(),
        }).where(eq(bookings.id, input.bookingId));
      }

      return { success: true, id: Number(result[0].insertId) };
    }),

  /** Unassign a technician */
  unassign: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      await d.delete(jobAssignments).where(eq(jobAssignments.id, input.id));
      return { success: true };
    }),

  /** Start timer for a job — also auto-updates stage to in-progress */
  startTimer: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();
      await d.update(jobAssignments).set({ startedAt: now }).where(eq(jobAssignments.id, input.id));

      // Auto-update booking stage to "in-progress"
      const [assignment] = await d.select().from(jobAssignments).where(eq(jobAssignments.id, input.id)).limit(1);
      if (assignment) {
        await d.update(bookings).set({
          stage: "in-progress",
          stageUpdatedAt: now,
        }).where(eq(bookings.id, assignment.bookingId));
      }

      return { success: true };
    }),

  /** Stop timer for a job — also auto-updates stage to quality-check */
  stopTimer: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();
      await d.update(jobAssignments).set({ completedAt: now }).where(eq(jobAssignments.id, input.id));

      // Auto-update booking stage to "quality-check"
      const [assignment] = await d.select().from(jobAssignments).where(eq(jobAssignments.id, input.id)).limit(1);
      if (assignment) {
        await d.update(bookings).set({
          stage: "quality-check",
          stageUpdatedAt: now,
        }).where(eq(bookings.id, assignment.bookingId));
      }

      return { success: true };
    }),

  /** Get all assignments for a booking */
  byBooking: adminProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const assignments = await d.select().from(jobAssignments)
        .where(eq(jobAssignments.bookingId, input.bookingId))
        .orderBy(desc(jobAssignments.createdAt));
      // Enrich with technician names
      const techIds = Array.from(new Set(assignments.map((a: typeof assignments[number]) => a.technicianId)));
      const techs = techIds.length > 0
        ? await d.select().from(technicians).where(sql`${technicians.id} IN (${sql.join(techIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const techMap = new Map(techs.map((t: typeof techs[number]) => [t.id, t]));
      return assignments.map((a: typeof assignments[number]) => ({
        ...a,
        technician: techMap.get(a.technicianId) || null,
      }));
    }),

  /** Get all active assignments (for workload view) */
  active: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    const assignments = await d.select().from(jobAssignments)
      .where(sql`${jobAssignments.completedAt} IS NULL`)
      .orderBy(desc(jobAssignments.createdAt));
    return assignments;
  }),

  /** Technician workload summary */
  workload: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    const techs = await d.select().from(technicians).where(eq(technicians.isActive, 1));
    const activeJobs = await d.select().from(jobAssignments)
      .where(sql`${jobAssignments.completedAt} IS NULL`);
    return techs.map((t: typeof techs[number]) => ({
      id: t.id,
      name: t.name,
      title: t.title,
      photoUrl: t.photoUrl,
      activeJobs: activeJobs.filter((j: typeof activeJobs[number]) => j.technicianId === t.id).length,
      assignments: activeJobs.filter((j: typeof activeJobs[number]) => j.technicianId === t.id),
    }));
  }),
});

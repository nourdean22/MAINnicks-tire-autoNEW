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

// ─── CUSTOMER PORTAL ────────────────────────────────────
export const portalRouter = router({
  /** Request a verification code (public) — with rate limiting */
  requestCode: publicProcedure
    .input(z.object({ phone: z.string().min(10).max(20) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const normalized = input.phone.replace(/\D/g, "").slice(-10);

      // Rate limiting: max 3 codes per phone per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCodes = await d.select({ count: sql<number>`count(*)` })
        .from(portalSessions)
        .where(and(
          eq(portalSessions.phone, normalized),
          gte(portalSessions.createdAt, oneHourAgo),
        ));
      if ((recentCodes[0]?.count ?? 0) >= 3) {
        throw new Error("Too many code requests. Please wait and try again.");
      }

      // Generate 6-digit code
      const { randomInt } = await import("crypto");
      const code = String(randomInt(100000, 999999));
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      // Find customer
      const [customer] = await d.select().from(customers)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + normalized}`)
        .limit(1);

      await d.insert(portalSessions).values({
        phone: normalized,
        customerId: customer?.id || null,
        verificationCode: code,
        codeExpiresAt,
      });

      // Send verification code via SMS
      try {
        const { sendSms } = await import("../../sms");
        const result = await sendSms(normalized, `Your Nick's Tire & Auto verification code is: ${code}. Valid for 10 minutes.`);
        if (!result.success) {
          log.warn(`[Portal] SMS failed for ${normalized}:`, result);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          // Only log last 4 digits of phone in dev — never leak OTPs
          log.warn(`[Portal] Verification code sent to ...${normalized.slice(-4)}`);
        }
      }

      return { success: true, message: "Verification code sent" };
    }),

  /** Verify code and create session (public) — cleans up expired sessions */
  verifyCode: publicProcedure
    .input(z.object({ phone: z.string().max(20), code: z.string().max(6) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const normalized = input.phone.replace(/\D/g, "").slice(-10);
      const now = new Date();

      // Brute force protection — block after 5 failed attempts (1 hour cooldown)
      const { checkBruteForce, recordFailedAttempt, clearAttempts } = await import("../../middleware/bruteForce");
      const bruteCheck = checkBruteForce(normalized);
      if (!bruteCheck.allowed) {
        throw new Error(`Too many attempts. Try again in ${Math.ceil((bruteCheck.retryAfter || 3600) / 60)} minutes.`);
      }

      // Clean up expired sessions (older than 24 hours)
      const cleanupCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await d.delete(portalSessions).where(lte(portalSessions.createdAt, cleanupCutoff));

      const [session] = await d.select().from(portalSessions)
        .where(and(
          eq(portalSessions.phone, normalized),
          eq(portalSessions.verificationCode, input.code),
          eq(portalSessions.verified, 0),
          gte(portalSessions.codeExpiresAt, now),
        ))
        .orderBy(desc(portalSessions.createdAt))
        .limit(1);

      if (!session) {
        recordFailedAttempt(normalized);
        throw new Error("Invalid or expired code");
      }

      // Valid code — clear brute force counter
      clearAttempts(normalized);

      // Generate session token
      const { randomInt } = await import("crypto");
      const token = Array.from({ length: 64 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)]).join("");
      const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await d.update(portalSessions).set({
        verified: 1,
        sessionToken: token,
        sessionExpiresAt,
      }).where(eq(portalSessions.id, session.id));

      return { success: true, token, customerId: session.customerId };
    }),

  /** Get customer data by portal session token (public) */
  myData: publicProcedure
    .input(z.object({ token: z.string().max(500) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();

      const [session] = await d.select().from(portalSessions)
        .where(and(
          eq(portalSessions.sessionToken, input.token),
          eq(portalSessions.verified, 1),
          gte(portalSessions.sessionExpiresAt, now),
        ))
        .limit(1);

      if (!session) throw new Error("Session expired or invalid");

      // Get customer info
      let customer = null;
      if (session.customerId) {
        const [c] = await d.select().from(customers).where(eq(customers.id, session.customerId)).limit(1);
        customer = c || null;
      }

      // Get bookings by phone
      const customerBookings = await d.select().from(bookings)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${bookings.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + session.phone}`)
        .orderBy(desc(bookings.createdAt))
        .limit(20);

      // Get invoices by phone
      const customerInvoices = await d.select().from(invoices)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${invoices.customerPhone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + session.phone}`)
        .orderBy(desc(invoices.invoiceDate))
        .limit(20);

      // Get service history if customer exists
      const history = session.customerId
        ? await d.select().from(serviceHistory)
            .where(eq(serviceHistory.userId, session.customerId))
            .orderBy(desc(serviceHistory.completedAt))
            .limit(20)
        : [];

      return {
        customer,
        bookings: customerBookings,
        invoices: customerInvoices,
        serviceHistory: history,
        phone: session.phone,
      };
    }),
});


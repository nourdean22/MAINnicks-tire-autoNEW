/**
 * Emergency Router (Feature 10)
 * Handles after-hours emergency service requests with SMS notifications.
 * Creates records in DB, syncs to Google Sheets, and alerts shop owner.
 */
import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { emergencyRequests } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeName } from "../sanitize";
import { sendSms } from "../sms";
import { syncLeadToSheet } from "../sheets-sync";
import { withRetry } from "../retry";
import { logIntegrationFailure } from "../integration-failures";
import { TRPCError } from "@trpc/server";

const STORE_OWNER_PHONE = process.env.OWNER_PHONE || "(216) 862-0005";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

function getNextOpenTime(): string {
  const now = new Date();
  // Set to Eastern Time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
  });
  const easterParts = formatter.formatToParts(now);
  const easterDate = new Date(
    parseInt(easterParts.find(p => p.type === "year")?.value || "2026"),
    parseInt(easterParts.find(p => p.type === "month")?.value || "1") - 1,
    parseInt(easterParts.find(p => p.type === "day")?.value || "1"),
    parseInt(easterParts.find(p => p.type === "hour")?.value || "0"),
    parseInt(easterParts.find(p => p.type === "minute")?.value || "0"),
    0
  );

  // Determine next business hours based on current time
  const dayOfWeek = easterDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = easterDate.getHours();

  let nextOpen = new Date(easterDate);

  if (dayOfWeek === 0) {
    // Sunday: open at 9 AM
    if (hour < 9) {
      nextOpen.setHours(9, 0, 0, 0);
    } else {
      // Next Monday 8 AM
      nextOpen.setDate(nextOpen.getDate() + 1);
      nextOpen.setHours(8, 0, 0, 0);
    }
  } else if (dayOfWeek === 6) {
    // Saturday: open at 8 AM, but closes at some point - treat as open until next Monday
    if (hour < 8) {
      nextOpen.setHours(8, 0, 0, 0);
    } else {
      // Next Monday 8 AM
      nextOpen.setDate(nextOpen.getDate() + 2);
      nextOpen.setHours(8, 0, 0, 0);
    }
  } else {
    // Monday-Friday: open at 8 AM
    if (hour < 8) {
      nextOpen.setHours(8, 0, 0, 0);
    } else {
      // Next day at 8 AM
      nextOpen.setDate(nextOpen.getDate() + 1);
      nextOpen.setHours(8, 0, 0, 0);
    }
  }

  // Format as human-readable (e.g., "8:00 AM tomorrow")
  const tomorrow = new Date(easterDate);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let timeStr = "tomorrow";
  if (nextOpen.toDateString() === easterDate.toDateString()) {
    timeStr = "today";
  } else if (nextOpen.toDateString() === tomorrow.toDateString()) {
    timeStr = "tomorrow";
  } else {
    const daysOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    timeStr = daysOfWeek[nextOpen.getDay()];
  }

  const timeOfDay =
    nextOpen.getHours() === 9
      ? "9:00 AM"
      : nextOpen.getHours() === 8
        ? "8:00 AM"
        : `${nextOpen.getHours()}:00 AM`;

  return `${timeOfDay} ${timeStr}`;
}

export const emergencyRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        phone: z.string().min(7).max(20),
        vehicle: z.string().optional(),
        problem: z.string().min(1).max(1000),
        urgency: z.enum(["emergency", "next-day"]).default("emergency"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const name = sanitizeName(input.name);
        const phone = sanitizePhone(input.phone);
        const vehicle = sanitizeText(input.vehicle);
        const problem = sanitizeText(input.problem);

        if (!name || !phone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Name and phone are required",
          });
        }

        const d = await db();
        if (!d) throw new Error("Database not available");

        // Create emergency request record
        await d.insert(emergencyRequests).values({
          name,
          phone,
          vehicle: vehicle || null,
          problem: problem || null,
          urgency: input.urgency,
          status: "new",
          source: "after_hours_emergency",
        });

        // Get the created record for reference
        const created = await d
          .select()
          .from(emergencyRequests)
          .orderBy((t) => t.id)
          .where(eq(emergencyRequests.phone, phone))
          .limit(1);
        const emergencyId = created[0]?.id || null;

        const nextOpenTime = getNextOpenTime();

        // Sync to Google Sheets asynchronously (fire and forget with retry)
        withRetry(
          () =>
            syncLeadToSheet({
              name,
              phone,
              vehicle: vehicle || undefined,
              problem: problem || undefined,
              source: "after_hours_emergency",
              urgencyScore: input.urgency === "emergency" ? 5 : 4,
              urgencyReason: `After-hours ${input.urgency} request`,
              recommendedService: "Emergency Service",
            }),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-sheets-sync" }
        ).catch((err) => {
          console.error("[Emergency] Sheets sync failed:", err);
          logIntegrationFailure({
            failureType: "sheets_sync",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        // IMMEDIATE SMS to owner about the emergency request
        withRetry(
          () =>
            sendSms(
              STORE_OWNER_PHONE,
              `🚨 AFTER-HOURS REQUEST: ${name} (${phone}) — ${vehicle || "Vehicle info not provided"} — ${problem}`
            ),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-owner-sms" }
        ).catch((err) => {
          console.error("[Emergency] Owner SMS failed:", err);
          logIntegrationFailure({
            failureType: "sms",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        // SMS confirmation to customer with next open time
        withRetry(
          () =>
            sendSms(
              phone,
              `Thanks ${name}! We received your emergency request. Our next available time is ${nextOpenTime}. Call us then at (216) 862-0005. - Nick's Tire & Auto`
            ),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-customer-sms" }
        ).catch((err) => {
          console.error("[Emergency] Customer SMS failed:", err);
          logIntegrationFailure({
            failureType: "sms",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        return {
          success: true,
          nextOpenTime,
          message: `We've received your emergency request and the owner has been notified. We'll be available ${nextOpenTime}.`,
        };
      } catch (err) {
        console.error("[Emergency] Submit failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "We couldn't save your emergency request. Please call us immediately at (216) 862-0005.",
        });
      }
    }),
});

/**
 * Booking router — handles appointment creation, admin management, and status tracking.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createBooking, getBookings, updateBookingStatus, updateBookingNotes, updateBookingPriority,
  updateBookingStage, getBookingByPhone, getBookingByRef,
  createCustomerNotification,
} from "../db";
import { storagePut } from "../storage";
import { notifyNewBooking } from "../email-notify";
import { syncBookingToSheet } from "../sheets-sync";
import { sendSms, bookingConfirmationSms, statusUpdateSms } from "../sms";
import { scheduleReviewRequest } from "./reviewRequests";
import { scheduleRemindersForBooking } from "../db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { bookings } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

function generateRefCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NT-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const bookingRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        phone: z.string().min(7, "Phone number is required").max(20, "Phone number too long"),
        email: z.string().email().optional().or(z.literal("")),
        service: z.string().min(1, "Service is required"),
        vehicle: z.string().optional(),
        vehicleYear: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        preferredDate: z.string().optional(),
        preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
        message: z.string().max(2000, "Message too long").optional(),
        photoUrls: z.array(z.string()).optional(),
        urgency: z.enum(["emergency", "this-week", "whenever"]).default("whenever"),
      })
    )
    .mutation(async ({ input }) => {
      try {
      // Sanitize all user inputs
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      const email = input.email ? sanitizeEmail(input.email) : null;
      const service = sanitizeText(input.service);
      const message = sanitizeText(input.message);
      const vehicleStr = input.vehicleYear && input.vehicleMake
        ? `${sanitizeText(input.vehicleYear)} ${sanitizeText(input.vehicleMake)} ${sanitizeText(input.vehicleModel)}`.trim()
        : sanitizeText(input.vehicle) || null;

      const refCode = generateRefCode();
      const result = await createBooking({
        name,
        phone,
        email,
        service,
        vehicle: vehicleStr,
        vehicleYear: input.vehicleYear || null,
        vehicleMake: input.vehicleMake || null,
        vehicleModel: input.vehicleModel || null,
        preferredDate: input.preferredDate || null,
        preferredTime: input.preferredTime,
        message: input.message || null,
        photoUrls: input.photoUrls?.length ? JSON.stringify(input.photoUrls) : null,
        urgency: input.urgency,
        referenceCode: refCode,
        priority: input.urgency === "emergency" ? 1 : input.urgency === "this-week" ? 5 : 10,
      });

      syncBookingToSheet({
        name: input.name,
        phone: input.phone,
        email: input.email,
        service: input.service,
        vehicle: vehicleStr || input.vehicle,
        preferredDate: input.preferredDate,
        preferredTime: input.preferredTime,
        message: input.message,
      }).catch(err => console.error("[Sheets] Booking sync failed:", err));

      notifyNewBooking({
        name: input.name,
        phone: input.phone,
        service: input.service,
        vehicle: vehicleStr || undefined,
        date: input.preferredDate || undefined,
        time: input.preferredTime,
        notes: input.message || undefined,
        urgency: input.urgency,
        refCode,
      }).catch(err => console.error("[Booking] Email notification failed:", err));

      sendSms(input.phone, bookingConfirmationSms(input.name, input.service, refCode)).catch(err =>
        console.error("[SMS] Booking confirmation failed:", err)
      );

      return { ...result, referenceCode: refCode };
      } catch (err) {
        console.error("[Booking] Create failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We couldn't save your booking. Please call us directly at (216) 862-0005." });
      }
    }),

  uploadPhoto: publicProcedure
    .input(z.object({
      base64: z.string().max(10_000_000, "File too large (max 7.5MB)"),
      filename: z.string().max(255),
      mimeType: z.string().max(100),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.base64, "base64");
      const suffix = Math.random().toString(36).substring(2, 8);
      const key = `booking-photos/${Date.now()}-${suffix}-${input.filename}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),

  list: adminProcedure.query(async () => {
    return getBookings();
  }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.number(), status: z.enum(["new", "confirmed", "completed", "cancelled"]) }))
    .mutation(async ({ input }) => {
      const result = await updateBookingStatus(input.id, input.status);

      // Auto-schedule Google review request when booking is completed
      if (input.status === "completed") {
        const d = await db();
        if (d) {
          const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
          if (booking && booking.phone) {
            scheduleReviewRequest(booking.id, booking.name, booking.phone, booking.service)
              .then(r => {
                // Review request handled
              })
              .catch(err => console.error(`[ReviewRequest] Error scheduling for booking #${booking.id}:`, err));

            // Auto-schedule maintenance reminders based on service type
            scheduleRemindersForBooking({
              id: booking.id,
              name: booking.name,
              phone: booking.phone,
              service: booking.service,
              vehicle: booking.vehicle,
            })
              .then((ids: number[]) => {
                // Reminders scheduled
              })
              .catch((err: unknown) => console.error(`[Reminders] Error scheduling for booking #${booking.id}:`, err));
          }
        }
      }

      return result;
    }),

  updateNotes: adminProcedure
    .input(z.object({ id: z.number(), notes: z.string() }))
    .mutation(async ({ input }) => {
      return updateBookingNotes(input.id, input.notes);
    }),

  updatePriority: adminProcedure
    .input(z.object({ id: z.number(), priority: z.number() }))
    .mutation(async ({ input }) => {
      return updateBookingPriority(input.id, input.priority);
    }),

  updateStage: adminProcedure
    .input(z.object({
      id: z.number(),
      stage: z.enum(["received", "inspecting", "waiting-parts", "in-progress", "quality-check", "ready"]),
    }))
    .mutation(async ({ input }) => {
      const result = await updateBookingStage(input.id, input.stage);
      const d = await db();
      if (d) {
        const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
        if (booking) {
          const stageLabels: Record<string, string> = {
            "received": "received and is in our queue",
            "inspecting": "being inspected by our technicians",
            "waiting-parts": "waiting for parts to arrive",
            "in-progress": "actively being repaired",
            "quality-check": "going through our quality check",
            "ready": "ready for pickup",
          };
          await createCustomerNotification({
            bookingId: input.id,
            recipientName: booking.name,
            recipientPhone: booking.phone,
            recipientEmail: booking.email,
            notificationType: "status_update",
            subject: `Vehicle Status Update — ${input.stage === "ready" ? "Ready for Pickup!" : "In Progress"}`,
            message: `Hi ${booking.name.split(" ")[0]}, your vehicle is ${stageLabels[input.stage] || "being worked on"}. ${input.stage === "ready" ? "You can pick it up anytime during business hours. Call (216) 862-0005 if you have questions." : "We'll keep you updated. Ref: " + (booking.referenceCode || "")}`,
          });

          if (booking.phone) {
            sendSms(booking.phone, statusUpdateSms(booking.name, input.stage, booking.referenceCode || undefined)).catch(err =>
              console.error("[SMS] Status update failed:", err)
            );
          }
        }
      }
      return result;
    }),

  statusByPhone: publicProcedure
    .input(z.object({ phone: z.string().min(7).max(20) }))
    .query(async ({ input }) => {
      return getBookingByPhone(input.phone);
    }),

  statusByRef: publicProcedure
    .input(z.object({ ref: z.string().min(3) }))
    .query(async ({ input }) => {
      return getBookingByRef(input.ref);
    }),
});

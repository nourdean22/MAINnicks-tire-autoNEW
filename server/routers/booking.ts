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
import { notifyNewBooking, notifyInvoiceCreated } from "../email-notify";
import { syncBookingToSheet, syncInvoiceToSheet } from "../sheets-sync";
import { sendSms, bookingConfirmationSms, statusUpdateSms } from "../sms";
import { scheduleReviewRequest } from "./reviewRequests";
import { scheduleRemindersForBooking, getNextInvoiceNumber, createInvoice } from "../db";
import { shopSettings } from "../../drizzle/schema";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { bookings } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";

// ─── LABOR GUIDE REFERENCE (for auto-invoice labor estimation) ───
const SERVICE_LABOR_MAP: Record<string, { hours: number; description: string }> = {
  "oil change": { hours: 0.3, description: "Oil Change Service" },
  "brake": { hours: 1.5, description: "Brake Service" },
  "tire": { hours: 0.7, description: "Tire Service" },
  "diagnostic": { hours: 1.0, description: "Diagnostic Service" },
  "check engine": { hours: 1.0, description: "Check Engine Light Diagnosis" },
  "emission": { hours: 2.0, description: "Emissions / E-Check Repair" },
  "e-check": { hours: 2.0, description: "Ohio E-Check Repair" },
  "suspension": { hours: 2.5, description: "Suspension Repair" },
  "alignment": { hours: 1.0, description: "Wheel Alignment" },
  "ac": { hours: 1.5, description: "AC Service" },
  "cooling": { hours: 1.5, description: "Cooling System Service" },
  "exhaust": { hours: 1.5, description: "Exhaust Repair" },
  "electrical": { hours: 1.5, description: "Electrical Repair" },
  "starter": { hours: 2.0, description: "Starter Replacement" },
  "alternator": { hours: 1.5, description: "Alternator Replacement" },
  "transmission": { hours: 1.0, description: "Transmission Service" },
  "general": { hours: 1.5, description: "General Repair" },
};

function estimateLaborFromService(service: string): { hours: number; description: string } {
  const lower = service.toLowerCase();
  for (const [key, val] of Object.entries(SERVICE_LABOR_MAP)) {
    if (lower.includes(key)) return val;
  }
  return { hours: 1.0, description: service };
}

/** Auto-create an invoice when a booking is marked completed */
async function autoCreateInvoiceFromBooking(d: any, booking: any): Promise<void> {
  const invoiceNumber = await getNextInvoiceNumber();
  const labor = estimateLaborFromService(booking.service || "General Repair");

  // Get labor rate from shop settings
  let laborRate = 115;
  try {
    const [setting] = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    if (setting) laborRate = parseFloat(setting.value);
  } catch {}

  const laborCost = Math.round(labor.hours * laborRate * 100); // cents
  const taxRate = 0.08; // 8% Ohio sales tax on labor
  const taxAmount = Math.round(laborCost * taxRate);
  const totalAmount = laborCost + taxAmount;

  // Create invoice in database
  await createInvoice({
    bookingId: booking.id,
    customerName: booking.name,
    customerPhone: booking.phone,
    invoiceNumber,
    totalAmount,
    partsCost: 0, // Parts added manually by shop
    laborCost,
    taxAmount,
    serviceDescription: labor.description,
    vehicleInfo: booking.vehicle || null,
    paymentMethod: "card",
    paymentStatus: "pending",
    source: "manual",
    invoiceDate: new Date(),
  });

  // Sync to Google Sheets
  await syncInvoiceToSheet({
    invoiceNumber,
    customerName: booking.name,
    customerPhone: booking.phone,
    vehicleInfo: booking.vehicle,
    serviceDescription: labor.description,
    laborHours: labor.hours,
    laborRate,
    laborCost: laborCost / 100,
    partsCost: 0,
    taxAmount: taxAmount / 100,
    totalAmount: totalAmount / 100,
    paymentMethod: "card",
    paymentStatus: "pending",
    source: "booking",
    orderRef: booking.referenceCode || null,
    notes: `Auto-generated from booking #${booking.id}`,
  });

  // Notify CEO about the auto-generated invoice
  notifyInvoiceCreated({
    invoiceNumber,
    customerName: booking.name,
    totalAmount: totalAmount / 100,
    source: "booking",
    serviceDescription: labor.description,
  }).catch(() => {});

  console.log(`[Invoice] Auto-created ${invoiceNumber} for booking #${booking.id} — $${(totalAmount / 100).toFixed(2)}`);
}

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

            // Auto-create invoice from completed booking
            autoCreateInvoiceFromBooking(d, booking).catch(err =>
              console.error(`[Invoice] Error auto-creating for booking #${booking.id}:`, err)
            );
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

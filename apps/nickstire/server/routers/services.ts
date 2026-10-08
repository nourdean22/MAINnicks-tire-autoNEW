/**
 * Services router — coupons, pricing, inspections, garage, referrals, Q&A,
 * loyalty, customer notifications, and SMS.
 */
import { publicProcedure, protectedProcedure, adminProcedure, router, dbAdminProcedure, dbProtectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDbTyped } from "../db";
import {
  createCoupon, getActiveCoupons, getAllCoupons, updateCoupon, deleteCoupon, redeemCouponById,
  getCustomerVehicles, addCustomerVehicle, updateCustomerVehicle, deleteCustomerVehicle,
  getServiceHistoryForUser,
  createReferral, getReferrals, updateReferralStatus,
  createQuestion, getPublishedQuestions, getAllQuestions, answerQuestion,
  createCustomerNotification, getPendingNotifications, markNotificationSent,
  getServicePricingByCategory, getAllServicePricing, upsertServicePricing, seedDefaultPricing,
  createInspection, getInspection, getInspectionByToken, getInspections, addInspectionItem, updateInspectionItem, deleteInspectionItem, publishInspection,
  verifyInspectionItem,
  recordInspectionView, decideInspectionItem,
  getLoyaltyRewards, createLoyaltyReward, updateLoyaltyReward,
  getLoyaltyTransactions, awardPoints, redeemReward,
  getUserLoyaltySummary,
} from "../db";
import { storagePut } from "../storage";
import { sendSms } from "../sms";
import { createLogger } from "../lib/logger";
import { pickGatewayDevice, isGatewayOnline } from "../lib/gateway-device";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { z } from "zod";
import { inspectionMeasurementsSchema, photoUrlListSchema } from "@shared/inspectionMeasurements";

const log = createLogger("routers:services");

export const couponsRouter = router({
  active: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Coupon store unavailable - this is a read failure, not an absence of offers." });
    }
    return getActiveCoupons();
  }),
  all: dbAdminProcedure.query(async () => {
    return getAllCoupons();
  }),
  create: adminProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      discountType: z.enum(["dollar", "percent", "free"]),
      discountValue: z.number().min(0),
      code: z.string().optional(),
      applicableServices: z.string().default("all"),
      terms: z.string().optional(),
      maxRedemptions: z.number().default(0),
      isFeatured: z.number().default(0),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return createCoupon({
        ...input,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      });
    }),
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      discountType: z.enum(["dollar", "percent", "free"]).optional(),
      discountValue: z.number().optional(),
      code: z.string().optional(),
      applicableServices: z.string().optional(),
      terms: z.string().optional(),
      isActive: z.number().optional(),
      isFeatured: z.number().optional(),
      expiresAt: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, expiresAt, ...rest } = input;
      return updateCoupon(id, {
        ...rest,
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
      });
    }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteCoupon(input.id);
    }),
  /**
   * Admin-triggered redemption recording.
   * Validates active/unexpired state and enforces the maxRedemptions cap.
   * Returns { success, currentRedemptions } on success.
   * Throws BAD_REQUEST with code COUPON_CAP_REACHED / COUPON_INACTIVE /
   * COUPON_EXPIRED, or NOT_FOUND when the coupon doesn't exist.
   *
   * Does NOT send SMS. Does NOT publish GBP posts.
   */
  redeem: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return await redeemCouponById(input.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "COUPON_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Coupon not found." });
        }
        if (msg === "COUPON_INACTIVE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Coupon is inactive." });
        }
        if (msg === "COUPON_EXPIRED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Coupon has expired." });
        }
        if (msg === "COUPON_CAP_REACHED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Redemption cap reached — this offer is fully claimed." });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Redemption failed." });
      }
    }),
});

export const garageRouter = router({
  vehicles: dbProtectedProcedure.query(async ({ ctx }) => {
    return getCustomerVehicles(ctx.user.id);
  }),
  addVehicle: protectedProcedure
    .input(z.object({
      year: z.string().min(4),
      make: z.string().min(1),
      model: z.string().min(1),
      mileage: z.number().optional(),
      nickname: z.string().optional(),
      vin: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return addCustomerVehicle({ ...input, userId: ctx.user.id });
    }),
  updateVehicle: protectedProcedure
    .input(z.object({
      id: z.number(),
      year: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      mileage: z.number().optional(),
      nickname: z.string().optional(),
      vin: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return updateCustomerVehicle(id, ctx.user.id, data);
    }),
  deleteVehicle: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return deleteCustomerVehicle(input.id, ctx.user.id);
    }),
  serviceHistory: dbProtectedProcedure.query(async ({ ctx }) => {
    return getServiceHistoryForUser(ctx.user.id);
  }),
});

export const referralsRouter = router({
  submit: publicProcedure
    // 2026-09-10 · every bound here matches the `referrals` column width in
    // drizzle/schema.ts (name 255, phone 30, email 320). They were previously
    // unbounded: a 300-character name passed validation and TiDB, running
    // STRICT_TRANS_TABLES, REJECTED the insert — so the referral was lost
    // silently on a program that pays out $25/$25. Bounding at the column
    // width turns that into an honest validation error at the edge.
    .input(z.object({
      referrerName: z.string().min(1).max(255),
      referrerPhone: z.string().min(7).max(30),
      referrerEmail: z.string().email().max(320).optional(),
      refereeName: z.string().min(1).max(255),
      refereePhone: z.string().min(7).max(30),
      refereeEmail: z.string().email().max(320).optional(),
    }))
    .mutation(async ({ input }) => {
      // wave-fix-2026-05-25 (audit #135) · self-referral exploit prevention.
      // Pre-fix, the same person could submit { referrerPhone: X, refereePhone: X }
      // and collect the $25 referral credit indefinitely. Server-side
      // normalize-and-compare blocks the obvious case. Email check is
      // belt-and-suspenders for the variant where attacker uses two
      // different phone formats (e.g. with vs without country code) ·
      // normalizePhone collapses those to last-10-digits.
      const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-10);
      const refPhone10 = normalizePhone(input.referrerPhone);
      const refeePhone10 = normalizePhone(input.refereePhone);
      if (refPhone10 && refPhone10 === refeePhone10) {
        // No PII. This path is reachable by any unauthenticated caller — submit
        // /refer with matching phones and you choose what lands in the Railway
        // log retention window. logger.ts performs no redaction of any kind,
        // and lint-pii could not see this line at all (its template-literal
        // rules are scoped to console.* and new Error(), never log.*), so the
        // linter reported 4 violations across 892 files and none of them were
        // these. The rule is widened in the same commit.
        log.warn("[referrals:self-loop] BLOCKED · referrer and referee share a phone");
        return { success: false, error: "Referrer and referee must be different people." };
      }
      if (input.referrerEmail && input.refereeEmail && input.referrerEmail.toLowerCase() === input.refereeEmail.toLowerCase()) {
        log.warn("[referrals:self-loop] BLOCKED · referrer and referee share an email");
        return { success: false, error: "Referrer and referee must be different people." };
      }
      // Sanitize at the write, not before the guard above: normalizePhone
      // already strips to digits, so the self-referral check is unaffected
      // either way, and leaving it on the raw values keeps that logic exactly
      // as it was audited. Raw input reached the DB before this — every other
      // public write form in this app (lead, callback, candidates) sanitizes.
      return createReferral({
        referrerName: sanitizeText(input.referrerName),
        referrerPhone: sanitizePhone(input.referrerPhone),
        referrerEmail: input.referrerEmail ? sanitizeEmail(input.referrerEmail) : undefined,
        refereeName: sanitizeText(input.refereeName),
        refereePhone: sanitizePhone(input.refereePhone),
        refereeEmail: input.refereeEmail ? sanitizeEmail(input.refereeEmail) : undefined,
      });
    }),
  all: dbAdminProcedure.query(async () => {
    return getReferrals();
  }),
  updateStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "visited", "redeemed", "expired"]),
    }))
    .mutation(async ({ input }) => {
      return updateReferralStatus(input.id, input.status);
    }),
});

export const qaRouter = router({
  published: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Question store unavailable - this is a read failure, not an empty Q&A." });
    }
    return getPublishedQuestions();
  }),
  ask: publicProcedure
    .input(z.object({
      questionerName: z.string().min(1),
      questionerEmail: z.string().email().optional(),
      question: z.string().min(10),
      vehicleInfo: z.string().optional(),
      category: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return createQuestion(input);
    }),
  all: dbAdminProcedure.query(async () => {
    return getAllQuestions();
  }),
  answer: adminProcedure
    .input(z.object({
      id: z.number(),
      answer: z.string().min(1),
      answeredBy: z.string().default("Nick's Tire & Auto"),
    }))
    .mutation(async ({ input }) => {
      return answerQuestion(input.id, input.answer, input.answeredBy);
    }),
});

export const customerNotificationsRouter = router({
  pending: dbAdminProcedure.query(async () => {
    return getPendingNotifications();
  }),
  send: adminProcedure
    .input(z.object({
      bookingId: z.number().optional(),
      recipientName: z.string().min(1),
      recipientPhone: z.string().optional(),
      recipientEmail: z.string().email().optional(),
      notificationType: z.enum(["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer", "status_update"]),
      subject: z.string().optional(),
      message: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return createCustomerNotification(input);
    }),
  markSent: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return markNotificationSent(input.id);
    }),
});

export const pricingRouter = router({
  estimate: publicProcedure
    .input(z.object({
      serviceType: z.string().min(1),
      vehicleCategory: z.enum(["compact", "midsize", "full-size", "truck-suv"]),
    }))
    .query(async ({ input }) => {
      if (!(await getDbTyped())) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Pricing store unavailable - this is a read failure, not an unpriced service." });
      }
      return getServicePricingByCategory(input.serviceType, input.vehicleCategory);
    }),
  allServices: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Pricing store unavailable - this is a read failure, not an empty price list." });
    }
    return getAllServicePricing();
  }),
  upsert: adminProcedure
    .input(z.object({
      serviceType: z.string(),
      serviceLabel: z.string(),
      vehicleCategory: z.enum(["compact", "midsize", "full-size", "truck-suv"]),
      lowEstimate: z.number(),
      highEstimate: z.number(),
      typicalHours: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return upsertServicePricing(input);
    }),
  seedDefaults: adminProcedure.mutation(async () => {
    return seedDefaultPricing();
  }),
});

export const inspectionRouter = router({
  byToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      if (!(await getDbTyped())) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Inspection store unavailable - this is a read failure, not a missing report." });
      }
      return getInspectionByToken(input.token);
    }),
  /** DVI (0101) · view-tracking beacon — token IS the auth; published only. */
  recordView: publicProcedure
    .input(z.object({ token: z.string().min(16).max(64) }))
    .mutation(async ({ input }) => {
      if (!(await getDbTyped())) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Inspection store unavailable - the view was not recorded." });
      }
      return recordInspectionView(input.token);
    }),
  /**
   * DVI (0101) · per-item customer decision. The token→inspection→item
   * join is the authorization; re-deciding is allowed (people change
   * their minds), decisionAt tracks the latest. No AI touches this
   * path — the decision and note are the customer's own words.
   */
  decideItem: publicProcedure
    .input(z.object({
      token: z.string().min(16).max(64),
      itemId: z.number().int().positive(),
      decision: z.enum(["approved", "declined", "question"]),
      note: z.string().max(500).optional(),
      /** Whole dollars the page showed for this item; recorded, never trusted as the price. */
      shownCost: z.number().int().min(0).max(1_000_000).optional(),
    }))
    .mutation(async ({ input }) =>
      decideInspectionItem({
        token: input.token,
        itemId: input.itemId,
        decision: input.decision,
        note: input.note ?? null,
        shownCost: input.shownCost ?? null,
      }),
    ),
  list: dbAdminProcedure.query(async () => {
    return getInspections();
  }),
  get: dbAdminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getInspection(input.id);
    }),
  create: adminProcedure
    .input(z.object({
      bookingId: z.number().optional(),
      customerName: z.string().min(1),
      customerPhone: z.string().optional(),
      customerEmail: z.string().optional(),
      vehicleInfo: z.string().min(1),
      vehicleYear: z.string().optional(),
      vehicleMake: z.string().optional(),
      vehicleModel: z.string().optional(),
      mileage: z.number().optional(),
      technicianName: z.string().min(1),
      overallCondition: z.enum(["good", "fair", "needs-attention"]).default("fair"),
      summaryNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return createInspection(input);
    }),
  addItem: adminProcedure
    .input(z.object({
      inspectionId: z.number(),
      component: z.string().min(1),
      category: z.enum(["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"]),
      condition: z.enum(["green", "yellow", "red"]),
      notes: z.string().optional(),
      photoUrl: z.string().optional(),
      /** 0143 · every photo for the finding (the first is mirrored into photoUrl). */
      photoUrls: photoUrlListSchema.optional(),
      /** 0143 · structured measurements, validated against shared/inspectionMeasurements.ts. */
      measurements: inspectionMeasurementsSchema.optional(),
      recommendedAction: z.string().optional(),
      estimatedCost: z.number().optional(),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      return addInspectionItem(input);
    }),
  updateItem: adminProcedure
    .input(z.object({
      id: z.number(),
      component: z.string().optional(),
      category: z.enum(["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"]).optional(),
      condition: z.enum(["green", "yellow", "red"]).optional(),
      notes: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: photoUrlListSchema.optional(),
      measurements: inspectionMeasurementsSchema.optional(),
      recommendedAction: z.string().optional(),
      estimatedCost: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateInspectionItem(id, data);
    }),
  /**
   * 0143 · post-work verification. After the approved repair is done the tech
   * records who did it, AFTER photos and AFTER measurements. This is the proof
   * the customer page shows and the signal that closes the deferral in the
   * opportunity queue. Admin-only; nothing is sent to the customer by this call.
   */
  verifyItem: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      verifiedBy: z.string().min(1).max(255),
      note: z.string().max(500).optional(),
      photoUrls: photoUrlListSchema.optional(),
      measurements: inspectionMeasurementsSchema.optional(),
    }))
    .mutation(async ({ input }) => {
      const res = await verifyInspectionItem(input);
      if (res.success) return res;
      if (res.reason === "not_found") throw new TRPCError({ code: "NOT_FOUND", message: "Inspection item not found" });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Verification needs migration 0143 (drizzle/0143_dvi_measurements_verification.sql) applied to the database — nothing was recorded.",
      });
    }),
  deleteItem: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteInspectionItem(input.id);
    }),
  publish: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return publishInspection(input.id);
    }),
  uploadPhoto: adminProcedure
    .input(z.object({
      base64: z.string().max(10_000_000, "File too large (max 7.5MB)"),
      filename: z.string().max(255),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
    }))
    .mutation(async ({ input }) => {
      const { randomInt } = await import("crypto");
      const buffer = Buffer.from(input.base64, "base64");
      const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const suffix = randomInt(100000, 999999).toString();
      const key = `inspection-photos/${Date.now()}-${suffix}-${safeFilename}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),
});

export const loyaltyRouter = router({
  rewards: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Rewards store unavailable - this is a read failure, not an empty catalogue." });
    }
    return getLoyaltyRewards();
  }),
  summary: dbProtectedProcedure.query(async ({ ctx }) => {
    return getUserLoyaltySummary(ctx.user.id);
  }),
  transactions: dbProtectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ ctx, input }) => {
      return getLoyaltyTransactions(ctx.user.id, input?.limit ?? 20);
    }),
  redeem: protectedProcedure
    .input(z.object({ rewardId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return redeemReward(ctx.user.id, input.rewardId);
    }),
  awardPoints: adminProcedure
    .input(z.object({
      userId: z.number(),
      points: z.number().min(1),
      description: z.string(),
      serviceHistoryId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return awardPoints(input.userId, input.points, input.description, input.serviceHistoryId);
    }),
  /**
   * RETIRED (forensic-audit HIGH · operator decision). This resolved a
   * customers.id and passed it to awardPoints(), which keys the UNRELATED
   * users table — so it silently credited a random OAuth user (or threw
   * "User not found") and never the intended customer. Loyalty is a
   * users-table concept; there is no correct customer→user bridge, so the
   * feature is retired rather than "fixed". Kept as a clear-erroring stub
   * so any lingering caller fails loudly instead of corrupting balances.
   */
  awardPointsByPhone: adminProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      points: z.number().min(1),
      description: z.string(),
    }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Loyalty award-by-phone has been retired.",
      });
    }),
  createReward: adminProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      pointsCost: z.number().min(1),
      rewardValue: z.number().min(1),
      rewardType: z.enum(["dollar-off", "percent-off", "free-service"]).default("dollar-off"),
      applicableService: z.string().default("all"),
    }))
    .mutation(async ({ input }) => {
      return createLoyaltyReward(input);
    }),
  updateReward: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      pointsCost: z.number().optional(),
      rewardValue: z.number().optional(),
      isActive: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateLoyaltyReward(id, data);
    }),
});

export const smsRouter = router({
  /**
   * Send a test SMS. Defaults to via:"shop" (the F25e at 216-862-0005)
   * since that's the primary path; falls back to Twilio automatically
   * if the shop gateway is offline.
   */
  sendTest: adminProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      via: z.enum(["shop", "twilio"]).default("shop"),
    }))
    .mutation(async ({ input }) => {
      const body = input.via === "shop"
        ? "Test from Nick's Tire & Auto — this is the shop's real line at 216-862-0005."
        : "Test from Nick's Tire & Auto — this is the Twilio fallback line.";
      // humanInitiated: an authenticated adminProcedure IS a human explicitly
      // triggering this exact message — the contract the option documents.
      // Required because sendSms refuses automated sends to shop/operator
      // lines, and testing the shop's own line is the main use of this button.
      return sendSms(input.phone, body, { via: input.via, humanInitiated: true });
    }),
  /** Send a custom SMS to any number. Defaults to shop gateway. */
  sendManual: adminProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      message: z.string().min(1).max(1600),
      via: z.enum(["shop", "twilio"]).default("shop"),
    }))
    .mutation(async ({ input }) => {
      // Same reason as sendTest: an operator typing a message in the admin is
      // the human-initiated case, and must not be refused for texting an
      // internal line on purpose.
      return sendSms(input.phone, input.message, { via: input.via, humanInitiated: true });
    }),
  /**
   * Wave-108: status now reports BOTH SMS providers.
   *  - shopGateway: F25e via Capevace cloud (primary)
   *  - twilio: legacy Twilio account (fallback)
   * Operator sees at a glance which paths are live.
   */
  status: adminProcedure.query(() => {
    const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
    const shopConfigured = !!(process.env.SHOP_SMS_GATEWAY_USERNAME && process.env.SHOP_SMS_GATEWAY_PASSWORD);
    const killSwitch = process.env.SMS_KILL_SWITCH === "true";
    return {
      // Primary path
      shopGateway: {
        configured: shopConfigured,
        fromNumber: shopConfigured ? "+12168620005" : null,
        // Lives in eventBus; lastSeen filled in by gatewayHealth query
      },
      // Fallback
      twilio: {
        configured: twilioConfigured,
        fromNumber: twilioConfigured ? process.env.TWILIO_PHONE_NUMBER : null,
        killSwitchActive: killSwitch, // true = Twilio path blocked
      },
      // Legacy compat (kept so existing UI doesn't break)
      configured: twilioConfigured,
      fromNumber: twilioConfigured ? process.env.TWILIO_PHONE_NUMBER : null,
    };
  }),
  /**
   * Wave-108: live shop gateway health.
   * Hits Capevace's /device endpoint to read the F25e's lastSeen
   * timestamp + name. Online if lastSeen is within GATEWAY_OFFLINE_MINUTES
   * (shared with the alerting cron — see lib/gateway-device.ts).
   */
  gatewayHealth: adminProcedure.query(async () => {
    const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
    const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
    const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
    if (!username || !password) {
      return { configured: false as const, readable: true, online: false, lastSeen: null, deviceName: null, error: "SHOP_SMS_GATEWAY_USERNAME/PASSWORD not set" };
    }
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    try {
      const res = await fetch(`${baseUrl}/device`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        // readable: false · the vendor API failed, so the phone's state is UNKNOWN,
        // not offline. Q-23 phase 9: the admin must not blame the device for it.
        return { configured: true as const, readable: false, online: false, lastSeen: null, deviceName: null, error: `Capevace /device returned ${res.status}` };
      }
      const devices = (await res.json()) as Array<{ id: string; name?: string; lastSeen?: string }>;
      if (!devices.length) {
        return { configured: true as const, readable: true, online: false, lastSeen: null, deviceName: null, error: "No devices registered" };
      }
      // Don't blindly trust devices[0] — the Capevace account can hold a stale
      // test phone alongside the live F25e, and order isn't guaranteed. Prefer
      // the configured device id, else the freshest by lastSeen (shared helper).
      const dev = pickGatewayDevice(devices, process.env.SHOP_SMS_GATEWAY_DEVICE_ID);
      if (!dev) {
        return {
          configured: true as const,
          readable: true,
          online: false,
          lastSeen: null,
          deviceName: null,
          error: `Configured gateway device ${process.env.SHOP_SMS_GATEWAY_DEVICE_ID} not registered (${devices.length} device(s) found)`,
        };
      }
      const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
      const ageMin = lastSeenMs ? Math.round((Date.now() - lastSeenMs) / 60_000) : 999;
      return {
        configured: true as const,
        readable: true,
        online: isGatewayOnline(ageMin),
        lastSeen: dev.lastSeen || null,
        ageMinutes: ageMin,
        deviceName: dev.name || null,
        deviceId: dev.id,
      };
    } catch (err) {
      return {
        configured: true as const,
        readable: false,
        online: false,
        lastSeen: null,
        deviceName: null,
        error: err instanceof Error ? err.message : "Unreachable",
      };
    }
  }),
});

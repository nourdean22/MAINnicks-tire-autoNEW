/**
 * Services router — coupons, pricing, inspections, garage, referrals, Q&A,
 * loyalty, customer notifications, and SMS.
 */
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  createCoupon, getActiveCoupons, getAllCoupons, updateCoupon, deleteCoupon,
  getCustomerVehicles, addCustomerVehicle, updateCustomerVehicle, deleteCustomerVehicle,
  getServiceHistoryForUser,
  createReferral, getReferrals, updateReferralStatus,
  createQuestion, getPublishedQuestions, getAllQuestions, answerQuestion,
  createCustomerNotification, getPendingNotifications, markNotificationSent,
  getServicePricingByCategory, getAllServicePricing, upsertServicePricing, seedDefaultPricing,
  createInspection, getInspection, getInspectionByToken, getInspections, addInspectionItem, updateInspectionItem, deleteInspectionItem, publishInspection,
  getLoyaltyRewards, createLoyaltyReward, updateLoyaltyReward,
  getLoyaltyTransactions, awardPoints, redeemReward,
  getUserLoyaltySummary,
} from "../db";
import { storagePut } from "../storage";
import { sendSms } from "../sms";
import { z } from "zod";

export const couponsRouter = router({
  active: publicProcedure.query(async () => {
    return getActiveCoupons();
  }),
  all: adminProcedure.query(async () => {
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
});

export const garageRouter = router({
  vehicles: protectedProcedure.query(async ({ ctx }) => {
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
  serviceHistory: protectedProcedure.query(async ({ ctx }) => {
    return getServiceHistoryForUser(ctx.user.id);
  }),
});

export const referralsRouter = router({
  submit: publicProcedure
    .input(z.object({
      referrerName: z.string().min(1),
      referrerPhone: z.string().min(7),
      referrerEmail: z.string().email().optional(),
      refereeName: z.string().min(1),
      refereePhone: z.string().min(7),
      refereeEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      return createReferral(input);
    }),
  all: adminProcedure.query(async () => {
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
  all: adminProcedure.query(async () => {
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
  pending: adminProcedure.query(async () => {
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
      return getServicePricingByCategory(input.serviceType, input.vehicleCategory);
    }),
  allServices: publicProcedure.query(async () => {
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
      return getInspectionByToken(input.token);
    }),
  list: adminProcedure.query(async () => {
    return getInspections();
  }),
  get: adminProcedure
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
      recommendedAction: z.string().optional(),
      estimatedCost: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateInspectionItem(id, data);
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
    return getLoyaltyRewards();
  }),
  summary: protectedProcedure.query(async ({ ctx }) => {
    return getUserLoyaltySummary(ctx.user.id);
  }),
  transactions: protectedProcedure
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
  sendTest: adminProcedure
    .input(z.object({ phone: z.string().min(7).max(20) }))
    .mutation(async ({ input }) => {
      const result = await sendSms(input.phone, "This is a test message from Nick's Tire & Auto. If you received this, SMS notifications are working correctly. — Nick's Team");
      return result;
    }),
  sendManual: adminProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      message: z.string().min(1).max(1600),
    }))
    .mutation(async ({ input }) => {
      return sendSms(input.phone, input.message);
    }),
  status: adminProcedure.query(() => {
    const configured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
    return {
      configured,
      fromNumber: configured ? process.env.TWILIO_PHONE_NUMBER : null,
    };
  }),
});

import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser, users, bookings, InsertBooking,
  coupons, InsertCoupon,
  customerVehicles, InsertCustomerVehicle,
  serviceHistory, InsertServiceHistory,
  referrals, InsertReferral,
  mechanicQA, InsertMechanicQA,
  analyticsSnapshots, InsertAnalyticsSnapshot,
  customerNotifications, InsertCustomerNotification,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: any = null;
let _pool: mysql.Pool | null = null;

/** Reset the cached DB connection — used by self-healing to force reconnection */
export function resetDbConnection(): void {
  _pool?.end().catch(() => {});
  _pool = null;
  _db = null;
}

// Lazily create the drizzle instance with connection pooling.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 5,
        maxIdle: 2,
        waitForConnections: true,
        queueLimit: 0,
        idleTimeout: 60000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (
      // Auto-grant admin if openId matches OWNER_OPEN_ID
      (ENV.ownerOpenId && user.openId === ENV.ownerOpenId) ||
      // OR if OWNER_OPEN_ID is not set and email matches CEO_EMAIL (first-login bootstrap)
      (!ENV.ownerOpenId && ENV.ceoEmail && user.email && user.email.toLowerCase() === ENV.ceoEmail.toLowerCase())
    ) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── BOOKING QUERIES ───────────────────────────────────

export async function createBooking(booking: InsertBooking) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.insert(bookings).values(booking).$returningId();
  return { success: true, id: rows[0]?.id ?? 0 };
}

export async function getBookings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(500);
}

export async function updateBookingStatus(id: number, status: "new" | "confirmed" | "completed" | "cancelled") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bookings).set({ status }).where(eq(bookings.id, id));
  return { success: true };
}

export async function updateBookingNotes(id: number, notes: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bookings).set({ adminNotes: notes }).where(eq(bookings.id, id));
  return { success: true };
}

export async function updateBookingPriority(id: number, priority: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bookings).set({ priority }).where(eq(bookings.id, id));
  return { success: true };
}

// ─── COUPON QUERIES ───────────────────────────────────

export async function createCoupon(coupon: InsertCoupon) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(coupons).values(coupon);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getActiveCoupons() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return db.select().from(coupons)
    .where(and(
      eq(coupons.isActive, 1),
      lte(coupons.startsAt, now),
      sql`(${coupons.expiresAt} IS NULL OR ${coupons.expiresAt} >= ${now})`,
    ))
    .orderBy(desc(coupons.isFeatured), desc(coupons.createdAt));
}

export async function getAllCoupons() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(coupons).orderBy(desc(coupons.createdAt));
}

export async function updateCoupon(id: number, data: Partial<InsertCoupon>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(coupons).set(data).where(eq(coupons.id, id));
  return { success: true };
}

export async function deleteCoupon(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(coupons).where(eq(coupons.id, id));
  return { success: true };
}

// ─── CUSTOMER VEHICLE QUERIES ─────────────────────────

export async function getCustomerVehicles(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerVehicles)
    .where(eq(customerVehicles.userId, userId))
    .orderBy(desc(customerVehicles.updatedAt));
}

export async function addCustomerVehicle(vehicle: InsertCustomerVehicle) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(customerVehicles).values(vehicle);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateCustomerVehicle(id: number, userId: number, data: Partial<InsertCustomerVehicle>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customerVehicles).set(data)
    .where(and(eq(customerVehicles.id, id), eq(customerVehicles.userId, userId)));
  return { success: true };
}

export async function deleteCustomerVehicle(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customerVehicles)
    .where(and(eq(customerVehicles.id, id), eq(customerVehicles.userId, userId)));
  return { success: true };
}

// ─── SERVICE HISTORY QUERIES ──────────────────────────

export async function getServiceHistoryForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceHistory)
    .where(eq(serviceHistory.userId, userId))
    .orderBy(desc(serviceHistory.completedAt));
}

export async function addServiceRecord(record: InsertServiceHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(serviceHistory).values(record);
  return { success: true, id: Number(result[0].insertId) };
}

// ─── REFERRAL QUERIES ─────────────────────────────────

export async function createReferral(referral: InsertReferral) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(referrals).values(referral);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getReferrals() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(referrals).orderBy(desc(referrals.createdAt));
}

export async function updateReferralStatus(id: number, status: "pending" | "visited" | "redeemed" | "expired") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referrals).set({ status }).where(eq(referrals.id, id));
  return { success: true };
}

// ─── MECHANIC Q&A QUERIES ─────────────────────────────

export async function createQuestion(question: InsertMechanicQA) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(mechanicQA).values(question);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getPublishedQuestions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mechanicQA)
    .where(eq(mechanicQA.isPublished, 1))
    .orderBy(desc(mechanicQA.isFeatured), desc(mechanicQA.createdAt));
}

export async function getAllQuestions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mechanicQA).orderBy(desc(mechanicQA.createdAt));
}

export async function answerQuestion(id: number, answer: string, answeredBy: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(mechanicQA).set({ answer, answeredBy, isPublished: 1 }).where(eq(mechanicQA.id, id));
  return { success: true };
}

// ─── ANALYTICS QUERIES ────────────────────────────────

export async function saveAnalyticsSnapshot(snapshot: InsertAnalyticsSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(analyticsSnapshots).values(snapshot);
  return { success: true };
}

export async function getAnalyticsSnapshots(days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  return db.select().from(analyticsSnapshots)
    .where(gte(analyticsSnapshots.date, cutoffStr))
    .orderBy(desc(analyticsSnapshots.date));
}

// ─── CUSTOMER NOTIFICATION QUERIES ────────────────────

export async function createCustomerNotification(notification: InsertCustomerNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(customerNotifications).values(notification);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getPendingNotifications() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerNotifications)
    .where(eq(customerNotifications.status, "pending"))
    .orderBy(desc(customerNotifications.createdAt));
}

export async function markNotificationSent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customerNotifications).set({ status: "sent", sentAt: new Date() })
    .where(eq(customerNotifications.id, id));
  return { success: true };
}

export async function getBookingServiceBreakdown() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    service: bookings.service,
    count: sql<number>`count(*)`.as("count"),
  }).from(bookings).groupBy(bookings.service).orderBy(sql`count(*) desc`);
}

// ─── CALLBACK REQUEST QUERIES ────────────────────────

import {
  callbackRequests, InsertCallbackRequest,
  servicePricing, InsertServicePricing,
  vehicleInspections, InsertVehicleInspection,
  inspectionItems, InsertInspectionItem,
  loyaltyRewards, InsertLoyaltyReward,
  loyaltyTransactions,
  reviewRequests, InsertReviewRequest,
  reviewSettings,
} from "../drizzle/schema";

export async function createCallbackRequest(data: InsertCallbackRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(callbackRequests).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getCallbackRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt));
}

export async function updateCallbackStatus(id: number, status: "new" | "called" | "no-answer" | "completed", notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const setObj: Record<string, unknown> = { status };
  if (status === "called" || status === "no-answer" || status === "completed") {
    setObj.calledAt = new Date();
  }
  if (notes !== undefined) setObj.notes = notes;
  await db.update(callbackRequests).set(setObj).where(eq(callbackRequests.id, id));
  return { success: true };
}

// ─── BOOKING STAGE (STATUS TRACKER) ─────────────────

export async function updateBookingStage(id: number, stage: "received" | "inspecting" | "waiting-parts" | "in-progress" | "quality-check" | "ready") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bookings).set({ stage, stageUpdatedAt: new Date() }).where(eq(bookings.id, id));
  return { success: true };
}

export async function getBookingByPhone(phone: string) {
  const db = await getDb();
  if (!db) return [];
  // Normalize phone — strip non-digits
  const digits = phone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return db.select({
    id: bookings.id,
    name: bookings.name,
    service: bookings.service,
    vehicle: bookings.vehicle,
    stage: bookings.stage,
    stageUpdatedAt: bookings.stageUpdatedAt,
    status: bookings.status,
    referenceCode: bookings.referenceCode,
    createdAt: bookings.createdAt,
  }).from(bookings)
    .where(and(
      sql`REPLACE(REPLACE(REPLACE(REPLACE(${bookings.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + last10}`,
      sql`${bookings.status} NOT IN ('cancelled')`,
    ))
    .orderBy(desc(bookings.createdAt))
    .limit(5);
}

export async function getBookingByRef(ref: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: bookings.id,
    name: bookings.name,
    service: bookings.service,
    vehicle: bookings.vehicle,
    stage: bookings.stage,
    stageUpdatedAt: bookings.stageUpdatedAt,
    status: bookings.status,
    referenceCode: bookings.referenceCode,
    createdAt: bookings.createdAt,
  }).from(bookings)
    .where(eq(bookings.referenceCode, ref.toUpperCase()))
    .limit(1);
}

// ─── SERVICE PRICING (PRICE ESTIMATOR) ──────────────

export async function getServicePricingByCategory(serviceType: string, vehicleCategory: "compact" | "midsize" | "full-size" | "truck-suv") {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(servicePricing)
    .where(and(
      eq(servicePricing.serviceType, serviceType),
      eq(servicePricing.vehicleCategory, vehicleCategory),
      eq(servicePricing.isActive, 1),
    ))
    .limit(1);
  return results.length > 0 ? results[0] : null;
}

export async function getAllServicePricing() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(servicePricing)
    .where(eq(servicePricing.isActive, 1))
    .orderBy(servicePricing.serviceType, servicePricing.vehicleCategory);
}

export async function upsertServicePricing(data: InsertServicePricing) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if exists
  const existing = await db.select().from(servicePricing)
    .where(and(
      eq(servicePricing.serviceType, data.serviceType),
      eq(servicePricing.vehicleCategory, data.vehicleCategory),
    ))
    .limit(1);
  if (existing.length > 0) {
    await db.update(servicePricing).set({
      serviceLabel: data.serviceLabel,
      lowEstimate: data.lowEstimate,
      highEstimate: data.highEstimate,
      typicalHours: data.typicalHours,
      notes: data.notes,
    }).where(eq(servicePricing.id, existing[0].id));
    return { success: true, id: existing[0].id };
  } else {
    const result = await db.insert(servicePricing).values(data);
    return { success: true, id: Number(result[0].insertId) };
  }
}

export async function seedDefaultPricing() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const defaults: InsertServicePricing[] = [
    // Oil Change
    { serviceType: "oil-change", serviceLabel: "Oil Change (Conventional)", vehicleCategory: "compact", lowEstimate: 35, highEstimate: 50, typicalHours: "0.5" },
    { serviceType: "oil-change", serviceLabel: "Oil Change (Conventional)", vehicleCategory: "midsize", lowEstimate: 40, highEstimate: 55, typicalHours: "0.5" },
    { serviceType: "oil-change", serviceLabel: "Oil Change (Conventional)", vehicleCategory: "full-size", lowEstimate: 45, highEstimate: 65, typicalHours: "0.5" },
    { serviceType: "oil-change", serviceLabel: "Oil Change (Conventional)", vehicleCategory: "truck-suv", lowEstimate: 50, highEstimate: 75, typicalHours: "0.5-1" },
    { serviceType: "oil-change-synthetic", serviceLabel: "Oil Change (Full Synthetic)", vehicleCategory: "compact", lowEstimate: 65, highEstimate: 85, typicalHours: "0.5" },
    { serviceType: "oil-change-synthetic", serviceLabel: "Oil Change (Full Synthetic)", vehicleCategory: "midsize", lowEstimate: 70, highEstimate: 95, typicalHours: "0.5" },
    { serviceType: "oil-change-synthetic", serviceLabel: "Oil Change (Full Synthetic)", vehicleCategory: "full-size", lowEstimate: 75, highEstimate: 105, typicalHours: "0.5" },
    { serviceType: "oil-change-synthetic", serviceLabel: "Oil Change (Full Synthetic)", vehicleCategory: "truck-suv", lowEstimate: 85, highEstimate: 120, typicalHours: "0.5-1" },
    // Brake Pads
    { serviceType: "brake-pads-front", serviceLabel: "Front Brake Pads", vehicleCategory: "compact", lowEstimate: 150, highEstimate: 250, typicalHours: "1-2" },
    { serviceType: "brake-pads-front", serviceLabel: "Front Brake Pads", vehicleCategory: "midsize", lowEstimate: 175, highEstimate: 300, typicalHours: "1-2" },
    { serviceType: "brake-pads-front", serviceLabel: "Front Brake Pads", vehicleCategory: "full-size", lowEstimate: 200, highEstimate: 350, typicalHours: "1-2" },
    { serviceType: "brake-pads-front", serviceLabel: "Front Brake Pads", vehicleCategory: "truck-suv", lowEstimate: 225, highEstimate: 400, typicalHours: "1.5-2.5" },
    // Brake Pads + Rotors
    { serviceType: "brake-pads-rotors", serviceLabel: "Brake Pads + Rotors (Per Axle)", vehicleCategory: "compact", lowEstimate: 300, highEstimate: 450, typicalHours: "2-3" },
    { serviceType: "brake-pads-rotors", serviceLabel: "Brake Pads + Rotors (Per Axle)", vehicleCategory: "midsize", lowEstimate: 350, highEstimate: 550, typicalHours: "2-3" },
    { serviceType: "brake-pads-rotors", serviceLabel: "Brake Pads + Rotors (Per Axle)", vehicleCategory: "full-size", lowEstimate: 400, highEstimate: 650, typicalHours: "2-3" },
    { serviceType: "brake-pads-rotors", serviceLabel: "Brake Pads + Rotors (Per Axle)", vehicleCategory: "truck-suv", lowEstimate: 450, highEstimate: 750, typicalHours: "2.5-4" },
    // Tire Services
    { serviceType: "tire-mount-balance", serviceLabel: "Tire Mount & Balance (Per Tire)", vehicleCategory: "compact", lowEstimate: 20, highEstimate: 35, typicalHours: "0.5" },
    { serviceType: "tire-mount-balance", serviceLabel: "Tire Mount & Balance (Per Tire)", vehicleCategory: "midsize", lowEstimate: 25, highEstimate: 40, typicalHours: "0.5" },
    { serviceType: "tire-mount-balance", serviceLabel: "Tire Mount & Balance (Per Tire)", vehicleCategory: "full-size", lowEstimate: 25, highEstimate: 45, typicalHours: "0.5" },
    { serviceType: "tire-mount-balance", serviceLabel: "Tire Mount & Balance (Per Tire)", vehicleCategory: "truck-suv", lowEstimate: 30, highEstimate: 50, typicalHours: "0.5-1" },
    { serviceType: "tire-rotation", serviceLabel: "Tire Rotation", vehicleCategory: "compact", lowEstimate: 25, highEstimate: 40, typicalHours: "0.5" },
    { serviceType: "tire-rotation", serviceLabel: "Tire Rotation", vehicleCategory: "midsize", lowEstimate: 25, highEstimate: 40, typicalHours: "0.5" },
    { serviceType: "tire-rotation", serviceLabel: "Tire Rotation", vehicleCategory: "full-size", lowEstimate: 30, highEstimate: 45, typicalHours: "0.5" },
    { serviceType: "tire-rotation", serviceLabel: "Tire Rotation", vehicleCategory: "truck-suv", lowEstimate: 35, highEstimate: 50, typicalHours: "0.5" },
    { serviceType: "flat-repair", serviceLabel: "Flat Tire Repair", vehicleCategory: "compact", lowEstimate: 15, highEstimate: 30, typicalHours: "0.5" },
    { serviceType: "flat-repair", serviceLabel: "Flat Tire Repair", vehicleCategory: "midsize", lowEstimate: 15, highEstimate: 30, typicalHours: "0.5" },
    { serviceType: "flat-repair", serviceLabel: "Flat Tire Repair", vehicleCategory: "full-size", lowEstimate: 20, highEstimate: 35, typicalHours: "0.5" },
    { serviceType: "flat-repair", serviceLabel: "Flat Tire Repair", vehicleCategory: "truck-suv", lowEstimate: 25, highEstimate: 40, typicalHours: "0.5" },
    // Diagnostics
    { serviceType: "check-engine-diag", serviceLabel: "Check Engine Light Diagnostics", vehicleCategory: "compact", lowEstimate: 75, highEstimate: 125, typicalHours: "1", notes: "Includes OBD-II scan and initial diagnosis. Repair costs are separate." },
    { serviceType: "check-engine-diag", serviceLabel: "Check Engine Light Diagnostics", vehicleCategory: "midsize", lowEstimate: 75, highEstimate: 125, typicalHours: "1" },
    { serviceType: "check-engine-diag", serviceLabel: "Check Engine Light Diagnostics", vehicleCategory: "full-size", lowEstimate: 85, highEstimate: 150, typicalHours: "1-1.5" },
    { serviceType: "check-engine-diag", serviceLabel: "Check Engine Light Diagnostics", vehicleCategory: "truck-suv", lowEstimate: 85, highEstimate: 150, typicalHours: "1-1.5" },
    // Emissions / E-Check
    { serviceType: "emissions-repair", serviceLabel: "Emissions / E-Check Repair", vehicleCategory: "compact", lowEstimate: 150, highEstimate: 500, typicalHours: "1-4", notes: "Wide range depends on cause: O2 sensor, EVAP leak, or catalytic converter." },
    { serviceType: "emissions-repair", serviceLabel: "Emissions / E-Check Repair", vehicleCategory: "midsize", lowEstimate: 175, highEstimate: 600, typicalHours: "1-4" },
    { serviceType: "emissions-repair", serviceLabel: "Emissions / E-Check Repair", vehicleCategory: "full-size", lowEstimate: 200, highEstimate: 700, typicalHours: "1-5" },
    { serviceType: "emissions-repair", serviceLabel: "Emissions / E-Check Repair", vehicleCategory: "truck-suv", lowEstimate: 225, highEstimate: 800, typicalHours: "1-5" },
    // AC Repair
    { serviceType: "ac-recharge", serviceLabel: "AC Recharge", vehicleCategory: "compact", lowEstimate: 100, highEstimate: 175, typicalHours: "0.5-1" },
    { serviceType: "ac-recharge", serviceLabel: "AC Recharge", vehicleCategory: "midsize", lowEstimate: 100, highEstimate: 175, typicalHours: "0.5-1" },
    { serviceType: "ac-recharge", serviceLabel: "AC Recharge", vehicleCategory: "full-size", lowEstimate: 125, highEstimate: 200, typicalHours: "0.5-1" },
    { serviceType: "ac-recharge", serviceLabel: "AC Recharge", vehicleCategory: "truck-suv", lowEstimate: 125, highEstimate: 225, typicalHours: "0.5-1" },
    // Suspension
    { serviceType: "struts-pair", serviceLabel: "Struts Replacement (Pair)", vehicleCategory: "compact", lowEstimate: 400, highEstimate: 700, typicalHours: "2-4" },
    { serviceType: "struts-pair", serviceLabel: "Struts Replacement (Pair)", vehicleCategory: "midsize", lowEstimate: 450, highEstimate: 800, typicalHours: "2-4" },
    { serviceType: "struts-pair", serviceLabel: "Struts Replacement (Pair)", vehicleCategory: "full-size", lowEstimate: 500, highEstimate: 900, typicalHours: "3-5" },
    { serviceType: "struts-pair", serviceLabel: "Struts Replacement (Pair)", vehicleCategory: "truck-suv", lowEstimate: 550, highEstimate: 1000, typicalHours: "3-5" },
    // Alignment
    { serviceType: "alignment", serviceLabel: "Wheel Alignment", vehicleCategory: "compact", lowEstimate: 75, highEstimate: 100, typicalHours: "1" },
    { serviceType: "alignment", serviceLabel: "Wheel Alignment", vehicleCategory: "midsize", lowEstimate: 75, highEstimate: 100, typicalHours: "1" },
    { serviceType: "alignment", serviceLabel: "Wheel Alignment", vehicleCategory: "full-size", lowEstimate: 85, highEstimate: 120, typicalHours: "1" },
    { serviceType: "alignment", serviceLabel: "Wheel Alignment", vehicleCategory: "truck-suv", lowEstimate: 95, highEstimate: 130, typicalHours: "1-1.5" },
  ];

  for (const item of defaults) {
    await upsertServicePricing(item);
  }
  return { success: true, count: defaults.length };
}

// ─── VEHICLE INSPECTION QUERIES ─────────────────────

function generateShareToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

export async function createInspection(data: Omit<InsertVehicleInspection, "shareToken">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const shareToken = generateShareToken();
  const result = await db.insert(vehicleInspections).values({ ...data, shareToken });
  return { success: true, id: Number(result[0].insertId), shareToken };
}

export async function getInspection(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [inspection] = await db.select().from(vehicleInspections).where(eq(vehicleInspections.id, id)).limit(1);
  if (!inspection) return null;
  const items = await db.select().from(inspectionItems)
    .where(eq(inspectionItems.inspectionId, id))
    .orderBy(inspectionItems.sortOrder);
  return { ...inspection, items };
}

export async function getInspectionByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const [inspection] = await db.select().from(vehicleInspections)
    .where(and(eq(vehicleInspections.shareToken, token), eq(vehicleInspections.isPublished, 1)))
    .limit(1);
  if (!inspection) return null;
  const items = await db.select().from(inspectionItems)
    .where(eq(inspectionItems.inspectionId, inspection.id))
    .orderBy(inspectionItems.sortOrder);
  return { ...inspection, items };
}

export async function getInspections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vehicleInspections).orderBy(desc(vehicleInspections.createdAt));
}

export async function addInspectionItem(data: InsertInspectionItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(inspectionItems).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateInspectionItem(id: number, data: Partial<InsertInspectionItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(inspectionItems).set(data).where(eq(inspectionItems.id, id));
  return { success: true };
}

export async function deleteInspectionItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(inspectionItems).where(eq(inspectionItems.id, id));
  return { success: true };
}

export async function publishInspection(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(vehicleInspections).set({ isPublished: 1 }).where(eq(vehicleInspections.id, id));
  return { success: true };
}

// ─── LOYALTY PROGRAM QUERIES ────────────────────────

export async function getLoyaltyRewards() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loyaltyRewards)
    .where(eq(loyaltyRewards.isActive, 1))
    .orderBy(loyaltyRewards.pointsCost);
}

export async function createLoyaltyReward(data: InsertLoyaltyReward) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(loyaltyRewards).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateLoyaltyReward(id: number, data: Partial<InsertLoyaltyReward>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(loyaltyRewards).set(data).where(eq(loyaltyRewards.id, id));
  return { success: true };
}

export async function getLoyaltyTransactions(userId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loyaltyTransactions)
    .where(eq(loyaltyTransactions.userId, userId))
    .orderBy(desc(loyaltyTransactions.createdAt))
    .limit(limit);
}

export async function awardPoints(userId: number, points: number, description: string, serviceHistoryId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get current balance
  const [user] = await db.select({ loyaltyPoints: users.loyaltyPoints }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  const newBalance = user.loyaltyPoints + points;
  // Update user balance
  await db.update(users).set({ loyaltyPoints: newBalance }).where(eq(users.id, userId));
  // Log transaction
  await db.insert(loyaltyTransactions).values({
    userId,
    type: "earn",
    points,
    balanceAfter: newBalance,
    description,
    serviceHistoryId: serviceHistoryId || null,
  });
  // Check tier upgrade
  await updateLoyaltyTier(userId);
  return { success: true, newBalance };
}

export async function redeemReward(userId: number, rewardId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get reward
  const [reward] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId)).limit(1);
  if (!reward) throw new Error("Reward not found");
  if (!reward.isActive) throw new Error("Reward is no longer available");
  // Get user balance
  const [user] = await db.select({ loyaltyPoints: users.loyaltyPoints }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  if (user.loyaltyPoints < reward.pointsCost) throw new Error("Not enough points");
  const newBalance = user.loyaltyPoints - reward.pointsCost;
  // Update user balance
  await db.update(users).set({ loyaltyPoints: newBalance }).where(eq(users.id, userId));
  // Log transaction
  await db.insert(loyaltyTransactions).values({
    userId,
    type: "redeem",
    points: -reward.pointsCost,
    balanceAfter: newBalance,
    description: `Redeemed: ${reward.title}`,
    rewardId,
  });
  return { success: true, newBalance, reward };
}

export async function getUserLoyaltySummary(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({
    loyaltyPoints: users.loyaltyPoints,
    loyaltyTier: users.loyaltyTier,
    totalVisits: users.totalVisits,
    totalSpent: users.totalSpent,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  // Get recent transactions
  const recentTx = await db.select().from(loyaltyTransactions)
    .where(eq(loyaltyTransactions.userId, userId))
    .orderBy(desc(loyaltyTransactions.createdAt))
    .limit(5);
  return { ...user, recentTransactions: recentTx };
}

async function updateLoyaltyTier(userId: number) {
  const db = await getDb();
  if (!db) return;
  const [user] = await db.select({ totalSpent: users.totalSpent, totalVisits: users.totalVisits }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  let tier: "bronze" | "silver" | "gold" | "platinum" = "bronze";
  if (user.totalSpent >= 5000 || user.totalVisits >= 20) tier = "platinum";
  else if (user.totalSpent >= 2000 || user.totalVisits >= 10) tier = "gold";
  else if (user.totalSpent >= 500 || user.totalVisits >= 3) tier = "silver";
  await db.update(users).set({ loyaltyTier: tier }).where(eq(users.id, userId));
}


// ─── REVIEW REQUEST QUERIES ──────────────────────────

import { ne, isNull, lt, gt, count as drizzleCount } from "drizzle-orm";

/**
 * Create a new review request record (pending state).
 */
export async function createReviewRequest(data: InsertReviewRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(reviewRequests).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

/**
 * Get all review requests, newest first.
 */
export async function getReviewRequests(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviewRequests)
    .orderBy(desc(reviewRequests.createdAt))
    .limit(limit);
}

/**
 * Get review requests that are pending and past their scheduled time.
 */
export async function getPendingReviewRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviewRequests)
    .where(and(
      eq(reviewRequests.status, "pending"),
      lte(reviewRequests.scheduledAt, new Date()),
    ))
    .orderBy(reviewRequests.scheduledAt)
    .limit(50);
}

/**
 * Mark a review request as sent.
 */
export async function markReviewRequestSent(id: number, twilioSid?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reviewRequests).set({
    status: "sent",
    sentAt: new Date(),
    twilioSid: twilioSid || null,
  }).where(eq(reviewRequests.id, id));
  return { success: true };
}

/**
 * Mark a review request as failed.
 */
export async function markReviewRequestFailed(id: number, errorMessage: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reviewRequests).set({
    status: "failed",
    errorMessage,
  }).where(eq(reviewRequests.id, id));
  return { success: true };
}

/**
 * Mark a review request as clicked (customer opened the review link).
 */
export async function markReviewRequestClicked(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(reviewRequests)
    .where(eq(reviewRequests.trackingToken, token))
    .limit(1);
  if (!existing) return { success: false, error: "Token not found" };
  // Only update if not already clicked
  if (!existing.clickedAt) {
    await db.update(reviewRequests).set({ status: "clicked", clickedAt: new Date() })
      .where(eq(reviewRequests.id, existing.id));
  }
  return { success: true };
}

/**
 * Check if a phone number has been sent a review request within the cooldown period.
 * Returns true if the phone is on cooldown (should NOT send).
 */
export async function isPhoneOnReviewCooldown(phone: string, cooldownDays: number) {
  const db = await getDb();
  if (!db) return true; // Fail safe: don't send if DB is down
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cooldownDays);
  const results = await db.select({ id: reviewRequests.id }).from(reviewRequests)
    .where(and(
      eq(reviewRequests.phone, phone),
      ne(reviewRequests.status, "failed"),
      gte(reviewRequests.createdAt, cutoff),
    ))
    .limit(1);
  return results.length > 0;
}

/**
 * Count how many review requests were sent today.
 */
export async function getReviewRequestsSentToday() {
  const db = await getDb();
  if (!db) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [result] = await db.select({
    count: sql<number>`count(*)`,
  }).from(reviewRequests)
    .where(and(
      eq(reviewRequests.status, "sent"),
      gte(reviewRequests.sentAt, todayStart),
    ));
  return result?.count ?? 0;
}

/**
 * Get review request stats for the admin dashboard.
 */
export async function getReviewRequestStats() {
  const db = await getDb();
  if (!db) return { total: 0, sent: 0, clicked: 0, failed: 0, pending: 0, clickRate: 0 };
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests);
  const [sent] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "sent"));
  const [clicked] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "clicked"));
  const [failed] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "failed"));
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "pending"));
  const sentCount = (sent?.count ?? 0) + (clicked?.count ?? 0);
  const clickedCount = clicked?.count ?? 0;
  return {
    total: total?.count ?? 0,
    sent: sentCount,
    clicked: clickedCount,
    failed: failed?.count ?? 0,
    pending: pending?.count ?? 0,
    clickRate: sentCount > 0 ? Math.round((clickedCount / sentCount) * 100) : 0,
  };
}

// ─── REVIEW SETTINGS QUERIES ─────────────────────────

/**
 * Get review settings (single-row, id=1). Creates defaults if not exists.
 */
export async function getReviewSettings() {
  const db = await getDb();
  if (!db) return { id: 1, enabled: 1, delayMinutes: 120, maxPerDay: 20, cooldownDays: 30, messageTemplate: null, updatedAt: new Date() };
  const [existing] = await db.select().from(reviewSettings).limit(1);
  if (existing) return existing;
  // Create defaults
  await db.insert(reviewSettings).values({ enabled: 1, delayMinutes: 120, maxPerDay: 20, cooldownDays: 30 });
  const [created] = await db.select().from(reviewSettings).limit(1);
  return created || { id: 1, enabled: 1, delayMinutes: 120, maxPerDay: 20, cooldownDays: 30, messageTemplate: null, updatedAt: new Date() };
}

/**
 * Update review settings.
 */
export async function updateReviewSettings(data: { enabled?: number; delayMinutes?: number; maxPerDay?: number; cooldownDays?: number; messageTemplate?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Ensure row exists
  await getReviewSettings();
  const [row] = await db.select({ id: reviewSettings.id }).from(reviewSettings).limit(1);
  if (row) {
    await db.update(reviewSettings).set(data).where(eq(reviewSettings.id, row.id));
  }
  return { success: true };
}

/**
 * Get completed bookings from the past year that have NOT had a review request sent.
 * Used for the backfill blast feature.
 */
export async function getCompletedBookingsWithoutReview(lookbackDays = 365) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  // Get all completed bookings from the past year
  const completedBookings = await db.select({
    id: bookings.id,
    name: bookings.name,
    phone: bookings.phone,
    service: bookings.service,
    vehicle: bookings.vehicle,
    createdAt: bookings.createdAt,
  }).from(bookings)
    .where(and(
      eq(bookings.status, "completed"),
      gte(bookings.createdAt, cutoff),
    ))
    .orderBy(desc(bookings.createdAt));

  // Get all phones that already have a non-failed review request
  const existingPhones = await db.select({ phone: reviewRequests.phone }).from(reviewRequests)
    .where(ne(reviewRequests.status, "failed"));
  const phoneSet = new Set(existingPhones.map((r: any) => r.phone));

  // Filter out bookings whose phone already has a review request
  // Also deduplicate by phone (only keep most recent booking per phone)
  const seenPhones = new Set<string>();
  const eligible: typeof completedBookings = [];
  for (const b of completedBookings) {
    const normalized = b.phone.replace(/\D/g, "").slice(-10);
    if (phoneSet.has(normalized) || seenPhones.has(normalized)) continue;
    seenPhones.add(normalized);
    eligible.push(b);
  }
  return eligible;
}

// ─── SERVICE REMINDERS ──────────────────────────────────
import {
  serviceReminders, InsertServiceReminder,
  reminderSettings, InsertReminderSetting,
  smsConversations, InsertSmsConversation,
  smsMessages, InsertSmsMessage,
  repairGallery, InsertRepairGalleryItem,
  technicians, InsertTechnician,
} from "../drizzle/schema";

// ── Reminder Settings ──
export async function getReminderSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminderSettings).orderBy(reminderSettings.serviceType);
}

export async function upsertReminderSetting(data: InsertReminderSetting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if exists
  const existing = await db.select().from(reminderSettings)
    .where(eq(reminderSettings.serviceType, data.serviceType)).limit(1);
  if (existing.length > 0) {
    await db.update(reminderSettings).set(data).where(eq(reminderSettings.id, existing[0].id));
    return { success: true, id: existing[0].id };
  }
  const result = await db.insert(reminderSettings).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function seedDefaultReminderSettings() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(reminderSettings);
  if (existing.length > 0) return; // Already seeded
  const defaults: InsertReminderSetting[] = [
    { serviceType: "oil-change", serviceLabel: "Oil Change", intervalMonths: 6, intervalMiles: 5000, enabled: 1 },
    { serviceType: "brakes", serviceLabel: "Brake Inspection", intervalMonths: 12, intervalMiles: 30000, enabled: 1 },
    { serviceType: "tires", serviceLabel: "Tire Rotation", intervalMonths: 6, intervalMiles: 6000, enabled: 1 },
    { serviceType: "coolant", serviceLabel: "Coolant Flush", intervalMonths: 24, intervalMiles: 30000, enabled: 1 },
    { serviceType: "transmission", serviceLabel: "Transmission Service", intervalMonths: 36, intervalMiles: 60000, enabled: 1 },
    { serviceType: "alignment", serviceLabel: "Wheel Alignment", intervalMonths: 12, intervalMiles: 12000, enabled: 1 },
    { serviceType: "battery", serviceLabel: "Battery Check", intervalMonths: 12, intervalMiles: 0, enabled: 1 },
    { serviceType: "air-filter", serviceLabel: "Air Filter Replacement", intervalMonths: 12, intervalMiles: 15000, enabled: 1 },
  ];
  await db.insert(reminderSettings).values(defaults);
}

// ── Service Reminders CRUD ──
export async function createServiceReminder(data: InsertServiceReminder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(serviceReminders).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getServiceReminders(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceReminders).orderBy(desc(serviceReminders.nextDueDate)).limit(limit);
}

export async function getDueReminders() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return db.select().from(serviceReminders)
    .where(and(
      eq(serviceReminders.status, "scheduled"),
      lte(serviceReminders.nextDueDate, now),
    ))
    .orderBy(serviceReminders.nextDueDate);
}

export async function markReminderSent(id: number, twilioSid?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(serviceReminders).set({
    status: "sent",
    sentAt: new Date(),
    twilioSid: twilioSid || null,
  }).where(eq(serviceReminders.id, id));
}

export async function snoozeReminder(id: number, snoozeDays: number) {
  const db = await getDb();
  if (!db) return;
  const snoozedUntil = new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000);
  await db.update(serviceReminders).set({
    status: "snoozed",
    snoozedUntil,
    nextDueDate: snoozedUntil,
  }).where(eq(serviceReminders.id, id));
}

export async function getReminderStats() {
  const db = await getDb();
  if (!db) return { total: 0, scheduled: 0, sent: 0, snoozed: 0, dueNow: 0 };
  const all = await db.select().from(serviceReminders);
  const now = new Date();
  return {
    total: all.length,
    scheduled: all.filter((r: any) => r.status === "scheduled").length,
    sent: all.filter((r: any) => r.status === "sent").length,
    snoozed: all.filter((r: any) => r.status === "snoozed").length,
    dueNow: all.filter((r: any) => r.status === "scheduled" && r.nextDueDate <= now).length,
  };
}

/**
 * Schedule reminders for a completed booking based on the service type.
 * Matches service keywords to reminder settings and creates future reminders.
 */
export async function scheduleRemindersForBooking(booking: {
  id: number;
  name: string;
  phone: string;
  service: string;
  vehicle?: string | null;
}) {
  const db = await getDb();
  if (!db) return [];
  const settings = await getReminderSettings();
  const enabledSettings = settings.filter((s: any) => s.enabled === 1);
  const serviceLower = booking.service.toLowerCase();
  const created: number[] = [];

  for (const setting of enabledSettings) {
    // Match service type keywords
    const keywords = getServiceKeywords(setting.serviceType);
    const matches = keywords.some(kw => serviceLower.includes(kw));
    if (!matches) continue;

    // Calculate next due date
    const nextDueDate = new Date();
    nextDueDate.setMonth(nextDueDate.getMonth() + setting.intervalMonths);

    const result = await createServiceReminder({
      bookingId: booking.id,
      customerName: booking.name,
      phone: booking.phone.replace(/\D/g, "").slice(-10),
      vehicleInfo: booking.vehicle || undefined,
      serviceType: setting.serviceType,
      lastServiceDate: new Date(),
      lastServiceMileage: undefined,
      nextDueDate,
      nextDueMileage: setting.intervalMiles > 0 ? setting.intervalMiles : undefined,
      status: "scheduled",
    });
    created.push(result.id);
  }
  return created;
}

function getServiceKeywords(serviceType: string): string[] {
  const map: Record<string, string[]> = {
    "oil-change": ["oil", "lube", "synthetic"],
    "brakes": ["brake", "rotor", "pad", "caliper"],
    "tires": ["tire", "rotation", "balance", "mount"],
    "coolant": ["coolant", "radiator", "cooling", "flush"],
    "transmission": ["transmission", "trans"],
    "alignment": ["alignment", "align"],
    "battery": ["battery", "electrical", "alternator"],
    "air-filter": ["air filter", "cabin filter", "filter"],
  };
  return map[serviceType] || [serviceType];
}

// ─── SMS CONVERSATIONS ──────────────────────────────────
export async function getOrCreateConversation(phone: string, customerName?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalized = phone.replace(/\D/g, "").slice(-10);
  const existing = await db.select().from(smsConversations)
    .where(eq(smsConversations.phone, normalized)).limit(1);
  if (existing.length > 0) return existing[0];
  const result = await db.insert(smsConversations).values({
    phone: normalized,
    customerName: customerName || null,
  });
  const [created] = await db.select().from(smsConversations)
    .where(eq(smsConversations.id, Number(result[0].insertId)));
  return created;
}

export async function addSmsMessage(data: InsertSmsMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(smsMessages).values(data);
  // Update conversation last message
  await db.update(smsConversations).set({
    lastMessageAt: new Date(),
    lastMessagePreview: (data.body as string).slice(0, 255),
    unreadCount: data.direction === "inbound"
      ? sql`${smsConversations.unreadCount} + 1`
      : sql`${smsConversations.unreadCount}`,
  }).where(eq(smsConversations.id, data.conversationId));
  return { success: true, id: Number(result[0].insertId) };
}

export async function getConversations(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(smsConversations)
    .orderBy(desc(smsConversations.lastMessageAt)).limit(limit);
}

export async function getConversationMessages(conversationId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(smsMessages)
    .where(eq(smsMessages.conversationId, conversationId))
    .orderBy(smsMessages.createdAt).limit(limit);
}

export async function markConversationRead(conversationId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(smsConversations).set({ unreadCount: 0 })
    .where(eq(smsConversations.id, conversationId));
}

export async function getUnreadConversationCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select().from(smsConversations)
    .where(gt(smsConversations.unreadCount, 0));
  return result.length;
}

// ─── REPAIR GALLERY ──────────────────────────────────────
export async function getPublicGalleryItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(repairGallery)
    .where(eq(repairGallery.isPublished, 1))
    .orderBy(repairGallery.sortOrder);
}

export async function getAllGalleryItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(repairGallery).orderBy(desc(repairGallery.createdAt));
}

export async function createGalleryItem(data: InsertRepairGalleryItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(repairGallery).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateGalleryItem(id: number, data: Partial<InsertRepairGalleryItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(repairGallery).set(data).where(eq(repairGallery.id, id));
  return { success: true };
}

export async function deleteGalleryItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(repairGallery).where(eq(repairGallery.id, id));
  return { success: true };
}

// ─── TECHNICIANS ─────────────────────────────────────────
export async function getActiveTechnicians() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(technicians)
    .where(eq(technicians.isActive, 1))
    .orderBy(technicians.sortOrder);
}

export async function getAllTechnicians() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(technicians).orderBy(desc(technicians.createdAt));
}

export async function createTechnician(data: InsertTechnician) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(technicians).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateTechnician(id: number, data: Partial<InsertTechnician>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(technicians).set(data).where(eq(technicians.id, id));
  return { success: true };
}

export async function deleteTechnician(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(technicians).where(eq(technicians.id, id));
  return { success: true };
}

// ─── INVOICE HELPERS ─────────────────────────────────────────
import { invoices, type InsertInvoice } from "../drizzle/schema";

/** Generate the next invoice number: INV-YYYYMMDD-NNN */
export async function getNextInvoiceNumber(): Promise<string> {
  const db = await getDb();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `INV-${dateStr}-`;

  if (db) {
    // Use MAX to find the highest sequence number (avoids COUNT gaps on deletes)
    const [row] = await db
      .select({ maxNum: sql<string | null>`MAX(invoiceNumber)` })
      .from(invoices)
      .where(sql`invoiceNumber LIKE ${prefix + "%"}`);
    const lastSeq = row?.maxNum ? parseInt(row.maxNum.slice(-3), 10) : 0;
    const seq = (lastSeq + 1).toString().padStart(3, "0");
    return prefix + seq;
  }
  return prefix + "001";
}

/** Create an invoice record with retry on unique constraint collision */
export async function createInvoice(data: InsertInvoice): Promise<{ success: boolean; id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Retry up to 3 times on unique constraint violations (concurrent invoice creation)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.insert(invoices).values(data);
      return { success: true, id: Number(result[0].insertId) };
    } catch (err: any) {
      const isDuplicate = err?.code === "ER_DUP_ENTRY" || err?.message?.includes("Duplicate entry");
      if (isDuplicate && data.invoiceNumber && attempt < 2) {
        // Regenerate invoice number and retry
        data.invoiceNumber = await getNextInvoiceNumber();
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to create invoice after 3 attempts");
}

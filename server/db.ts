import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users, bookings, InsertBooking,
  coupons, InsertCoupon, Coupon,
  customerVehicles, InsertCustomerVehicle,
  serviceHistory, InsertServiceHistory,
  referrals, InsertReferral,
  mechanicQA, InsertMechanicQA,
  analyticsSnapshots, InsertAnalyticsSnapshot,
  customerNotifications, InsertCustomerNotification,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
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
    } else if (user.openId === ENV.ownerOpenId) {
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
  await db.insert(bookings).values(booking);
  return { success: true };
}

export async function getBookings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bookings).orderBy(desc(bookings.createdAt));
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

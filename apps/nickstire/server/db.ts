import { eq, desc, and, gte, lte, sql, inArray, notInArray } from "drizzle-orm";
import {
  CANDIDATE_FOLLOW_UP_NEVER,
  CANDIDATE_SLA_OPEN_STATUSES,
  CANDIDATE_SOURCE_HONEYPOT,
  type CandidateStatus,
} from "@shared/candidateLifecycle";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser, users, bookings, InsertBooking,
  coupons, InsertCoupon,
  customerVehicles, InsertCustomerVehicle,
  serviceHistory, InsertServiceHistory,
  referrals, InsertReferral,
  leads,
  technicianReferrals, InsertTechnicianReferral, TechnicianReferral,
  candidates, InsertCandidate, Candidate,
  mechanicQA, InsertMechanicQA,
  analyticsSnapshots, InsertAnalyticsSnapshot,
  customerNotifications, InsertCustomerNotification,
} from "../drizzle/schema";
import { ENV } from './_core/env';

/**
 * Typed Drizzle MySQL2 database instance — exported for use in new code.
 * The internal `_db` is still typed loose to avoid churning ~200 legacy
 * `.execute().cast` call sites. Migrate site-by-site via getDbTyped().
 */
export type DB = MySql2Database<Record<string, never>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle instance typed as any to keep legacy .execute() cast sites compiling. Migrate per-file via getDbTyped() when ready.
let _db: any = null;
let _pool: mysql.Pool | null = null;

/**
 * How long a retired pool stays open after resetDbConnection() swaps it out.
 * Requests that already hold the old drizzle handle (`const db = await getDb()`
 * then several queries) keep working through it until then.
 */
const RETIRED_POOL_GRACE_MS = 60_000;

/**
 * Reset the cached DB connection — used by self-healing to force reconnection.
 *
 * The NEXT getDb() builds a fresh pool; the old one is ended only after
 * RETIRED_POOL_GRACE_MS. mysql2's pool.end() is not graceful for callers that
 * still hold the pool: it rejects queued and later getConnection() calls with
 * "Pool is closed." and quits every connection, in-use ones included. Ending it
 * immediately (the old behaviour) turned one health-check reset into "Pool is
 * closed" / "Connection lost" errors on unrelated in-flight requests.
 */
export function resetDbConnection(): void {
  const retired = _pool;
  _pool = null;
  _db = null;
  if (!retired) return;
  const timer = setTimeout(() => {
    retired.end().catch((e) => { log.warn("[db] retired pool end failed:", e); });
  }, RETIRED_POOL_GRACE_MS);
  timer.unref?.();
}

/**
 * Strictly-typed variant for new code — same singleton, but returns the
 * proper DB type. Prefer this for anything written after 2026-04-22.
 */
export async function getDbTyped(): Promise<DB | null> {
  return (await getDb()) as DB | null;
}

// Lazily create the drizzle instance with connection pooling.
// Return type kept as `any` so the 200+ legacy call sites don't need
// updating all at once. New code should prefer getDbTyped().
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        // wave-181.77 (db-optimizer audit) · bumped from 5 to 10. The
        // bulk-SMS fire path (scripts/fire-declined-recovery.ts) and
        // checkDailyLimit's two-query upsert+select on EVERY sendSms
        // can monopolize 5 connections during peak load. With concurrent
        // portal verifyCode + admin SMS chat polls, we were close to the
        // queueLimit threshold. 10 covers expected concurrent traffic
        // with headroom · TiDB Cloud serverless handles 100+ easily.
        connectionLimit: 10,
        maxIdle: 4,
        waitForConnections: true,
        // Bounded queue — spike protection. Under burst load, rather than
        // letting the queue grow unbounded (→ OOM), we fail fast once 50
        // requests are waiting. Monitor hits; if frequent, raise
        // connectionLimit, not queueLimit.
        queueLimit: 50,
        idleTimeout: 60000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });
      _db = drizzle(_pool);
    } catch (error) {
      log.warn("[Database] Failed to connect:", error);
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
    log.warn("[Database] Cannot upsert user: database not available");
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
      // Primary, always-on path: openId matches OWNER_OPEN_ID.
      (ENV.ownerOpenId && user.openId === ENV.ownerOpenId) ||
      // Fallback bootstrap: OWNER_OPEN_ID unset AND the Google-verified email
      // matches CEO_EMAIL. Gated to non-production so that clearing OWNER_OPEN_ID
      // in prod cannot silently re-open admin bootstrap to anyone controlling a
      // Google account whose email matches CEO_EMAIL. In prod, keep OWNER_OPEN_ID set.
      (process.env.NODE_ENV !== 'production' &&
        !ENV.ownerOpenId && ENV.ceoEmail && user.email &&
        user.email.toLowerCase() === ENV.ceoEmail.toLowerCase())
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
    log.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    log.warn("[Database] Cannot get user: database not available");
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
  // maxRedemptions = 0 means unlimited; exclude coupons that have hit their cap.
  return db.select().from(coupons)
    .where(and(
      eq(coupons.isActive, 1),
      lte(coupons.startsAt, now),
      sql`(${coupons.expiresAt} IS NULL OR ${coupons.expiresAt} >= ${now})`,
      sql`(${coupons.maxRedemptions} = 0 OR ${coupons.currentRedemptions} < ${coupons.maxRedemptions})`,
    ))
    .orderBy(desc(coupons.isFeatured), desc(coupons.createdAt));
}

export async function getAllCoupons() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200);
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

/**
 * Atomically validate and record a single coupon redemption.
 *
 * Rules:
 *   - maxRedemptions = 0  → unlimited; always increments and succeeds.
 *   - maxRedemptions > 0  → hard cap; rejects when currentRedemptions >= maxRedemptions.
 *   - Inactive or expired coupons are rejected before the increment.
 *   - Concurrency: the UPDATE is conditional (WHERE clause mirrors the cap check),
 *     so affectedRows = 0 means a concurrent claim won the last slot → cap error.
 *
 * Does NOT send SMS. Does NOT publish anything. Pure DB write.
 */
export async function redeemCouponById(id: number): Promise<{ success: true; currentRedemptions: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Step 1: Fetch coupon for validation
  const rows = await db.select({
    isActive: coupons.isActive,
    expiresAt: coupons.expiresAt,
    maxRedemptions: coupons.maxRedemptions,
    currentRedemptions: coupons.currentRedemptions,
  }).from(coupons).where(eq(coupons.id, id)).limit(1);

  if (rows.length === 0) {
    throw new Error("COUPON_NOT_FOUND");
  }

  const coupon = rows[0];

  if (coupon.isActive !== 1) {
    throw new Error("COUPON_INACTIVE");
  }

  const now = new Date();
  if (coupon.expiresAt !== null && coupon.expiresAt < now) {
    throw new Error("COUPON_EXPIRED");
  }

  if (coupon.maxRedemptions > 0 && coupon.currentRedemptions >= coupon.maxRedemptions) {
    throw new Error("COUPON_CAP_REACHED");
  }

  // Step 2: Atomic increment with cap guard in WHERE clause.
  // If a concurrent claim consumed the last slot between Step 1 and here,
  // the WHERE condition fails → affectedRows = 0 → we catch it below.
  const updateResult = await db.update(coupons)
    .set({ currentRedemptions: sql`${coupons.currentRedemptions} + 1` })
    .where(and(
      eq(coupons.id, id),
      eq(coupons.isActive, 1),
      // Re-check cap atomically: maxRedemptions=0 (unlimited) OR still under cap
      sql`(${coupons.maxRedemptions} = 0 OR ${coupons.currentRedemptions} < ${coupons.maxRedemptions})`,
    ));

  // mysql2 returns [ResultSetHeader, ...] — affectedRows is on [0]
  const affectedRows = (updateResult[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;

  if (affectedRows === 0) {
    // A concurrent claim won the last slot after our read
    throw new Error("COUPON_CAP_REACHED");
  }

  return { success: true, currentRedemptions: coupon.currentRedemptions + 1 };
}

// ─── CUSTOMER VEHICLE QUERIES ─────────────────────────

export async function getCustomerVehicles(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerVehicles)
    .where(eq(customerVehicles.userId, userId))
    .orderBy(desc(customerVehicles.updatedAt));
}

/**
 * 2026-09-01 (audit, artifact 3 §7 P2-2): when a VIN is supplied and year /
 * make / model are blank, fill them from NHTSA vPIC. Human-entered values are
 * never overwritten; a decode failure changes nothing (the helper never throws).
 */
async function fillVehicleFromVin<T extends Partial<InsertCustomerVehicle>>(vehicle: T): Promise<T> {
  if (!vehicle.vin) return vehicle;
  if (vehicle.year && vehicle.make && vehicle.model) return vehicle;
  const { decodeVin, mergeDecoded } = await import("./services/vinDecode");
  const decoded = await decodeVin(vehicle.vin);
  const merged = mergeDecoded(vehicle, decoded);
  const { vinDecodedFrom, ...row } = merged as T & { vinDecodedFrom?: "vpic" };
  if (vinDecodedFrom) log.info("[vehicles] filled year/make/model from vPIC", { vinLast4: vehicle.vin.slice(-4) });
  return row as T;
}

export async function addCustomerVehicle(vehicle: InsertCustomerVehicle) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await fillVehicleFromVin(vehicle);
  const result = await db.insert(customerVehicles).values(row);
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateCustomerVehicle(id: number, userId: number, data: Partial<InsertCustomerVehicle>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let row: Partial<InsertCustomerVehicle> = data;
  if (data.vin && !(data.year && data.make && data.model)) {
    // Codex P2 on PR #2063: a partial patch that carries only a VIN must not
    // let the decoder overwrite year/make/model a human already stored. Fill
    // against the STORED row, and copy back only the fields that were blank
    // in both the patch and the row.
    const [existing] = await db.select({ year: customerVehicles.year, make: customerVehicles.make, model: customerVehicles.model })
      .from(customerVehicles)
      .where(and(eq(customerVehicles.id, id), eq(customerVehicles.userId, userId)))
      .limit(1);
    const base = {
      vin: data.vin,
      year: data.year ?? existing?.year ?? undefined,
      make: data.make ?? existing?.make ?? undefined,
      model: data.model ?? existing?.model ?? undefined,
    };
    const filled = await fillVehicleFromVin(base);
    row = { ...data };
    for (const k of ["year", "make", "model"] as const) {
      if (!base[k] && filled[k]) (row as Record<string, unknown>)[k] = filled[k];
    }
  }
  await db.update(customerVehicles).set(row)
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
  return db.select().from(referrals).orderBy(desc(referrals.createdAt)).limit(500);
}

export async function updateReferralStatus(id: number, status: "pending" | "visited" | "redeemed" | "expired") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referrals).set({ status }).where(eq(referrals.id, id));
  return { success: true };
}

// ─── TECHNICIAN REFERRAL QUERIES ──────────────────────
//
// Separate from `referrals` above (the $25/$25 customer program) — this backs
// the $300-after-90-days TECHNICIAN referral bonus advertised on /careers.
// drizzle/0121_technician_referrals.sql creates the table; it is hand-applied
// and, as of this code shipping, may not yet be applied to production. Every
// function here therefore distinguishes "table not migrated yet" from a real
// failure, the same empty-vs-error discipline the Lot section uses for
// vehicle_visits — a caller must never render "not yet migrated" as "zero
// referrals" or crash the caller's own request.

// "Table doesn't exist" (1146) only, looking through drizzle's
// DrizzleQueryError wrapper to the driver error on `.cause`. One definition
// lives in lib/dbErrors.ts; it is re-exported here for this file's callers and
// tests.
import { describeDbError, isMissingTableError, isUnknownColumnError } from "./lib/dbErrors";
export { isMissingTableError, isUnknownColumnError };

export async function createTechnicianReferral(referral: InsertTechnicianReferral) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    // `submit` is a public procedure — the caller supplies leadId/candidateId
    // directly, so neither can be trusted as-is: an unauthenticated caller
    // could attach a fabricated $300 referral claim to an arbitrary sequential
    // ID. Verify each one exists and actually came from /careers before
    // storing the association; otherwise keep the referral (still worth
    // recording — the applicant's own name/phone are separate) but drop the
    // association. Since Careers.tsx's cutover to candidates.submit,
    // new referrals populate candidateId; leadId stays populated only for
    // rows tied to a pre-cutover lead.
    let leadId = referral.leadId ?? null;
    if (leadId != null) {
      const [lead] = await db.select({ id: leads.id, source: leads.source }).from(leads).where(eq(leads.id, leadId)).limit(1);
      if (!lead || lead.source !== "careers") leadId = null;
    }
    let candidateId = referral.candidateId ?? null;
    if (candidateId != null) {
      const [candidate] = await db
        .select({
          id: candidates.id,
          source: candidates.source,
          phone: candidates.phone,
          name: candidates.name,
        })
        .from(candidates)
        .where(eq(candidates.id, candidateId))
        .limit(1);
      if (!candidate || candidate.source !== "careers") {
        candidateId = null;
      } else {
        // SELF-REFERRAL GUARD. This is the $300 program; the $25 CUSTOMER
        // program at referrals.submit has had one since it shipped
        // (server/routers/services.ts). The twelve-times-more-valuable
        // program had the weaker control: nothing compared the referrer to
        // the applicant, so applying ten times naming yourself created ten
        // pending $300 claims — $3,000 — and the admin panel had no way to
        // show they were one person.
        //
        // Phone is the identity key, matching the $25 program: names are
        // trivially varied ("Bob" / "Robert" / "bob r"), a phone is not.
        // Same last-10-digits normalization, so "(216) 555-01 23",
        // "216-555-0123" and "+12165550123" all collapse together.
        const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
        const refPhone = last10(referral.referrerPhone);
        const candPhone = last10(candidate.phone);
        if (refPhone && refPhone === candPhone) {
          // No PII in this line. The $25 guard logs phone10 + full name on a
          // path any unauthenticated caller can trigger, and lint-pii cannot
          // see it (its template-literal rules only cover console.* and
          // new Error). Not repeating that here.
          log.warn(`[technicianReferrals] BLOCKED self-referral · candidate #${candidateId}`);
          return { success: false, selfReferral: true as const };
        }
        // Name equality is a weaker signal than phone, so it only fires when
        // the referrer gave NO phone at all — otherwise a genuine referral
        // between two people who share a common name would be refused.
        if (!refPhone) {
          const norm = (s: string | null | undefined) =>
            (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
          if (norm(referral.referrerName) && norm(referral.referrerName) === norm(candidate.name)) {
            log.warn(`[technicianReferrals] BLOCKED self-referral by name · candidate #${candidateId}`);
            return { success: false, selfReferral: true as const };
          }
        }

        // DEDUPE. There is no unique index on this table (0121 uses plain
        // KEYs), and the applicant can refresh-and-resubmit: two candidate
        // rows, two referral rows, two $300 claims for one hire. Scope the
        // check to this candidate so an employee who genuinely refers several
        // different people is unaffected.
        const existing = await db
          .select({ id: technicianReferrals.id })
          .from(technicianReferrals)
          .where(eq(technicianReferrals.candidateId, candidateId))
          .limit(1);
        if (existing.length > 0) {
          log.warn(
            `[technicianReferrals] duplicate suppressed · candidate #${candidateId} already has referral #${existing[0].id}`,
          );
          return { success: true, id: existing[0].id, duplicate: true as const };
        }
      }
    }
    const result = await db.insert(technicianReferrals).values({ ...referral, leadId, candidateId });
    return { success: true, id: Number(result[0].insertId) } as const;
  } catch (err) {
    if (isMissingTableError(err)) {
      // Migration 0121 not yet applied. The applicant's own lead row (with
      // the referrer's name preserved in its free-text notes) already saved
      // successfully — this is a missed tracking write, not a failed
      // application, so the caller must not surface this as an error.
      return { success: false, migrationPending: true as const };
    }
    throw err;
  }
}

/**
 * Candidates who SAID they were referred but have no structured referral row.
 *
 * THE INVARIANT THIS ENFORCES. technicianReferrals.submit is deliberately
 * soft-fail: it returns { success: false } rather than throwing, so a failed
 * referral write never breaks the applicant's own submission. That is the right
 * call for the applicant and the wrong place to stop for the shop — a lost
 * $300 obligation is currently invisible to the applicant, the referrer AND the
 * operator, surviving only as free text inside candidates.message.
 *
 * Careers.tsx folds "Referred by: <name> (<phone>)" into that message field
 * precisely as a hedge. This turns the hedge into a recoverable signal instead
 * of a note nobody reads: the correct rule is not "we attempted a referral
 * write" but "a candidate who names a referrer either HAS a structured referral
 * or produces a visible anomaly".
 *
 * Returns `available: false` on a dead handle rather than an empty list — an
 * empty orphan list is the one result an operator would most like to see, so
 * it is exactly the result that must never be fabricated.
 */
/**
 * A technician referral joined to the candidate it claims.
 *
 * `unlinked` is the load-bearing field: createTechnicianReferral NULLS
 * candidateId when the referenced row fails verification, and an orphan row
 * rendered identically to a linked one is a payout nobody can substantiate.
 */
export type TechnicianReferralRow = TechnicianReferral & {
  candidateName: string | null;
  candidatePhone: string | null;
  unlinked: boolean;
};

export async function getReferralOrphans() {
  const db = await getDb();
  if (!db) return { available: false as const, rows: [] as Array<{ id: number; name: string; createdAt: Date | null; referredBy: string }> };
  try {
    const rows = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        createdAt: candidates.createdAt,
        message: candidates.message,
      })
      .from(candidates)
      .where(
        and(
          sql`${candidates.message} LIKE '%Referred by:%'`,
          sql`NOT EXISTS (SELECT 1 FROM technician_referrals tr WHERE tr.candidateId = ${candidates.id})`,
        ),
      )
      .orderBy(desc(candidates.createdAt))
      .limit(200);

    return {
      available: true as const,
      rows: rows.map((r: { id: number; name: string; createdAt: Date | null; message: string | null }) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        // Surface just the referrer fragment, not the applicant's whole
        // free-text answer — the operator needs the name to reconcile, not
        // the candidate's personal statement.
        referredBy: (r.message ?? "").match(/Referred by:\s*(.+)/)?.[1]?.trim() ?? "(unparsed)",
      })),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { available: true as const, rows: [] as Array<{ id: number; name: string; createdAt: Date | null; referredBy: string }> };
    }
    throw err;
  }
}

import { slaBand, SLA_THRESHOLD_HOURS, type SlaBand } from "./candidateSla";

/**
 * Applicants aging against the 48-hour response the careers page promises.
 *
 * THE GAP THIS CLOSES. /careers states "We respond within 48 hours" twice
 * (Careers.tsx:259 and :588). Nothing enforced it: no cron references the
 * candidates table, no timer, no escalation, no aging sort. The only surface
 * was a collapsible admin panel someone had to remember to open. A public
 * promise with no mechanism behind it is how a shop loses a technician to
 * whoever called back.
 *
 * `contactedAt` is the clock stop, not `status`: an admin can move a candidate
 * through statuses without ever having contacted them, and the promise is
 * about contact.
 *
 * The 24h/40h bands are PROVISIONAL operating thresholds chosen to leave room
 * to act before the 48h promise is broken — they are not external truths, and
 * the right way to set them is from observed first-response times once there
 * are enough to measure.
 */
export async function getCandidateSlaBreaches() {
  const db = await getDb();
  type Row = { id: number; name: string; createdAt: Date | null; hoursWaiting: number | null; band: SlaBand };
  // available:false, never an empty list. "No one is waiting" is the single
  // most reassuring answer this can give, which makes it the one that must
  // never be fabricated from a dead handle.
  if (!db) return { available: false as const, rows: [] as Row[] };
  try {
    const rows = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        createdAt: candidates.createdAt,
        // The AGE is computed in SQL, not just the filter. Driver-parsed TiDB
        // DATETIMEs come back shifted +4h on Eastern, so `Date.now() -
        // row.createdAt.getTime()` overstates every wait by four hours — which
        // on 24/40/48 thresholds moves rows into a band they have not reached
        // and would have made this instrument cry breach at 44 real hours.
        hoursWaiting: sql<number | null>`TIMESTAMPDIFF(HOUR, ${candidates.createdAt}, NOW())`,
      })
      .from(candidates)
      .where(
        and(
          isNull(candidates.contactedAt),
          // `contactedAt IS NULL` is the real predicate; this list only drops
          // the TERMINAL states. Filtering `status = "new"` instead — as the
          // first cut of this did — contradicted the rule stated above: an
          // admin who moves an applicant straight to "interviewing" without
          // ever calling them would have silently emptied the alarm while the
          // person kept waiting. `updateStatus` stamps contactedAt whenever it
          // writes "contacted", so the surviving set is {new, interviewing}.
          inArray(candidates.status, [...CANDIDATE_SLA_OPEN_STATUSES]),
          // A honeypot-flagged row is saved for review, not owed a 48h reply.
          ne(candidates.source, CANDIDATE_SOURCE_HONEYPOT),
          // The 24 comes from SLA_THRESHOLD_HOURS.warning rather than a literal:
          // it was hard-coded here AND declared there, so raising the surfacing
          // threshold in one place would have left this query still returning
          // rows the banding no longer considers late. sql.raw because the value
          // is our own `as const` integer and drizzle would otherwise emit
          // `INTERVAL ? HOUR` as a bind parameter — this keeps the emitted SQL
          // byte-identical to what it was.
          sql`${candidates.createdAt} <= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(SLA_THRESHOLD_HOURS.warning))} HOUR)`,
        ),
      )
      .orderBy(candidates.createdAt)
      .limit(100);

    return {
      available: true as const,
      rows: rows.map((r: { id: number; name: string; createdAt: Date | null; hoursWaiting: number | null }) => {
        // NOT Number(r.hoursWaiting): TIMESTAMPDIFF returns NULL for a NULL
        // createdAt and `Number(null)` is 0, which would file the row under
        // "warning" — the calmest band — precisely when its age is unknown.
        // An unknown age is escalated, not reassured away.
        const hours = r.hoursWaiting == null ? null : Number(r.hoursWaiting);
        return {
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          hoursWaiting: hours,
          band: slaBand(hours),
        };
      }),
    };
  } catch (err) {
    // available:false, as for a dead handle above: with no table there is no
    // way to know who is waiting, and "no one is waiting" is the one answer
    // this must never fabricate.
    if (isMissingTableError(err)) return { available: false as const, rows: [] as Row[] };
    throw err;
  }
}

export async function getTechnicianReferrals() {
  const db = await getDb();
  // available:false, NOT an empty list. `!db` means the connection itself is
  // gone (no DATABASE_URL, or pool creation threw) — the read did not succeed,
  // so reporting `available: true, rows: []` fabricates a zero the admin panel
  // renders as "none recorded yet". Same convention adminSignals.ts already
  // uses: `available === false` marks a slice that failed rather than a slice
  // that is genuinely empty.
  if (!db) return { available: false as const, migrationPending: false as const, rows: [] as TechnicianReferralRow[] };
  try {
    // LEFT JOIN the candidate. The panel rendered the referrer and never who
    // was referred, so an operator could not answer the one question this
    // program exists to answer — "the shop could not reliably tell who
    // referred whom" is the reason drizzle/0121 was written at all, and the
    // record held the link while the UI kept it hidden.
    //
    // A LEFT join, not an inner one: createTechnicianReferral NULLS
    // candidateId when the referenced row fails verification (missing, or not
    // source:"careers"), and those orphans must stay visible and be visibly
    // DIFFERENT from linked ones rather than silently dropping out of the
    // list — they are the rows most likely to owe someone money incorrectly.
    const joined = await db
      .select({
        referral: technicianReferrals,
        candidateName: candidates.name,
        candidatePhone: candidates.phone,
      })
      .from(technicianReferrals)
      .leftJoin(candidates, eq(technicianReferrals.candidateId, candidates.id))
      .orderBy(desc(technicianReferrals.createdAt))
      .limit(500);

    const rows: TechnicianReferralRow[] = joined.map(
      (j: { referral: TechnicianReferral; candidateName: string | null; candidatePhone: string | null }) => ({
        ...j.referral,
        candidateName: j.candidateName,
        candidatePhone: j.candidatePhone,
        // TRUE when the referral claims an association the candidates table
        // cannot confirm — either it was nulled at write time, or the row has
        // since gone. Either way the payout is unverifiable.
        unlinked: j.referral.candidateId == null || j.candidateName == null,
      }),
    );
    return { available: true as const, migrationPending: false as const, rows };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { available: true as const, migrationPending: true as const, rows: [] as TechnicianReferralRow[] };
    }
    throw err;
  }
}

/** Single-row read for router-side gating (e.g. markPaid's 90-day check) — throws if the row doesn't exist. */
export async function getTechnicianReferralById(id: number): Promise<TechnicianReferral> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(technicianReferrals).where(eq(technicianReferrals.id, id)).limit(1);
  if (!row) throw new Error(`Technician referral #${id} not found`);
  return row;
}

/**
 * Update a referral's payout state — CONDITIONALLY.
 *
 * TWO DEFECTS THIS REPLACES, both of which cost money rather than accuracy.
 *
 * 1. It reported success for a write that matched nothing. `affectedRows` was
 *    discarded and `{ success: true }` returned unconditionally, so calling
 *    with a nonexistent id toasted "Updated." in the admin panel while the
 *    database was untouched. An operator marking a bonus paid had no way to
 *    learn it had not been.
 *
 * 2. No transition guard. The only status precondition lived in the UI
 *    (TechnicianReferralsPanel renders the buttons by status), so a stale tab
 *    — or any `leads.manage` holder, a tier that includes front_desk — could
 *    move a PAID referral back to `eligible` with a fresh 90-day clock while
 *    `paidAt` stayed set. That is a second $300 on one referral, and the audit
 *    row could not show it because these actions do not pass an actor.
 *
 * `expectStatus` makes the guard atomic: the status is part of the WHERE, so
 * two concurrent clicks cannot both observe `pending` and both proceed. A
 * caller that omits it is explicitly saying any state may transition.
 *
 * Returns `matched` so a caller can tell "not found or wrong state" from
 * "done", instead of both looking like success.
 */
export async function updateTechnicianReferralStatus(
  id: number,
  updates: {
    status?: "pending" | "eligible" | "paid" | "disqualified" | "forfeited";
    hiredAt?: Date;
    eligibleAt?: Date;
    paidAt?: Date;
    disqualifiedReason?: string;
  },
  opts: { expectStatus?: Array<"pending" | "eligible" | "paid" | "disqualified" | "forfeited"> } = {},
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const where = opts.expectStatus?.length
    ? and(
        eq(technicianReferrals.id, id),
        inArray(technicianReferrals.status, opts.expectStatus),
      )
    : eq(technicianReferrals.id, id);

  const res = await db.update(technicianReferrals).set(updates).where(where);
  // mysql2 returns ResultSetHeader; drizzle wraps it in a tuple.
  const matched = Number(
    (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0,
  );
  return { success: matched > 0, matched };
}

// ─── CANDIDATE QUERIES ─────────────────────────────────
//
// /careers job applicants — deliberately NOT the `leads` table. See the
// doc comment on `candidates` in drizzle/schema.ts for why this table
// exists at all. drizzle/0122_candidates.sql created it; applied to
// production 2026-09-09, and Careers.tsx's ApplicationForm submits through
// candidates.submit as of the same date. Same empty-vs-error discipline as
// technicianReferrals — the migrationPending path stays real defensive
// code for any environment where 0122 hasn't been applied yet (a fresh
// dev DB, for instance), not dead code from the cutover.

/**
 * Columns added by drizzle/0129_candidates_recruiting_funnel.sql. The DDL is
 * hand-applied, so for a window the code knows these and production may not.
 */
export const CANDIDATE_0129_COLUMNS = [
  "intent",
  "moveReasons",
  "phoneE164",
  "refCode",
  "gclid",
  "utmTerm",
  "utmContent",
  "nextFollowUpAt",
  "ownerAlertedAt",
] as const;


/**
 * INSERT naming ONLY the columns the table had before drizzle/0129. Used when
 * production has not had 0129 applied yet. Exported so a test can render the
 * exact SQL and prove no 0129 column appears in it.
 */
export function buildPre0129CandidateInsert(c: InsertCandidate) {
  return sql`INSERT INTO candidates (name, phone, email, positionTitle, experienceLevel, message, source, utmSource, utmMedium, utmCampaign, landingPage, referrer, sessionId) VALUES (${c.name}, ${c.phone}, ${c.email ?? null}, ${c.positionTitle ?? null}, ${c.experienceLevel ?? null}, ${c.message ?? null}, ${c.source ?? "careers"}, ${c.utmSource ?? null}, ${c.utmMedium ?? null}, ${c.utmCampaign ?? null}, ${c.landingPage ?? null}, ${c.referrer ?? null}, ${c.sessionId ?? null})`;
}

export async function createCandidate(candidate: InsertCandidate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(candidates).values(candidate);
    return { success: true, id: Number(result[0].insertId), columns0129: true } as const;
  } catch (err) {
    if (isMissingTableError(err)) {
      return { success: false, migrationPending: true as const };
    }
    // 0129 not applied yet: save the application with the pre-0129 columns
    // rather than lose it. The caller folds intent/move-reasons into
    // `message` too, so nothing the applicant said is dropped either way.
    if (isUnknownColumnError(err)) {
      // RAW SQL, deliberately. Drizzle's MySQL insert names EVERY column in
      // schema.ts (writing `default` for the ones not supplied), so retrying
      // through db.insert() with the 0129 keys removed still names them and
      // fails identically — measured in production 2026-09-23 01:20Z: every
      // careers application 500'd until this path stopped using drizzle.
      log.warn("[createCandidate] 0129 columns missing — saved with pre-0129 columns");
      const result = await db.execute(buildPre0129CandidateInsert(candidate));
      const header = (Array.isArray(result) ? result[0] : result) as { insertId?: number };
      return { success: true, id: Number(header.insertId), columns0129: false } as const;
    }
    throw err;
  }
}

/**
 * Pre-0129 projection — every column the table had before the recruiting
 * funnel DDL. A FUNCTION, not a module constant: a constant dereferences
 * `candidates` at import time, which breaks every test that mocks
 * ../drizzle/schema without that export (CI, 2026-09-23).
 */
const candidateBaseProjection = () => ({
  id: candidates.id,
  name: candidates.name,
  phone: candidates.phone,
  email: candidates.email,
  positionTitle: candidates.positionTitle,
  experienceLevel: candidates.experienceLevel,
  message: candidates.message,
  source: candidates.source,
  status: candidates.status,
  utmSource: candidates.utmSource,
  utmMedium: candidates.utmMedium,
  utmCampaign: candidates.utmCampaign,
  landingPage: candidates.landingPage,
  referrer: candidates.referrer,
  sessionId: candidates.sessionId,
  contactedAt: candidates.contactedAt,
  contactedBy: candidates.contactedBy,
  notes: candidates.notes,
  createdAt: candidates.createdAt,
  updatedAt: candidates.updatedAt,
});

const candidateFullProjection = () => ({
  ...candidateBaseProjection(),
  intent: candidates.intent,
  moveReasons: candidates.moveReasons,
  phoneE164: candidates.phoneE164,
  refCode: candidates.refCode,
  gclid: candidates.gclid,
  utmTerm: candidates.utmTerm,
  utmContent: candidates.utmContent,
  nextFollowUpAt: candidates.nextFollowUpAt,
  ownerAlertedAt: candidates.ownerAlertedAt,
});

/** Stamp the owner-alert time. A no-op (not an error) before 0129 is applied. */
export async function markCandidateOwnerAlerted(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(candidates).set({ ownerAlertedAt: new Date() }).where(eq(candidates.id, id));
  } catch (err) {
    if (isUnknownColumnError(err)) return;
    throw err;
  }
}

/**
 * Earlier rows with the same normalized phone — the duplicate-applicant check.
 * `available: false` when the lookup could not run, so a caller cannot mistake
 * "couldn't check" for "first time we've seen them" (the fabricated-read gate,
 * server/fabricatedAdminReadGate.test.ts, enforces this shape).
 */
export async function findCandidatesByPhoneE164(
  phoneE164: string,
  excludeId: number,
): Promise<{ available: boolean; rows: Array<{ id: number; createdAt: Date; status: string }> }> {
  const db = await getDb();
  if (!db) return { available: false, rows: [] };
  try {
    const rows = await db
      .select({ id: candidates.id, createdAt: candidates.createdAt, status: candidates.status })
      .from(candidates)
      .where(and(eq(candidates.phoneE164, phoneE164), sql`${candidates.id} <> ${excludeId}`))
      .orderBy(desc(candidates.createdAt))
      .limit(5);
    return { available: true, rows };
  } catch (err) {
    if (isUnknownColumnError(err) || isMissingTableError(err)) return { available: false, rows: [] };
    throw err;
  }
}

/**
 * The abuse brake on candidateIntake's sends. candidates.submit is a public
 * form that texts the operator from the store line and emails whatever
 * address was typed; its only other limit is 10 submissions/hour/IP. Counts
 * rows saved in the last 24 hours — not sends — excluding the row being
 * processed and honeypot rows. Read from the table, so it survives restarts.
 * Time math stays in SQL (NOW() - INTERVAL), per the TiDB timezone rule.
 * `available: false` = could not count; the caller decides which way to fail.
 */
export async function getCandidateSendBudget(input: {
  excludeId: number;
  email: string | null;
  phoneE164: string | null;
}): Promise<{ available: boolean; last24h: number; sameEmail24h: number; samePhone24h: number }> {
  const unavailable = { available: false, last24h: 0, sameEmail24h: 0, samePhone24h: 0 };
  const db = await getDb();
  if (!db) return unavailable;
  try {
    const [row] = await db
      .select({
        last24h: sql<number>`COUNT(*)`,
        sameEmail24h: sql<number>`COALESCE(SUM(${candidates.email} = ${input.email ?? ""}), 0)`,
        samePhone24h: sql<number>`COALESCE(SUM(${candidates.phoneE164} = ${input.phoneE164 ?? ""}), 0)`,
      })
      .from(candidates)
      .where(
        and(
          sql`${candidates.createdAt} >= NOW() - INTERVAL 24 HOUR`,
          ne(candidates.source, CANDIDATE_SOURCE_HONEYPOT),
          sql`${candidates.id} <> ${input.excludeId}`,
        ),
      );
    return {
      available: true,
      last24h: Number(row?.last24h ?? 0),
      sameEmail24h: Number(row?.sameEmail24h ?? 0),
      samePhone24h: Number(row?.samePhone24h ?? 0),
    };
  } catch (err) {
    if (isUnknownColumnError(err) || isMissingTableError(err)) return unavailable;
    throw err;
  }
}

export async function getCandidates() {
  const db = await getDb();
  // available:false, NOT an empty list. `!db` means the connection itself is
  // gone (no DATABASE_URL, or pool creation threw) — the read did not succeed,
  // so reporting `available: true, rows: []` fabricates a zero the admin panel
  // renders as "none recorded yet". Same convention adminSignals.ts already
  // uses: `available === false` marks a slice that failed rather than a slice
  // that is genuinely empty.
  if (!db) return { available: false as const, migrationPending: false as const, rows: [] as Candidate[] };
  try {
    // Named columns, never a bare select(): adding 0129 to schema.ts would
    // otherwise make this read name columns production may not have yet.
    try {
      const rows = (await db
        .select(candidateFullProjection())
        .from(candidates)
        .orderBy(desc(candidates.createdAt))
        .limit(500)) as Candidate[];
      return { available: true as const, migrationPending: false as const, rows };
    } catch (err) {
      if (!isUnknownColumnError(err)) throw err;
      const rows = (await db
        .select(candidateBaseProjection())
        .from(candidates)
        .orderBy(desc(candidates.createdAt))
        .limit(500)) as Candidate[];
      return { available: true as const, migrationPending: false as const, rows };
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      return { available: true as const, migrationPending: true as const, rows: [] as Candidate[] };
    }
    throw err;
  }
}

export async function updateCandidateStatus(
  id: number,
  updates: {
    status?: CandidateStatus;
    contactedAt?: Date;
    contactedBy?: string;
    notes?: string;
    /**
     * The follow-up clock (shared/candidateLifecycle.ts followUpDaysFor):
     * a day count schedules nextFollowUpAt that many days from NOW(), null
     * clears it, undefined leaves it alone. Computed in SQL on purpose: the
     * due-list compares against NOW(), and a JS Date written through the
     * driver lands shifted (the +4h Eastern skew getCandidateSlaBreaches
     * documents), so both sides must use the database's own clock.
     */
    followUpInDays?: number | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { contactedAt, followUpInDays, ...rest } = updates;
  const base = {
    ...rest,
    // First contact is a fact about the past: keep the earliest stamp.
    // Moving a candidate from "contacted" to "offer" must not reset the
    // time-to-first-contact metric to today.
    ...(contactedAt
      ? { contactedAt: sql`COALESCE(${candidates.contactedAt}, ${sql.param(contactedAt, candidates.contactedAt)})` }
      : {}),
  };
  const followUp =
    followUpInDays === undefined
      ? {}
      : {
          nextFollowUpAt:
            followUpInDays === null
              ? null
              : sql`DATE_ADD(NOW(), INTERVAL ${sql.raw(String(Math.trunc(followUpInDays)))} DAY)`,
        };
  try {
    await db
      .update(candidates)
      .set({ ...base, ...followUp })
      .where(eq(candidates.id, id));
  } catch (err) {
    // 0129 not applied: the status change is the operator's real action and
    // must still land; only the follow-up clock is lost, and we say so.
    if (followUpInDays === undefined || !isUnknownColumnError(err)) throw err;
    log.warn("[updateCandidateStatus] nextFollowUpAt missing (0129 pending) — status saved without follow-up");
    await db.update(candidates).set(base).where(eq(candidates.id, id));
    return { success: true, followUpSaved: false as const };
  }
  return { success: true, followUpSaved: followUpInDays !== undefined };
}

/**
 * Candidates whose follow-up date has arrived — the CONSUMER of
 * nextFollowUpAt. Surfaced in the admin Candidates panel; nothing sends.
 *
 * available:false, never an empty list, when the read cannot happen (no DB,
 * no table, or 0129's column missing): "nobody is due" is the reassuring
 * answer, and a dead read must not fabricate it. Never returns a status in
 * CANDIDATE_FOLLOW_UP_NEVER even if an old row still carries a date, and
 * never a honeypot row.
 */
export async function getCandidateFollowUpsDue() {
  const db = await getDb();
  type Row = {
    id: number;
    name: string;
    phone: string;
    status: string;
    intent: string | null;
    positionTitle: string | null;
    daysOverdue: number | null;
  };
  if (!db) return { available: false as const, reason: "db_unavailable" as const, rows: [] as Row[] };
  try {
    const rows = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        phone: candidates.phone,
        status: candidates.status,
        intent: candidates.intent,
        positionTitle: candidates.positionTitle,
        // Age in SQL against the same NOW() the writer used (see above).
        daysOverdue: sql<number | null>`TIMESTAMPDIFF(DAY, ${candidates.nextFollowUpAt}, NOW())`,
      })
      .from(candidates)
      .where(
        and(
          sql`${candidates.nextFollowUpAt} IS NOT NULL`,
          sql`${candidates.nextFollowUpAt} <= NOW()`,
          notInArray(candidates.status, [...CANDIDATE_FOLLOW_UP_NEVER]),
          ne(candidates.source, CANDIDATE_SOURCE_HONEYPOT),
        ),
      )
      .orderBy(candidates.nextFollowUpAt)
      .limit(100);
    return {
      available: true as const,
      reason: null,
      rows: (rows as Row[]).map((r) => ({
        ...r,
        daysOverdue: r.daysOverdue == null ? null : Number(r.daysOverdue),
      })),
    };
  } catch (err) {
    if (isMissingTableError(err)) return { available: false as const, reason: "table_missing" as const, rows: [] as Row[] };
    if (isUnknownColumnError(err)) return { available: false as const, reason: "migration_0129_pending" as const, rows: [] as Row[] };
    throw err;
  }
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
  return db.select().from(mechanicQA).orderBy(desc(mechanicQA.createdAt)).limit(200);
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

/**
 * 2026-09-01 · a notification that never went out must not sit `pending`
 * forever (audit F-1). `failed` is already in the status enum and is what the
 * admin's retry button re-queues from.
 */
export async function markNotificationFailed(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customerNotifications).set({ status: "failed" })
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
  inspectionItems, InsertInspectionItem, InspectionItem,
  loyaltyRewards, InsertLoyaltyReward,
  loyaltyTransactions,
  reviewRequests, InsertReviewRequest,
  reviewSettings,
} from "../drizzle/schema";
import {
  normalizeMeasurements,
  normalizePhotoUrls,
  type InspectionMeasurement,
} from "@shared/inspectionMeasurements";

export async function createCallbackRequest(data: InsertCallbackRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(callbackRequests).values(data);
  return { success: true, id: Number(result[0].insertId) };
}

export async function getCallbackRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt)).limit(500);
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

/**
 * Migration 0143 adds seven columns to inspection_items (measurements, the
 * photo list, post-work verification). The DDL is applied by hand, so this
 * code runs against databases on BOTH sides of it. A bare `select()` names
 * every column schema.ts declares and would 500 on a pre-0143 database
 * (.claude/skills/nickstire-tidb-ddl), so the item read retries with the
 * pre-0143 column set when the database reports an unknown column.
 *
 * Built on demand, not at import: five test files mock `../drizzle/schema`
 * with a partial factory, and a module-level `inspectionItems.id` would throw
 * on import in every one of them (the rest of this file only touches schema
 * tables inside functions, for the same reason).
 */
function inspectionItemPre0143Columns() {
  return {
    id: inspectionItems.id,
    inspectionId: inspectionItems.inspectionId,
    component: inspectionItems.component,
    category: inspectionItems.category,
    condition: inspectionItems.condition,
    notes: inspectionItems.notes,
    photoUrl: inspectionItems.photoUrl,
    recommendedAction: inspectionItems.recommendedAction,
    estimatedCost: inspectionItems.estimatedCost,
    decision: inspectionItems.decision,
    decisionAt: inspectionItems.decisionAt,
    customerNote: inspectionItems.customerNote,
    sortOrder: inspectionItems.sortOrder,
    createdAt: inspectionItems.createdAt,
  };
}

const NO_0143_COLUMNS = {
  measurementsJson: null,
  photoUrlsJson: null,
  verifiedAt: null,
  verifiedBy: null,
  verificationNote: null,
  verificationPhotoUrlsJson: null,
  verificationMeasurementsJson: null,
} as const;

interface InspectionItemVerification {
  verifiedAt: Date;
  verifiedBy: string | null;
  note: string | null;
  /** AFTER photos — the repair as done. */
  photoUrls: string[];
  /** AFTER measurements — e.g. new pads at 11 mm against the 3 mm found. */
  measurements: InspectionMeasurement[];
}

/** What the API returns for an item: the row plus the decoded 0143 fields. */
type InspectionItemView = InspectionItem & {
  measurements: InspectionMeasurement[];
  photoUrls: string[];
  verification: InspectionItemVerification | null;
};

/** Pure; exported for tests. Decodes the JSON columns tolerantly — a row written before 0143 renders as "no measurements", never as a crash. */
export function viewInspectionItem(row: InspectionItem): InspectionItemView {
  const rawVerifiedAt = row.verifiedAt as unknown;
  const verifiedAt =
    rawVerifiedAt instanceof Date ? rawVerifiedAt
    : typeof rawVerifiedAt === "string" && rawVerifiedAt ? new Date(rawVerifiedAt)
    : null;
  return {
    ...row,
    measurements: normalizeMeasurements(row.measurementsJson),
    photoUrls: normalizePhotoUrls(row.photoUrl, row.photoUrlsJson),
    verification:
      verifiedAt && !Number.isNaN(verifiedAt.getTime())
        ? {
            verifiedAt,
            verifiedBy: row.verifiedBy ?? null,
            note: row.verificationNote ?? null,
            photoUrls: normalizePhotoUrls(null, row.verificationPhotoUrlsJson),
            measurements: normalizeMeasurements(row.verificationMeasurementsJson),
          }
        : null,
  };
}

async function selectInspectionItems(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  inspectionId: number,
): Promise<InspectionItemView[]> {
  try {
    const rows = await db.select().from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, inspectionId))
      .orderBy(inspectionItems.sortOrder);
    return rows.map(viewInspectionItem);
  } catch (err) {
    if (!isUnknownColumnError(err)) throw err;
    const rows = await db.select(inspectionItemPre0143Columns()).from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, inspectionId))
      .orderBy(inspectionItems.sortOrder);
    return rows.map((r: Record<string, unknown>) => viewInspectionItem({ ...r, ...NO_0143_COLUMNS } as unknown as InspectionItem));
  }
}

export async function getInspection(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [inspection] = await db.select().from(vehicleInspections).where(eq(vehicleInspections.id, id)).limit(1);
  if (!inspection) return null;
  const items = await selectInspectionItems(db, id);
  return { ...inspection, items };
}

export async function getInspectionByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const [inspection] = await db.select().from(vehicleInspections)
    .where(and(eq(vehicleInspections.shareToken, token), eq(vehicleInspections.isPublished, 1)))
    .limit(1);
  if (!inspection) return null;
  const items = await selectInspectionItems(db, inspection.id);
  return { ...inspection, items };
}

export async function getInspections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vehicleInspections).orderBy(desc(vehicleInspections.createdAt)).limit(500);
}

/**
 * DVI view tracking (0101). Token-gated + published-only — the token IS
 * the auth. Sets firstViewedAt once, bumps viewCount every open.
 * Fail-soft: a missing 0101 column must never break the report page.
 */
export async function recordInspectionView(token: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    await db.execute(sql`
      UPDATE vehicle_inspections
      SET viewCount = viewCount + 1,
          firstViewedAt = COALESCE(firstViewedAt, NOW())
      WHERE shareToken = ${token} AND isPublished = 1
    `);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * DVI per-item customer decision (0101). The item must belong to the
 * published inspection the token unlocks — the join is the authorization.
 * Decisions are re-decidable (customers change their minds); decisionAt
 * always reflects the latest. customerNote stores THEIR words verbatim.
 */
export async function decideInspectionItem(params: {
  token: string;
  itemId: number;
  decision: "approved" | "declined" | "question";
  note?: string | null;
  /** The price the customer's page showed next to the item, in whole dollars. */
  shownCost?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };
  try {
    const result = await db.execute(sql`
      UPDATE inspection_items i
      INNER JOIN vehicle_inspections v ON v.id = i.inspectionId
      SET i.decision = ${params.decision},
          i.decisionAt = NOW(),
          i.customerNote = ${params.note ? params.note.slice(0, 500) : null}
      WHERE i.id = ${params.itemId}
        AND v.shareToken = ${params.token}
        AND v.isPublished = 1
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) return { ok: false, error: "item not found for this report" };

    // Q-46 (2026-09-29): the UPDATE above overwrites the previous answer and
    // records no amount, while estimatedCost stays editable afterwards. One
    // append-only receipt per decision keeps who, when and how much.
    await recordInspectionDecisionReceipt(db, params);

    // 2026-09-01 (audit F-23): the customer's answer was written and nobody
    // was told — the advisor learned of an approval only by re-opening the
    // report. Notify the admin shell (SSE) and the owner channel (Telegram).
    // Fire-and-forget: a notification miss must never undo a recorded decision.
    void notifyInspectionDecision(db, params.itemId, params.decision, params.note ?? null, params.shownCost ?? null).catch((err) => {
      log.warn("[inspection] decision notification failed (decision is saved)", {
        itemId: params.itemId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "decision failed" };
  }
}

/**
 * One audit_log row per customer decision on an inspection item (Q-46). The
 * item row keeps only the latest answer; this keeps every answer, the amount
 * stored when it was given (whole dollars, as InspectionCapturePanel enters
 * it) and the amount the customer's page showed. Never throws: a receipt
 * failure is logged and the decision stands.
 */
async function recordInspectionDecisionReceipt(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  params: {
    itemId: number;
    decision: "approved" | "declined" | "question";
    note?: string | null;
    shownCost?: number | null;
  },
): Promise<void> {
  try {
    const [rows] = await db.execute(sql`
      SELECT v.id AS inspectionId, i.component, i.recommendedAction, i.estimatedCost,
             UNIX_TIMESTAMP(i.decisionAt) AS decidedAtEpoch
      FROM inspection_items i
      INNER JOIN vehicle_inspections v ON v.id = i.inspectionId
      WHERE i.id = ${params.itemId}
      LIMIT 1
    `);
    const row = (Array.isArray(rows) ? rows[0] : undefined) as
      | { inspectionId: number; component: string | null; recommendedAction: string | null; estimatedCost: number | null; decidedAtEpoch: unknown }
      | undefined;
    const amount = row?.estimatedCost ?? null;
    // The page shows no price for a 0 or missing estimate, so 0 is "no price shown".
    const shown = params.shownCost != null && params.shownCost > 0 ? params.shownCost : null;
    // A number, not a date string: the ledger's free-text scrubber reads
    // "2026-09-29 17:30:00" as a phone number and masks it.
    const epochSeconds = Number(row?.decidedAtEpoch);
    const decidedAtEpochMs = Number.isFinite(epochSeconds) && epochSeconds > 0 ? epochSeconds * 1000 : Date.now();
    const { recordActivity } = await import("./services/activityLedger");
    await recordActivity({
      action: "inspection.item_decided",
      entityType: "inspection_item",
      entityId: params.itemId,
      actor: { actor: `inspection-link:${row?.inspectionId ?? "unknown"}`, actorType: "public" },
      after: {
        inspectionId: row?.inspectionId ?? null,
        component: row?.component ?? null,
        recommendedAction: row?.recommendedAction ?? null,
        decision: params.decision,
        channel: "inspection_link",
        amountDollars: amount,
        amountShownDollars: shown,
        // null = unknown (the page sent no price), never a silent "matches".
        amountMatchesShown: amount != null && shown != null ? amount === shown : null,
        customerNote: params.note ? params.note.slice(0, 500) : null,
        decidedAtEpochMs,
      },
      details: `customer ${params.decision} inspection item ${params.itemId} via share link` +
        (amount != null ? ` at $${amount}` : ""),
    });
  } catch (err) {
    log.error("[inspection] decision receipt failed (decision is saved)", {
      itemId: params.itemId,
      err: describeDbError(err),
    });
  }
}

async function notifyInspectionDecision(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  itemId: number,
  decision: "approved" | "declined" | "question",
  note: string | null,
  shownCost: number | null = null,
): Promise<void> {
  const [ctxRows] = await db.execute(sql`
    SELECT v.id AS inspectionId, v.customerName, v.vehicleInfo, i.component, i.recommendedAction, i.estimatedCost
    FROM inspection_items i
    INNER JOIN vehicle_inspections v ON v.id = i.inspectionId
    WHERE i.id = ${itemId}
    LIMIT 1
  `);
  const row = (Array.isArray(ctxRows) ? ctxRows[0] : undefined) as
    | { inspectionId: number; customerName: string | null; vehicleInfo: string | null; component: string | null; recommendedAction: string | null; estimatedCost: number | null }
    | undefined;
  if (!row) return;

  const { emitToAdmin } = await import("./services/realtime");
  emitToAdmin("inspection_decided", {
    inspectionId: row.inspectionId,
    itemId,
    decision,
    component: row.component,
    customerName: row.customerName,
    vehicleInfo: row.vehicleInfo,
    estimatedCost: row.estimatedCost,
    timestamp: Date.now(),
  });

  const label = decision === "approved" ? "APPROVED" : decision === "declined" ? "declined" : "has a QUESTION about";
  // estimatedCost is whole dollars (the admin types "Est. $", the customer
  // page renders it unscaled). It was divided by 100 here, so a $450 approval
  // reached the owner as "~$5".
  const cost = row.estimatedCost != null ? ` (~$${row.estimatedCost})` : "";
  // The shop can edit the estimate after the page loads; say so when the
  // customer answered a different price than the row now holds.
  const priceChanged = decision === "approved" && shownCost != null && shownCost > 0 &&
    row.estimatedCost != null && shownCost !== row.estimatedCost
    ? `\n⚠️ Their page showed ~$${shownCost}; the estimate now reads ~$${row.estimatedCost}. Confirm the price with them.`
    : "";
  const { sendTelegram } = await import("./services/telegram");
  await sendTelegram(
    `🔧 DVI decision: ${row.customerName ?? "Customer"} ${label} "${row.component ?? "item"}"${cost}` +
    (row.vehicleInfo ? ` · ${row.vehicleInfo}` : "") +
    (note ? `\nNote: ${note.slice(0, 200)}` : "") +
    priceChanged +
    `\nInspection #${row.inspectionId} · open the admin → Customers`,
  );
}

/** Admin write shape for an item: the row fields plus the 0143 lists, typed. */
type InspectionItemWrite = Omit<InsertInspectionItem, "measurementsJson" | "photoUrlsJson"> & {
  measurements?: InspectionMeasurement[];
  photoUrls?: string[];
};

/**
 * Pure; exported for tests. The 0143 keys are attached ONLY when the caller
 * supplied them, so every pre-0143 call site emits byte-identical SQL (the
 * rule in .claude/skills/nickstire-tidb-ddl). The first photo is mirrored into
 * photoUrl so readers that predate photoUrlsJson (the customer page before
 * this change, the opportunity queue's evidence class) still see a photo.
 */
export function buildInspectionItemValues(input: Partial<InspectionItemWrite>): Partial<InsertInspectionItem> {
  const { measurements, photoUrls, ...rest } = input;
  const values: Partial<InsertInspectionItem> = { ...rest };
  if (photoUrls && photoUrls.length > 0) {
    values.photoUrlsJson = photoUrls;
    if (!values.photoUrl) values.photoUrl = photoUrls[0];
  }
  if (measurements && measurements.length > 0) values.measurementsJson = measurements;
  return values;
}

type InspectionWriteDegradation = "measurements_unavailable";

function uses0143Columns(values: Partial<InsertInspectionItem>): boolean {
  return "measurementsJson" in values || "photoUrlsJson" in values;
}

function without0143Columns(values: Partial<InsertInspectionItem>): Partial<InsertInspectionItem> {
  const { measurementsJson: _m, photoUrlsJson: _p, ...legacy } = values;
  return legacy;
}

export async function addInspectionItem(data: InspectionItemWrite) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = buildInspectionItemValues(data) as InsertInspectionItem;
  try {
    const result = await db.insert(inspectionItems).values(values);
    return { success: true, id: Number(result[0].insertId), degraded: null as InspectionWriteDegradation | null };
  } catch (err) {
    // Pre-0143 database: keep the finding, drop only what the table cannot
    // hold yet, and SAY so — the panel tells the tech the numbers were not stored.
    if (!isUnknownColumnError(err) || !uses0143Columns(values)) throw err;
    const result = await db.insert(inspectionItems).values(without0143Columns(values) as InsertInspectionItem);
    return { success: true, id: Number(result[0].insertId), degraded: "measurements_unavailable" as InspectionWriteDegradation | null };
  }
}

export async function updateInspectionItem(id: number, data: Partial<InspectionItemWrite>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = buildInspectionItemValues(data);
  try {
    await db.update(inspectionItems).set(values).where(eq(inspectionItems.id, id));
    return { success: true, degraded: null as InspectionWriteDegradation | null };
  } catch (err) {
    if (!isUnknownColumnError(err) || !uses0143Columns(values)) throw err;
    const legacy = without0143Columns(values);
    if (Object.keys(legacy).length > 0) await db.update(inspectionItems).set(legacy).where(eq(inspectionItems.id, id));
    return { success: true, degraded: "measurements_unavailable" as InspectionWriteDegradation | null };
  }
}

/**
 * Post-work verification (0143): the technician records the AFTER evidence
 * once the approved repair is done. Verification IS the new columns, so it
 * cannot degrade — on a pre-0143 database it reports exactly what is missing
 * instead of pretending the work was recorded.
 */
export async function verifyInspectionItem(input: {
  id: number;
  verifiedBy: string;
  note?: string | null;
  photoUrls?: string[];
  measurements?: InspectionMeasurement[];
}): Promise<{ success: true } | { success: false; reason: "not_found" | "migration_0143_not_applied" }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ id: inspectionItems.id }).from(inspectionItems).where(eq(inspectionItems.id, input.id)).limit(1);
  if (!existing) return { success: false, reason: "not_found" };
  try {
    await db.update(inspectionItems).set({
      verifiedAt: new Date(),
      verifiedBy: input.verifiedBy,
      verificationNote: input.note ?? null,
      verificationPhotoUrlsJson: input.photoUrls && input.photoUrls.length > 0 ? input.photoUrls : null,
      verificationMeasurementsJson: input.measurements && input.measurements.length > 0 ? input.measurements : null,
    }).where(eq(inspectionItems.id, input.id));
    return { success: true };
  } catch (err) {
    if (isUnknownColumnError(err)) return { success: false, reason: "migration_0143_not_applied" };
    throw err;
  }
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
  // forensic-audit HIGH · was a read-modify-write with no atomicity — two
  // concurrent awards lost updates, and a crash between the balance write
  // and the ledger insert desynced them. Atomic increment + ledger in one
  // transaction; balanceAfter is re-read inside the tx so the ledger is exact.
  let newBalance = 0;
  await db.transaction(async (tx: any) => {
    const [res] = await tx.execute(sql`
      UPDATE users SET loyaltyPoints = loyaltyPoints + ${points} WHERE id = ${userId}
    `);
    if (((res as { affectedRows?: number }).affectedRows ?? 0) === 0) {
      throw new Error("User not found");
    }
    const [u] = await tx.select({ loyaltyPoints: users.loyaltyPoints }).from(users).where(eq(users.id, userId)).limit(1);
    newBalance = u?.loyaltyPoints ?? 0;
    await tx.insert(loyaltyTransactions).values({
      userId,
      type: "earn",
      points,
      balanceAfter: newBalance,
      description,
      serviceHistoryId: serviceHistoryId || null,
    });
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
  // forensic-audit HIGH · was read-check-write with no guard — a double-tap
  // on the PWA let two redeems both pass the balance check and both deduct,
  // double-spending points against one balance. Atomic conditional deduct
  // (WHERE loyaltyPoints >= cost + affectedRows check is the claim) plus the
  // ledger insert, in one transaction.
  let newBalance = 0;
  await db.transaction(async (tx: any) => {
    const [res] = await tx.execute(sql`
      UPDATE users SET loyaltyPoints = loyaltyPoints - ${reward.pointsCost}
      WHERE id = ${userId} AND loyaltyPoints >= ${reward.pointsCost}
    `);
    if (((res as { affectedRows?: number }).affectedRows ?? 0) === 0) {
      // 0 rows = user missing OR insufficient/already-spent balance.
      throw new Error("Not enough points");
    }
    const [u] = await tx.select({ loyaltyPoints: users.loyaltyPoints }).from(users).where(eq(users.id, userId)).limit(1);
    newBalance = u?.loyaltyPoints ?? 0;
    await tx.insert(loyaltyTransactions).values({
      userId,
      type: "redeem",
      points: -reward.pointsCost,
      balanceAfter: newBalance,
      description: `Redeemed: ${reward.title}`,
      rewardId,
    });
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

import { ne, isNull, lt, gt, or, count as drizzleCount } from "drizzle-orm";

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
 *
 * ROS-083 · throws rather than returning []. This list is not decoration: the
 * Process Queue confirm dialog derives "~N due now" by filtering it client
 * side, and that number is the operator's only sanity check before firing a
 * batch of real outbound SMS. An [] here rendered "~0 due now" — a measurement
 * that was never taken, presented as a reassuring one.
 */
export async function getReviewRequests(limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — review requests are unknown, not empty.");
  return db.select().from(reviewRequests)
    .orderBy(desc(reviewRequests.createdAt))
    .limit(limit);
}

/**
 * Get review requests that are pending and past their scheduled time.
 *
 * ROS-083 · throws rather than returning []. This is the cron's read, and an []
 * made an unreadable database indistinguishable from a genuinely drained queue:
 * processReviewRequestQueue returned { processed: 0, sent: 0, failed: 0 } and
 * the scheduler logged the run as `completed`. The throw is safe because it
 * happens BEFORE the send loop and before any row is claimed, and the cron
 * wrapper in cron/jobs/reviewRequests.ts already catches and log.errors — so
 * the outage becomes a loud failed run instead of a quiet successful one.
 */
export async function getPendingReviewRequests() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — the pending review queue is unknown, not empty.");
  return db.select().from(reviewRequests)
    .where(and(
      eq(reviewRequests.status, "pending"),
      lte(reviewRequests.scheduledAt, new Date()),
    ))
    .orderBy(reviewRequests.scheduledAt)
    .limit(50);
}

/**
 * forensic-audit HIGH · atomic pre-send claim. Flips pending→sent up front so
 * overlapping scheduler runs (or a crash/deploy between send and mark) can't
 * re-send the same review-request SMS to a customer. Only the caller that
 * gets affectedRows>0 owns the row and should actually send.
 */
export async function claimReviewRequest(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const updateResult = await db.update(reviewRequests)
    .set({ status: "sent", sentAt: new Date() })
    .where(and(eq(reviewRequests.id, id), eq(reviewRequests.status, "pending")));
  return ((updateResult[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0) > 0;
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
 * Mark a review request as an experiment control. This is terminal for the
 * queue but is explicitly NOT a send: clear sentAt/twilioSid so the dashboard
 * and daily send cap cannot mistake a withheld contact for delivery.
 */
export async function markReviewRequestHeldOut(id: number, experimentId?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reviewRequests).set({
    status: "heldout",
    sentAt: null,
    twilioSid: null,
    errorMessage: experimentId ? `experiment_control:${experimentId}` : "experiment_control",
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
  // Cooldown counts a row if EITHER it was created OR actually sent
  // within the window. Keying on createdAt alone missed the case where a
  // request was enqueued long ago but only sent recently (daily-cap lag),
  // which could let a second review SMS go out too soon after the first.
  // sentAt is NULL on pending rows, so they still block via createdAt.
  const results = await db.select({ id: reviewRequests.id }).from(reviewRequests)
    .where(and(
      eq(reviewRequests.phone, phone),
      ne(reviewRequests.status, "failed"),
      or(
        gte(reviewRequests.createdAt, cutoff),
        gte(reviewRequests.sentAt, cutoff),
      ),
    ))
    .limit(1);
  return results.length > 0;
}

/**
 * Count how many review requests were sent today.
 */
export async function getReviewRequestsSentToday() {
  const db = await getDb();
  // ROS-084 · this number is the daily-cap DENOMINATOR, read at
  // routers/reviewRequests.ts:160 and compared against settings.maxPerDay on the
  // very next line. A fabricated 0 does not mean "no sends yet" — it means the
  // cap cannot fire at all, on the one path that texts customers. Unknown must
  // stop the run, not license it.
  if (!db) throw new Error("Database unavailable — review sends so far today are unknown, not zero; the daily cap cannot be evaluated.");
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
  // ROS-083 · a zeroed stat block reads as "nothing failed, nothing pending",
  // which is a claim about the outreach programme, not a fact about the read.
  if (!db) throw new Error("Database unavailable — review request stats are unknown, not zero.");
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests);
  const [sent] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "sent"));
  const [clicked] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "clicked"));
  const [heldOut] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "heldout"));
  const [failed] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "failed"));
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(eq(reviewRequests.status, "pending"));
  const sentCount = (sent?.count ?? 0) + (clicked?.count ?? 0);
  const clickedCount = clicked?.count ?? 0;
  return {
    total: total?.count ?? 0,
    sent: sentCount,
    clicked: clickedCount,
    heldOut: heldOut?.count ?? 0,
    failed: failed?.count ?? 0,
    pending: pending?.count ?? 0,
    clickRate: sentCount > 0 ? Math.round((clickedCount / sentCount) * 100) : 0,
  };
}

// ─── REVIEW SETTINGS QUERIES ─────────────────────────

/**
 * Get review settings (single-row, id=1). Creates defaults if not exists.
 *
 * wave-181.23 · bumped default delayMinutes from 120 (2h) to 1440 (24h).
 * Industry data on auto-shop review-request timing:
 *   · 2h post-service: customer often still in transit, no time to
 *     verify the fix actually held → lower 5★ rate, higher 1★ rate
 *   · 24h post-service: customer has driven on the repair, knows it
 *     stuck → highest 5★ conversion rate
 *   · 72h+: forgetting curve kicks in, lower response rate overall
 * Operators can still customize via Admin → Reviews → Settings.
 * Existing prod rows keep their current value; only new installs
 * (and the DB-unavailable fallback) get the 24h default.
 */
export async function getReviewSettings() {
  const db = await getDb();
  // ROS-084 · this used to invent `enabled: 1` on an unreadable database. That
  // is not a neutral default — it is the operator's OFF SWITCH, and every gate
  // on the send path reads it (scheduleReviewRequest:69,
  // processReviewRequestQueue:144). A shop that had deliberately turned review
  // texts off had them turned back on for the duration of any outage, by a
  // literal in this file.
  //
  // isPhoneOnReviewCooldown, twelve lines up on the same path, already answers
  // this question the right way: `if (!db) return true; // Fail safe: don't send
  // if DB is down`. Two reads, same outage, opposite directions — this one now
  // matches the one that was right.
  if (!db) throw new Error("Database unavailable — review settings are unknown, not the defaults; whether review texts are enabled cannot be determined.");
  const [existing] = await db.select().from(reviewSettings).limit(1);
  if (existing) return existing;
  // Create defaults. This branch has a LIVE database — bootstrapping a fresh
  // install is a real, intended write, and the throw above does not touch it.
  await db.insert(reviewSettings).values({ enabled: 1, delayMinutes: 1440, maxPerDay: 20, cooldownDays: 30 });
  const [created] = await db.select().from(reviewSettings).limit(1);
  // An insert that reports success followed by a read that returns nothing is a
  // broken database, not an empty one. Handing back the same invented row would
  // reproduce the defect one layer in — and worse, it would look like a
  // successful bootstrap.
  if (!created) throw new Error("Review settings row could not be read back after insert — settings are unknown, not defaults.");
  return created;
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
  // ROS-084 follow-up · an empty eligibility list is not a neutral value here.
  // The Backfill tab renders `count > 0 ? <Send to N Customers> : <green
  // CheckCircle2 + "All eligible customers have already been contacted">`, so
  // returning [] painted a green checkmark asserting that every customer served
  // in the past year has already been asked for a review — from a database
  // nobody read. Unknown is not "all done".
  if (!db) throw new Error("Database unavailable — backfill eligibility is unknown, not empty; no conclusion can be drawn about who has already been asked.");
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
  smsConversations, InsertSmsConversation, SmsConversation,
  smsMessages, InsertSmsMessage,
  repairGallery, InsertRepairGalleryItem,
  technicians, InsertTechnician,
  customers,
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
  const now = new Date();
  const [stats] = await db.select({
    total: sql<number>`count(*)`,
    scheduled: sql<number>`sum(case when ${serviceReminders.status} = 'scheduled' then 1 else 0 end)`,
    sent: sql<number>`sum(case when ${serviceReminders.status} = 'sent' then 1 else 0 end)`,
    snoozed: sql<number>`sum(case when ${serviceReminders.status} = 'snoozed' then 1 else 0 end)`,
    dueNow: sql<number>`sum(case when ${serviceReminders.status} = 'scheduled' and ${serviceReminders.nextDueDate} <= ${now} then 1 else 0 end)`,
  }).from(serviceReminders);
  return {
    total: stats?.total ?? 0,
    scheduled: stats?.scheduled ?? 0,
    sent: stats?.sent ?? 0,
    snoozed: stats?.snoozed ?? 0,
    dueNow: stats?.dueNow ?? 0,
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

/**
 * True if an smsMessages row already exists for this gateway message id
 * (the twilioSid column stores it for inbound + outbound alike). The
 * inbound SMS webhook handlers call this to drop at-least-once
 * redeliveries before processing — without it, a redelivered inbound
 * text re-runs executeAutoAction, which for the auto-price-response
 * intent sends the customer a second price text and creates a second
 * leads row.
 */
export async function smsMessageExists(twilioSid: string): Promise<boolean> {
  if (!twilioSid) return false;
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: smsMessages.id })
    .from(smsMessages)
    .where(eq(smsMessages.twilioSid, twilioSid))
    .limit(1);
  return rows.length > 0;
}

/**
 * Rank-3 dedup (wave-2026-06) — the Capevace relay is at-least-once and CAN
 * redeliver an inbound with a NEW messageId, which smsMessageExists() (keyed on
 * twilioSid) misses. True if an identical inbound (same conversation + body)
 * already landed in the last 5 min. The webhook still RECORDS the message
 * (never drops a real reply); it only skips re-firing executeAutoAction so a
 * redelivery can't send a duplicate auto-reply or create a duplicate lead.
 */
export async function recentInboundExists(conversationId: number, body: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: smsMessages.id })
    .from(smsMessages)
    .where(sql`${smsMessages.conversationId} = ${conversationId} AND ${smsMessages.direction} = 'inbound' AND ${smsMessages.body} = ${body} AND ${smsMessages.createdAt} > NOW() - INTERVAL 5 MINUTE`)
    .limit(1);
  return rows.length > 0;
}

export async function getConversations(limit = 50): Promise<SmsConversation[]> {
  const db = await getDb();
  if (!db) return [];
  const convos: SmsConversation[] = await db.select().from(smsConversations)
    .orderBy(desc(smsConversations.lastMessageAt)).limit(limit);

  // Backfill the display name from the customers table for conversations that
  // never captured one — inbound texts from numbers we already know as customers
  // were showing as a raw phone number in the inbox. Match on last-10 digits:
  // conversation phones are normalized E.164 (+1…), customers.phone is bare 10-digit.
  const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
  const unnamed = convos.filter((c) => !c.customerName && c.phone);
  const phones = [...new Set(unnamed.map((c) => last10(c.phone)).filter((p) => p.length === 10))];
  if (phones.length === 0) return convos;

  const matches = await db
    .select({ phone: customers.phone, firstName: customers.firstName, lastName: customers.lastName })
    .from(customers)
    .where(sql`RIGHT(REGEXP_REPLACE(${customers.phone}, '[^0-9]', ''), 10) IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`);

  const nameByPhone = new Map<string, string>();
  for (const m of matches) {
    const key = last10(m.phone);
    if (key.length !== 10 || nameByPhone.has(key)) continue;
    const name = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
    if (name) nameByPhone.set(key, name);
  }

  return convos.map((c) =>
    !c.customerName && c.phone && nameByPhone.has(last10(c.phone))
      ? { ...c, customerName: nameByPhone.get(last10(c.phone))! }
      : c,
  );
}

export async function getConversationMessages(conversationId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(smsMessages)
    .where(eq(smsMessages.conversationId, conversationId))
    .orderBy(smsMessages.createdAt).limit(limit);
}

/**
 * Has the customer ever texted into this thread? A read failure or a missing
 * DB answers false, so a caller that relaxes a gate on "yes" fails closed.
 */
export async function conversationHasInbound(conversationId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const rows = await db.select({ id: smsMessages.id }).from(smsMessages)
      .where(and(eq(smsMessages.conversationId, conversationId), eq(smsMessages.direction, "inbound")))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
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
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(smsConversations)
    .where(gt(smsConversations.unreadCount, 0));
  return result?.count ?? 0;
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
  return db.select().from(repairGallery).orderBy(desc(repairGallery.createdAt)).limit(200);
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
  return db.select().from(technicians).orderBy(desc(technicians.createdAt)).limit(100);
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
import { isDuplicateKeyError } from "./lib/dbErrors";

import { createLogger } from "./lib/logger";

const log = createLogger("db");
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

/**
 * Create an invoice record, taking the next number on a collision.
 *
 * Returns `invoiceNumber`: the number the row was STORED under. Use it, not
 * the number you passed in. The number comes from MAX()+1 with no lock, so two
 * invoices created at once can ask for the same one, and the second is stored
 * under the next number. Until 2026-09-23 placeOrder kept its own copy, so a
 * retry would have linked the tire order and the Stripe checkout to the other
 * customer's invoice.
 *
 * The collision test reads the driver error through drizzle's wrapper: its
 * `code` is undefined and its message is the SQL, so the old inline check never
 * matched a real collision and the first one threw instead of retrying.
 */
export async function createInvoice(data: InsertInvoice): Promise<{ success: boolean; id: number; invoiceNumber: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const row = { ...data };
  // Retry up to 3 times on unique constraint violations (concurrent invoice creation)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.insert(invoices).values(row);
      return { success: true, id: Number(result[0].insertId), invoiceNumber: row.invoiceNumber ?? null };
    } catch (err: unknown) {
      if (isDuplicateKeyError(err) && row.invoiceNumber && attempt < 2) {
        // Regenerate invoice number and retry
        row.invoiceNumber = await getNextInvoiceNumber();
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to create invoice after 3 attempts");
}

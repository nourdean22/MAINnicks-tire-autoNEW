/**
 * Run review request backfill for all completed bookings from the past year.
 * This script connects directly to the database and uses the same logic
 * as the admin backfill endpoint.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql, eq, and, gte, isNotNull, notInArray } from "drizzle-orm";
import crypto from "crypto";

// ─── DB CONNECTION ─────────────────────────────────────
const pool = mysql.createPool(process.env.DATABASE_URL);
const db = drizzle(pool);

// ─── CONSTANTS ─────────────────────────────────────────
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
const COOLDOWN_DAYS = 30;
const STAGGER_MINUTES = 2;

async function main() {
  console.log("=== REVIEW REQUEST BACKFILL ===\n");

  // 1. Get settings
  const [settings] = await db.execute(sql`SELECT * FROM review_settings LIMIT 1`);
  const settingsRow = settings[0];
  const cooldownDays = settingsRow?.cooldownDays ?? COOLDOWN_DAYS;
  console.log(`Settings: cooldown=${cooldownDays} days`);

  // 2. Get all completed bookings from past year with phone numbers
  const [completedBookings] = await db.execute(sql`
    SELECT id, name, phone, service, updatedAt
    FROM bookings
    WHERE status = 'completed'
      AND updatedAt >= ${ONE_YEAR_AGO}
      AND phone IS NOT NULL
      AND phone != ''
    ORDER BY updatedAt DESC
  `);

  console.log(`Found ${completedBookings.length} completed bookings from past year\n`);

  if (completedBookings.length === 0) {
    console.log("No eligible bookings found. Exiting.");
    await pool.end();
    return;
  }

  // 3. Get phones that already have recent review requests (within cooldown)
  const cooldownDate = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
  const [existingRequests] = await db.execute(sql`
    SELECT DISTINCT phone FROM review_requests
    WHERE createdAt >= ${cooldownDate}
  `);
  const existingPhones = new Set(existingRequests.map(r => normalizePhone(r.phone)));
  console.log(`${existingPhones.size} phones already contacted within ${cooldownDays}-day cooldown\n`);

  // 4. Deduplicate by phone — only send one per unique phone
  const seenPhones = new Set();
  const eligible = [];
  for (const booking of completedBookings) {
    const normalized = normalizePhone(booking.phone);
    if (!normalized || normalized.length < 10) continue;
    if (seenPhones.has(normalized) || existingPhones.has(normalized)) continue;
    seenPhones.add(normalized);
    eligible.push(booking);
  }

  console.log(`${eligible.length} unique eligible customers after deduplication\n`);

  // 5. Preview
  console.log("--- PREVIEW (first 20) ---");
  for (const b of eligible.slice(0, 20)) {
    console.log(`  ${b.customerName} | ${b.phone} | ${b.serviceType} | completed ${new Date(b.updatedAt).toLocaleDateString()}`);
  }
  if (eligible.length > 20) console.log(`  ... and ${eligible.length - 20} more`);
  console.log();

  // 6. Schedule review requests with staggered timing
  let scheduled = 0;
  let skipped = 0;
  const now = Date.now();

  for (let i = 0; i < eligible.length; i++) {
    const booking = eligible[i];
    const scheduledAt = new Date(now + i * STAGGER_MINUTES * 60 * 1000);
    const token = crypto.randomBytes(16).toString("hex");

    try {
      await db.execute(sql`
        INSERT INTO review_requests (bookingId, customerName, phone, service, status, scheduledAt, trackingToken, createdAt)
        VALUES (${booking.id}, ${booking.name}, ${normalizePhone(booking.phone)}, ${booking.service || "Auto Service"}, 'pending', ${scheduledAt}, ${token}, NOW())
      `);
      scheduled++;
    } catch (err) {
      console.error(`  Failed to schedule for ${booking.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`Scheduled: ${scheduled}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total eligible: ${eligible.length}`);
  console.log(`\nReview requests will be sent every 5 minutes by the queue processor.`);
  console.log(`First batch sends at: ${new Date(now).toLocaleString()}`);
  console.log(`Last batch sends at: ${new Date(now + (eligible.length - 1) * STAGGER_MINUTES * 60 * 1000).toLocaleString()}`);

  await pool.end();
}

function normalizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/\D/g, "").replace(/^1/, "");
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

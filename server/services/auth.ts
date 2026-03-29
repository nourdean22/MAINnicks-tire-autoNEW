/**
 * Customer Authentication — Phone + OTP (no passwords)
 * Customers log in with phone number + 6-digit SMS code.
 * Issues JWT tokens valid for 30 days.
 */

import { eq, and, gt, desc, like } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { createLogger } from "../lib/logger";
import { randomUUID, randomInt } from "crypto";

const log = createLogger("auth");

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required — refusing to use insecure fallback");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Request OTP — generates 6-digit code, stores in DB, sends via SMS
 */
export async function requestOTP(phone: string): Promise<{ success: boolean; error?: string }> {
  const normalized = phone.replace(/\D/g, "").slice(-10);
  if (normalized.length !== 10) {
    return { success: false, error: "Invalid phone number" };
  }

  const code = randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    const { getDb } = await import("../db");
    const { otpCodes } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { success: false, error: "Database not available" };

    await db.insert(otpCodes).values({
      id: randomUUID(),
      phone: normalized,
      code,
      expiresAt,
      used: false,
    });

    // Send SMS
    const { sendSms } = await import("../sms");
    await sendSms(phone, `Your Nick's Tire & Auto verification code: ${code}. Expires in 10 minutes.`);

    log.info("OTP requested", { phone: `***${normalized.slice(-4)}` });
    return { success: true };
  } catch (err) {
    log.error("OTP request failed", { error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "Failed to send verification code" };
  }
}

/**
 * Verify OTP — checks code, issues JWT if valid
 */
export async function verifyOTP(phone: string, code: string): Promise<{ token?: string; customerId?: string; error?: string }> {
  const normalized = phone.replace(/\D/g, "").slice(-10);

  try {
    const { getDb } = await import("../db");
    const { otpCodes, customers } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { error: "Database not available" };

    // Find valid OTP
    const [otp] = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.phone, normalized),
          eq(otpCodes.code, code),
          eq(otpCodes.used, false),
          gt(otpCodes.expiresAt, new Date())
        )
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);

    if (!otp) return { error: "Invalid or expired code" };

    // Mark as used
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp.id));

    // Find customer
    const [customer] = await db
      .select()
      .from(customers)
      .where(like(customers.phone, `%${normalized}`))
      .limit(1);

    if (!customer) return { error: "No account found for this phone number" };

    // Issue JWT (30-day expiry)
    const token = await new (await import("jose")).SignJWT({ customerId: customer.id, phone: normalized })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .setIssuedAt()
      .sign(getJwtSecret());

    log.info("OTP verified, token issued", { customerId: customer.id });
    return { token, customerId: String(customer.id) };
  } catch (err) {
    log.error("OTP verification failed", { error: err instanceof Error ? err.message : String(err) });
    return { error: "Verification failed" };
  }
}

/**
 * Verify JWT token — returns customer info if valid
 */
export async function verifyToken(token: string): Promise<{ customerId: string; phone: string } | null> {
  try {
    const { payload } = await (await import("jose")).jwtVerify(token, getJwtSecret());
    return {
      customerId: payload.customerId as string,
      phone: payload.phone as string,
    };
  } catch {
    return null;
  }
}

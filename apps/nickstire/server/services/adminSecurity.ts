import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { AdminRole } from "../../shared/adminPermissions";

export interface AdminSecurityState {
  adminRole: AdminRole;
  mfaEnabled: boolean;
  mfaVerifiedAt: Date | null;
  /** DB-computed minutes since mfaVerifiedAt; null when never verified or unreadable. */
  mfaAgeMinutes: number | null;
  encryptedSecret: string | null;
}

/**
 * MFA enforcement is OPT-IN via ADMIN_MFA_REQUIRED=1.
 *
 * Operator decision 2026-07-16: admin auth is Google sign-in alone, "like
 * before" — the always-on TOTP gate the admin waves shipped locked the
 * operator out of his own dashboard ("Setup must be completed before
 * operational data is available") on a single-operator shop site. All the
 * MFA machinery (enrollment, verification, per-role permissions) stays
 * intact behind this flag; flipping the env on Railway re-arms the full
 * gate without a code change.
 */
export function isAdminMfaRequired(): boolean {
  return process.env.ADMIN_MFA_REQUIRED === "1";
}

/**
 * The security state used when enforcement is OFF: pre-wave behavior, where
 * an admin identity alone grants full access. Role is owner so
 * adminPermissionProcedure checks stay satisfied — per-role management is
 * only meaningful under the enforced regime.
 */
export const MFA_NOT_REQUIRED_STATE: AdminSecurityState = {
  adminRole: "owner",
  mfaEnabled: false,
  mfaVerifiedAt: null,
  mfaAgeMinutes: null,
  encryptedSecret: null,
};

function rowsFromExecute(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as Record<string, unknown>[];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

function encryptionKey(): Buffer {
  const secret = process.env.ADMIN_MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("ADMIN_MFA_ENCRYPTION_KEY or JWT_SECRET is required");
  return createHash("sha256").update(secret).digest();
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((value) => value.toString("base64url")).join(".");
}

export function decryptMfaSecret(payload: string): string {
  const [ivPart, tagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getAdminSecurityState(openId: string): Promise<AdminSecurityState | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT adminRole, mfaEnabled, mfaVerifiedAt, mfaSecretEncrypted,
           TIMESTAMPDIFF(MINUTE, mfaVerifiedAt, UTC_TIMESTAMP()) AS mfaAgeMinutes
    FROM users
    WHERE openId = ${openId}
    LIMIT 1
  `);
  const row = rowsFromExecute(result)[0];
  if (!row) return null;
  return {
    adminRole: (row.adminRole as AdminRole | null) ?? "viewer",
    mfaEnabled: Boolean(row.mfaEnabled),
    mfaVerifiedAt: row.mfaVerifiedAt ? new Date(row.mfaVerifiedAt as string | Date) : null,
    // DB-computed age. The parsed Date above is skewed +4h on an ET host (mysql2
    // decodes DATETIME as connection-local while the server returns UTC), which
    // silently stretched the 12h MFA re-verification window to ~16h. The
    // comparison now happens where the clock is trustworthy.
    mfaAgeMinutes:
      row.mfaAgeMinutes === null || row.mfaAgeMinutes === undefined || row.mfaAgeMinutes === ""
        ? null
        : Number(row.mfaAgeMinutes),
    encryptedSecret: (row.mfaSecretEncrypted as string | null) ?? null,
  };
}

export async function storePendingMfaSecret(openId: string, secret: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const encrypted = encryptMfaSecret(secret);
  await db.execute(sql`
    UPDATE users
    SET mfaSecretEncrypted = ${encrypted}, mfaEnabled = false, mfaVerifiedAt = NULL
    WHERE openId = ${openId}
  `);
}

export async function enableMfa(openId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.execute(sql`
    UPDATE users
    SET mfaEnabled = true, mfaVerifiedAt = NOW()
    WHERE openId = ${openId} AND mfaSecretEncrypted IS NOT NULL
  `);
}

export async function markMfaVerified(openId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.execute(sql`UPDATE users SET mfaVerifiedAt = NOW() WHERE openId = ${openId}`);
}

/**
 * Freshness from the DB-COMPUTED age, never from a driver-parsed Date.
 *
 * The predecessor compared `Date.now()` against the parsed `mfaVerifiedAt`, and
 * mysql2's local-zone DATETIME decoding made that timestamp read ~4h in the
 * future on an ET host - so the "verified within the last 12h" gate actually
 * accepted ~16h. FAIL CLOSED: an unknown or incomputable age requires
 * re-verification; assuming fresh is how a stale factor becomes a bypass.
 */
export function isMfaVerificationFresh(ageMinutes: number | null, maxAgeHours = 12): boolean {
  return ageMinutes !== null && Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= maxAgeHours * 60;
}

export async function setAdminRole(openId: string, role: AdminRole): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.execute(sql`UPDATE users SET adminRole = ${role} WHERE openId = ${openId} AND role = 'admin'`);
}

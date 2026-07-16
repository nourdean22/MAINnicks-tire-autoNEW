import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { AdminRole } from "../../shared/adminPermissions";

export interface AdminSecurityState {
  adminRole: AdminRole;
  mfaEnabled: boolean;
  mfaVerifiedAt: Date | null;
  encryptedSecret: string | null;
}

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
    SELECT adminRole, mfaEnabled, mfaVerifiedAt, mfaSecretEncrypted
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

export function isMfaVerificationFresh(at: Date | null, maxAgeHours = 12): boolean {
  return Boolean(at && Date.now() - at.getTime() <= maxAgeHours * 60 * 60 * 1000);
}

export async function setAdminRole(openId: string, role: AdminRole): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.execute(sql`UPDATE users SET adminRole = ${role} WHERE openId = ${openId} AND role = 'admin'`);
}

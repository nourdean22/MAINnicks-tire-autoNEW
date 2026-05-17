/**
 * Compliance Log — thin, typed wrappers over audit_log for the events we
 * need to defend in court if Twilio ever calls us about TCPA, or if
 * someone asks "who logged into admin last week."
 *
 * Uses the existing `audit_log` table — no schema migration needed.
 *
 * Public API:
 *   logSmsOptIn(phone, source, ip)    — recorded when customer gives consent
 *   logSmsOptOut(phone, ip, via)      — recorded when STOP received or manual
 *   logAdminLogin(email, ip, ua)      — recorded on every admin OAuth success
 *   getRecentOptIns(limit)            — admin query
 *   getRecentOptOuts(limit)
 *   getRecentAdminLogins(limit)
 */

import { randomUUID } from "crypto";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";
import { desc, eq, sql, and } from "drizzle-orm";
import { auditLog } from "../../drizzle/schema";

const log = createLogger("compliance-log");

// ─── Action keys ───────────────────────────────────────
const ACT_SMS_OPT_IN = "sms.opt_in";
const ACT_SMS_OPT_OUT = "sms.opt_out";
const ACT_ADMIN_LOGIN = "admin.login";
const ACT_ADMIN_LOGIN_FAIL = "admin.login_failed";

// ─── Core insert ───────────────────────────────────────
async function insert(entry: {
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  const d = await db();
  if (!d) return;

  try {
    await d.insert(auditLog).values({
      id: randomUUID(),
      actor: entry.actor.slice(0, 100),
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      changes: entry.changes ?? null,
      ipAddress: entry.ipAddress?.slice(0, 45) ?? null,
    });
  } catch (err) {
    log.warn("Failed to write compliance log entry", {
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── SMS Consent (TCPA) ────────────────────────────────

/**
 * Record an SMS opt-in. Call this every time a form that promises we'll send
 * SMS is submitted (booking, lead, callback request), and every time STOP-reply
 * customers text START/YES.
 *
 * Source examples: "booking_form", "lead_popup", "callback_request",
 *   "start_keyword_reply", "admin_manual_add"
 */
export async function logSmsOptIn(params: {
  phone: string;
  source: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  const normalized = normalizePhone(params.phone);
  if (!normalized) return;
  await insert({
    actor: normalized,
    action: ACT_SMS_OPT_IN,
    entityType: "phone",
    entityId: normalized,
    changes: {
      source: params.source,
      userAgent: params.userAgent?.slice(0, 300) ?? null,
      ...params.context,
    },
    ipAddress: params.ipAddress,
  });
}

/**
 * Record an SMS opt-out. Called from the Twilio webhook when STOP/UNSUBSCRIBE/
 * CANCEL/END/QUIT is received — or manually by admin.
 */
export async function logSmsOptOut(params: {
  phone: string;
  ipAddress?: string | null;
  via: "keyword" | "admin" | "api";
  keyword?: string;
}): Promise<void> {
  const normalized = normalizePhone(params.phone);
  if (!normalized) return;
  await insert({
    actor: normalized,
    action: ACT_SMS_OPT_OUT,
    entityType: "phone",
    entityId: normalized,
    changes: { via: params.via, keyword: params.keyword ?? null },
    ipAddress: params.ipAddress,
  });
}

// ─── Admin Login ───────────────────────────────────────

/**
 * Record a successful admin sign-in via OAuth.
 * Called from the /api/oauth/callback handler.
 */
export async function logAdminLogin(params: {
  email: string;
  openId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await insert({
    actor: params.email,
    action: ACT_ADMIN_LOGIN,
    entityType: "user",
    entityId: params.openId ?? params.email,
    changes: { userAgent: params.userAgent?.slice(0, 300) ?? null },
    ipAddress: params.ipAddress,
  });
}

/** Record a failed admin sign-in attempt (bad owner id, unknown user, etc). */
export async function logAdminLoginFail(params: {
  attemptedEmail?: string;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await insert({
    actor: params.attemptedEmail ?? "unknown",
    action: ACT_ADMIN_LOGIN_FAIL,
    entityType: "user",
    changes: { reason: params.reason, userAgent: params.userAgent?.slice(0, 300) ?? null },
    ipAddress: params.ipAddress,
  });
}

// ─── Query helpers ─────────────────────────────────────

export interface ComplianceEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

async function queryBy(action: string, limit: number): Promise<ComplianceEntry[]> {
  const d = await db();
  if (!d) return [];
  try {
    const rows = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, action))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return rows as unknown as ComplianceEntry[];
  } catch (err) {
    log.warn("queryBy failed", { action, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export function getRecentOptIns(limit: number = 100) {
  return queryBy(ACT_SMS_OPT_IN, limit);
}

export function getRecentOptOuts(limit: number = 100) {
  return queryBy(ACT_SMS_OPT_OUT, limit);
}

export function getRecentAdminLogins(limit: number = 20) {
  return queryBy(ACT_ADMIN_LOGIN, limit);
}

export function getRecentAdminLoginFailures(limit: number = 20) {
  return queryBy(ACT_ADMIN_LOGIN_FAIL, limit);
}

/** Check if a phone has a recorded opt-in (quick defensibility check). */
export async function hasSmsOptIn(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const d = await db();
  if (!d) return false;
  try {
    const rows = await d
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, ACT_SMS_OPT_IN), eq(auditLog.actor, normalized)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

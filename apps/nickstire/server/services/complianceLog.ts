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
 *   getSmsOptInIndex()                — READ side of the consent ledger; the
 *                                       sendSms marketing gate consumes this
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

// ─── Consent index cache ───────────────────────────────
// Keyed by last-10 digits so it joins cleanly against the opt-out index in
// sms.ts, which normalizes the same way. 5-min TTL matches that index; new
// opt-ins land immediately via the write-through in logSmsOptIn.
let consentCache: Set<string> | null = null;
let consentCacheLoadedAt = 0;
const CONSENT_CACHE_TTL_MS = 5 * 60 * 1000;

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
  // Write-through so a consent given SECONDS ago is honored by the next
  // marketing send instead of waiting out the index TTL. Without this, a
  // customer who just ticked the box on the booking form could be refused
  // a message they explicitly asked for, for up to five minutes.
  consentCache?.add(normalized.slice(-10));
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
 * Record an SMS opt-out. Live callers: executeAutoAction (services/
 * smsResponseParser.ts) on opt-out keywords, and the SMS-bot STOP handler
 * (routers/smsBot.ts) — both reached via the inbound SMS webhooks. `via`
 * distinguishes keyword- vs. admin/API-initiated opt-outs.
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
      // Explicit ComplianceEntry projection: a bare select() enumerates every
      // schema column, which breaks against a database that has not
      // hand-applied the 0110 ledger columns yet.
      .select({
        id: auditLog.id,
        actor: auditLog.actor,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
      })
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

// ─── Consent index (the READ side of the ledger) ───────

/**
 * Either a usable consent index, or an explicit statement that we could not
 * build one.
 *
 * Same honest-failure contract as sms.ts's `OptOutIndex`, and for the same
 * reason: an empty Set and an unreadable table must never be indistinguishable
 * when the answer decides whether a marketing text goes out. A STALE set is
 * still `ok: true` — it is real data that was really loaded.
 */
export type SmsConsentIndex =
  | { ok: true; phones: Set<string>; stale: boolean }
  | { ok: false; reason: string };

/**
 * Every phone with a recorded `sms.opt_in`, keyed by last-10 digits.
 *
 * Written by the booking form, the lead form and the START-keyword handler.
 * This is what `sendSms` consults before a customer_marketing send — the
 * ledger existed and was being written long before anything read it.
 *
 * Filters on `entity_type` FIRST on purpose: `idx_audit_entity` leads with
 * that column, so this reads an index range rather than scanning all of
 * audit_log (there is no index on `action` alone).
 */
export async function getSmsOptInIndex(): Promise<SmsConsentIndex> {
  const now = Date.now();
  if (consentCache && now - consentCacheLoadedAt < CONSENT_CACHE_TTL_MS) {
    return { ok: true, phones: consentCache, stale: false };
  }
  const stale = (reason: string): SmsConsentIndex =>
    consentCache ? { ok: true, phones: consentCache, stale: true } : { ok: false, reason };

  const d = await db();
  if (!d) return stale("database unavailable");
  try {
    const rows = await d
      .select({ actor: auditLog.actor })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "phone"), eq(auditLog.action, ACT_SMS_OPT_IN)));
    const fresh = new Set<string>();
    for (const r of rows as Array<{ actor: string | null }>) {
      const p10 = (r.actor || "").replace(/\D/g, "").slice(-10);
      if (p10.length === 10) fresh.add(p10);
    }
    consentCache = fresh;
    consentCacheLoadedAt = now;
    return { ok: true, phones: fresh, stale: false };
  } catch (err) {
    // error, not warn: on a first-load failure an armed gate is about to
    // refuse every marketing send, and the operator needs to know why.
    log.error("consent index refresh FAILED — falling back to the last loaded index", {
      error: err instanceof Error ? err.message : String(err),
      haveStaleIndex: consentCache !== null,
    });
    return stale(err instanceof Error ? err.message : "consent index unavailable");
  }
}

/**
 * Check if a phone has a recorded opt-in (quick defensibility check).
 * Reads the same index the send gate uses so there is ONE definition of
 * "this person consented" — an unreadable ledger answers `false`, which is
 * the safe direction for every caller.
 */
export async function hasSmsOptIn(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const index = await getSmsOptInIndex();
  return index.ok && index.phones.has(normalized.slice(-10));
}

/** Test seam — drops the cached index so the next read rebuilds from the DB. */
export function __resetConsentIndexCacheForTests(): void {
  consentCache = null;
  consentCacheLoadedAt = 0;
}

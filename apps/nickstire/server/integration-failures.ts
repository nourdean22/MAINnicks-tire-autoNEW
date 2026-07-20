/**
 * Integration failure tracking utility
 * Logs failed integrations (Sheets sync, email, SMS, CAPI) for visibility in admin dashboard
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import { integrationFailures, type IntegrationFailure } from "../drizzle/schema";

/** Subset of columns the read query selects (errorDetails excluded). */
type FailureRow = Pick<IntegrationFailure, "id" | "failureType" | "entityType" | "entityId" | "errorMessage" | "resolvedAt" | "createdAt">;

import { createLogger } from "./lib/logger";

const log = createLogger("integration-failures");
export type FailureType = "sheets_sync" | "email" | "sms" | "capi" | "review_request" | "reminders" | "invoice";

interface LogFailureParams {
  failureType: FailureType;
  entityId: number | null; // booking ID, lead ID, etc.
  entityType: "booking" | "lead" | "invoice" | "reminder" | "review";
  errorMessage: string;
  errorDetails?: any;
}

export async function logIntegrationFailure({
  failureType,
  entityId,
  entityType,
  errorMessage,
  errorDetails,
}: LogFailureParams): Promise<void> {
  try {
    const d = await getDb();
    if (!d) {
      log.error(`[IntegrationFailures] DB unavailable; logging to console: ${failureType} on ${entityType}#${entityId}`);
      log.error(`[IntegrationFailures] Error: ${errorMessage}`, errorDetails);
      return;
    }

    await d.insert(integrationFailures).values({
      failureType,
      entityId: entityId || null,
      entityType,
      errorMessage: errorMessage.substring(0, 1000), // Truncate to DB column limit
      errorDetails: errorDetails ? JSON.stringify(errorDetails).substring(0, 2000) : null,
      resolvedAt: null,
      createdAt: new Date(),
    });

    log.error(`[IntegrationFailures] Logged ${failureType} failure on ${entityType}#${entityId}: ${errorMessage}`);
  } catch (logErr) {
    // Avoid infinite loops; if logging fails, just console.error
    log.error("[IntegrationFailures] Failed to log failure:", {
      failureType,
      entityId,
      entityType,
      errorMessage,
      logError: logErr,
    });
  }
}

export async function resolveIntegrationFailure(id: number): Promise<void> {
  try {
    const d = await getDb();
    if (!d) return;
    await d
      .update(integrationFailures)
      .set({ resolvedAt: new Date() })
      .where(eq(integrationFailures.id, id));
  } catch (err) {
    log.error("[IntegrationFailures] Failed to resolve failure #" + id, err);
  }
}

// ─── READ-ONLY ADMIN VISIBILITY ────────────────────────────────────────
// Surfaces recent failures to the admin Site-Health surface so silent
// breakage (a sheets-sync / CAPI / SMS failure that loses a lead) becomes
// visible. SECURITY: never returns `errorDetails` (the JSON.stringify'd raw
// error payload — may echo tokens/API responses/customer data), and scrubs
// `errorMessage` for key/token-shaped substrings before exposing it.

/** Failure sources whose breakage can directly cost a lead/booking. */
const LEAD_AFFECTING: FailureType[] = ["sheets_sync", "capi", "sms", "email"];

export interface SafeIntegrationFailure {
  id: number;
  failureType: FailureType;
  entityType: string;
  entityId: number | null;
  /** Scrubbed, truncated error message — safe to show in the admin UI. */
  message: string;
  resolved: boolean;
  leadAffecting: boolean;
  createdAt: Date;
}

export interface IntegrationFailureSummary {
  /**
   * FALSE when the table could not be read (DB down, query error). An empty
   * `failures` array means "nothing failing" ONLY when this is true — the two
   * states were previously byte-identical and the UI rendered both as green.
   */
  readable: boolean;
  failures: SafeIntegrationFailure[];
  counts: { recent: number; unresolved: number; leadAffectingUnresolved: number; byType: Record<string, number> };
}

/** Strip key/token/secret-shaped substrings + truncate. Defensive — the raw
 *  errorDetails blob is already excluded; this guards the errorMessage text.
 *  Exported for unit testing of the redaction rules. */
export function scrubMessage(raw: string): string {
  let s = String(raw || "");
  s = s.replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]");
  s = s.replace(/\b(api[_-]?key|token|secret|password|authorization|auth|access[_-]?token)\b\s*[:=]\s*["']?[^\s,&"']+/gi, "$1=[redacted]");
  s = s.replace(/\bAIza[0-9A-Za-z_\-]{10,}\b/g, "[redacted-key]"); // Google API key
  s = s.replace(/\bsk-[A-Za-z0-9]{12,}\b/g, "[redacted-key]");      // OpenAI-style
  s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hash]");         // long hex (keys/hashes/sids)
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Recent integration failures, sanitized for read-only admin display.
 * Selects ONLY safe columns (no errorDetails). Pure read.
 */
export async function getRecentIntegrationFailures(limit = 30): Promise<IntegrationFailureSummary> {
  // `readable: false` is the difference between "nothing is failing" and "we
  // could not check". Both used to return this identical empty payload, so
  // SiteHealthSection took its `failures.length === 0` branch and painted the
  // emerald all-clear during a DB outage. The client already has an honest
  // "unknown" state (deriveSheetsSyncHealth) — the server just never gave it
  // anything to trigger on.
  const unreadable: IntegrationFailureSummary = {
    readable: false,
    failures: [],
    counts: { recent: 0, unresolved: 0, leadAffectingUnresolved: 0, byType: {} },
  };
  try {
    const d = await getDb();
    if (!d) return unreadable;
    const safeLimit = Math.min(100, Math.max(1, limit));
    const rows = await d
      .select({
        id: integrationFailures.id,
        failureType: integrationFailures.failureType,
        entityType: integrationFailures.entityType,
        entityId: integrationFailures.entityId,
        errorMessage: integrationFailures.errorMessage, // scrubbed below
        resolvedAt: integrationFailures.resolvedAt,
        createdAt: integrationFailures.createdAt,
        // errorDetails intentionally NOT selected (raw payload · may contain secrets/PII)
      })
      .from(integrationFailures)
      .orderBy(desc(integrationFailures.createdAt))
      .limit(safeLimit);

    const byType: Record<string, number> = {};
    let unresolved = 0;
    let leadAffectingUnresolved = 0;
    const failures: SafeIntegrationFailure[] = rows.map((r: FailureRow) => {
      const ft = r.failureType as FailureType;
      const isResolved = r.resolvedAt != null;
      const leadAffecting = LEAD_AFFECTING.includes(ft);
      byType[ft] = (byType[ft] ?? 0) + 1;
      if (!isResolved) {
        unresolved++;
        if (leadAffecting) leadAffectingUnresolved++;
      }
      return {
        id: r.id,
        failureType: ft,
        entityType: String(r.entityType),
        entityId: r.entityId ?? null,
        message: scrubMessage(r.errorMessage),
        resolved: isResolved,
        leadAffecting,
        createdAt: r.createdAt,
      };
    });
    return { readable: true, failures, counts: { recent: failures.length, unresolved, leadAffectingUnresolved, byType } };
  } catch (err) {
    log.error("[IntegrationFailures] Failed to read recent failures", err);
    return unreadable;
  }
}

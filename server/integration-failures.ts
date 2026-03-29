/**
 * Integration failure tracking utility
 * Logs failed integrations (Sheets sync, email, SMS, CAPI) for visibility in admin dashboard
 */
import { getDb } from "./db";
import { integrationFailures } from "../drizzle/schema";

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
      console.error(`[IntegrationFailures] DB unavailable; logging to console: ${failureType} on ${entityType}#${entityId}`);
      console.error(`[IntegrationFailures] Error: ${errorMessage}`, errorDetails);
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

    console.error(`[IntegrationFailures] Logged ${failureType} failure on ${entityType}#${entityId}: ${errorMessage}`);
  } catch (logErr) {
    // Avoid infinite loops; if logging fails, just console.error
    console.error("[IntegrationFailures] Failed to log failure:", {
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
      .where((t: any) => t.id === id);
  } catch (err) {
    console.error("[IntegrationFailures] Failed to resolve failure #" + id, err);
  }
}

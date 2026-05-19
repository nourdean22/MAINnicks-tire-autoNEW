/**
 * Confirmation Call Cron · wave-181.84
 *
 * Fires daily (configurable via scheduler tier). For every booking
 * happening tomorrow that hasn't been called yet, places an AgentPhone
 * outbound call to confirm/reschedule. Uses the hosted-mode LLM with
 * the brand-voice-compliant system prompt at services/agentphone.ts.
 *
 * Safety gates · this cron does NOT fire unless:
 *   1. AGENTPHONE_API_KEY env is set (Railway dashboard)
 *   2. FEATURE_CONFIRMATION_CALLS=1 env is set (Railway dashboard)
 *   3. AGENTPHONE_CONFIRMATION_AGENT_ID env is set (operator creates
 *      the agent via dashboard or one-shot script · gets the ID back)
 *
 * Without all three, the cron logs "skipped (not configured)" and exits.
 * Same pattern as wave-181.46 declined-recovery FEATURE flag · operator
 * stays in control until ready.
 *
 * Per-run cap · 20 calls/run (matches declined-recovery cap). At ~30-40
 * bookings/day historically, this covers the full daily slate. Operator
 * can raise via AGENTPHONE_CONFIRMATION_BATCH_SIZE env if needed.
 */
import { createLogger } from "../../lib/logger";
import { and, gte, lte, eq, isNull, or } from "drizzle-orm";

const log = createLogger("cron:confirmation-calls");

interface RunResult {
  recordsProcessed: number;
  details: string;
}

export async function runConfirmationCalls(): Promise<RunResult> {
  const { isAgentPhoneEnabled, placeCall, buildConfirmationSystemPrompt } =
    await import("../../services/agentphone");

  if (!isAgentPhoneEnabled()) {
    return {
      recordsProcessed: 0,
      details: "Skipped · AGENTPHONE_API_KEY missing or FEATURE_CONFIRMATION_CALLS != '1'",
    };
  }

  const agentId = process.env.AGENTPHONE_CONFIRMATION_AGENT_ID;
  if (!agentId) {
    log.warn("[confirmation-calls] AGENTPHONE_CONFIRMATION_AGENT_ID missing · cannot place calls");
    return {
      recordsProcessed: 0,
      details: "Skipped · AGENTPHONE_CONFIRMATION_AGENT_ID env missing (operator must create agent first)",
    };
  }

  const maxCalls = Math.min(Number(process.env.AGENTPHONE_CONFIRMATION_BATCH_SIZE) || 20, 50);

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { bookings, confirmationCalls } = await import("../../../drizzle/schema");

  // Tomorrow's bookings · stage in active flow (not cancelled / completed)
  // and that haven't already been called for this attempt.
  // Match preferredDate against tomorrow's calendar date (string match · the
  // bookings table stores preferredDate as a varchar like "2026-05-20").
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10); // "YYYY-MM-DD"

  let candidates: Array<{
    id: number;
    name: string;
    phone: string;
    service: string;
    vehicleYear: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    preferredDate: string | null;
  }> = [];
  try {
    candidates = await d
      .select({
        id: bookings.id,
        name: bookings.name,
        phone: bookings.phone,
        service: bookings.service,
        vehicleYear: bookings.vehicleYear,
        vehicleMake: bookings.vehicleMake,
        vehicleModel: bookings.vehicleModel,
        preferredDate: bookings.preferredDate,
      })
      .from(bookings)
      .where(and(
        eq(bookings.preferredDate, tomorrowStr),
        or(eq(bookings.status, "new"), eq(bookings.status, "confirmed")),
      ))
      .limit(maxCalls + 10);
  } catch (err) {
    log.warn("[confirmation-calls] candidate query failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: "Failed to load candidates" };
  }

  if (candidates.length === 0) {
    return { recordsProcessed: 0, details: `No bookings for ${tomorrowStr}` };
  }

  // Filter out bookings already called for tomorrow's slot (any non-failed
  // attempt in the last 24h is treated as "already called").
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const previousCalls = await d
    .select({ bookingId: confirmationCalls.bookingId, status: confirmationCalls.status })
    .from(confirmationCalls)
    .where(gte(confirmationCalls.attemptedAt, twentyFourHoursAgo));
  const alreadyCalled = new Set(
    previousCalls
      .filter((c: { status: string }) => c.status !== "failed")
      .map((c: { bookingId: number }) => c.bookingId),
  );

  let placed = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of candidates) {
    if (placed >= maxCalls) {
      log.info(`[confirmation-calls] hit per-run cap ${maxCalls}, stopping early`);
      break;
    }
    if (alreadyCalled.has(b.id)) {
      skipped++;
      continue;
    }
    if (!b.phone || !/^\+?\d/.test(b.phone)) {
      skipped++;
      continue;
    }

    // Normalize to E.164. The booking form usually stores +1XXXXXXXXXX
    // already, but some legacy rows are unformatted.
    const digits = b.phone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") && digits.length === 11 ? `+${digits}` : b.phone.startsWith("+") ? b.phone : `+1${digits.slice(-10)}`;

    const vehicleRef = [b.vehicleYear, b.vehicleMake, b.vehicleModel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase() || undefined;

    const firstName = b.name.split(" ")[0] || b.name;

    // Insert pending row BEFORE placing the call (at-most-once claim ·
    // same wave-181.59 pattern as declined-recovery).
    let attemptId: number | null = null;
    try {
      const [insertResult] = await d
        .insert(confirmationCalls)
        .values({
          bookingId: b.id,
          status: "pending",
        })
        .$returningId();
      attemptId = insertResult?.id ?? null;
    } catch (err) {
      log.warn(`[confirmation-calls] failed to claim attempt for booking ${b.id}`, { error: err instanceof Error ? err.message : String(err) });
      failed++;
      continue;
    }

    const call = await placeCall({
      agentId,
      toNumber: e164,
      initialGreeting: `Hi, this is Nick's Tire & Auto calling to confirm tomorrow's appointment for ${firstName}.`,
      systemPrompt: buildConfirmationSystemPrompt({
        customerName: firstName,
        service: b.service,
        preferredDay: "tomorrow",
        vehicleRef,
      }),
    });

    if (call.success && call.callId && attemptId !== null) {
      await d
        .update(confirmationCalls)
        .set({ agentphoneCallId: call.callId, status: "dialing" })
        .where(eq(confirmationCalls.id, attemptId));
      placed++;
      log.info(`[confirmation-calls] placed call ${call.callId} for booking ${b.id} (${firstName})`);
    } else {
      if (attemptId !== null) {
        await d
          .update(confirmationCalls)
          .set({ status: "failed", errorMessage: (call.error ?? "unknown").slice(0, 500), completedAt: new Date() })
          .where(eq(confirmationCalls.id, attemptId));
      }
      failed++;
      log.warn(`[confirmation-calls] place failed for booking ${b.id}`, { error: call.error });
    }

    // Throttle · 1s between dial requests · avoids burst-rate limits
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    recordsProcessed: placed,
    details: `placed=${placed} skipped=${skipped} failed=${failed} (target date: ${tomorrowStr})`,
  };
}

/**
 * Follow-up Cadence Cron · wave-143 · THE FLYWHEEL.
 *
 * After a completed job, the follow-up caller reaches out on a 3-touch
 * cadence — 7, 30, and 60 days out — to catch problems early, ask for the
 * referral, and pull the customer back for the next job. Turns the manual
 * "call when I remember" into a system that compounds: more revisits, more
 * referrals, more revenue, while the operator sleeps.
 *
 * Safety (the operator's "no spam, no errors" bar) — fires ONLY if ALL of:
 *   1. VAPI_API_KEY set
 *   2. VAPI_PHONE_NUMBER_ID set (outbound number registered with VAPI)
 *   3. VAPI_FOLLOWUP_ASSISTANT_ID set
 *   4. FEATURE_FOLLOWUP_CADENCE=1            ← OFF by default
 * Plus, always:
 *   · ONE touch per booking per run (the earliest un-fired due touch) — a
 *     customer is never called more than once in a single run.
 *   · at-most-once per (booking, touch) via the voice_followups UNIQUE key —
 *     an overlapping run or retry can NEVER double-dial the same touch.
 *   · hard daily cap (FOLLOWUP_CADENCE_DAILY_CAP, default 10).
 *   · SMS-opted-out customers skipped (conservative: opt-out = no auto-call).
 *   · business-hours only (9am–6pm Cleveland · TCPA-safe + polite).
 *   · only bookings completed within the last 65 days (no backfilling history).
 *   · DRY RUN (FOLLOWUP_CADENCE_DRY_RUN=1) — logs the call list WITHOUT
 *     dialing. Review it before flipping the feature live.
 *
 * Reuses the live follow-up assistant's trust-call prompt (no new script) by
 * passing {{name}} / {{lastService}} via placeVapiOutboundCall variableValues.
 */
import { createLogger } from "../../lib/logger";
import { isDuplicateKeyError } from "../../lib/dbErrors";
import { and, eq, gte, lte, inArray } from "drizzle-orm";

const log = createLogger("cron:followup-cadence");

interface RunResult {
  recordsProcessed: number;
  details: string;
}

type TouchKey = "d7" | "d30" | "d60";
const TOUCHES: Array<{ key: TouchKey; days: number }> = [
  { key: "d7", days: 7 },
  { key: "d30", days: 30 },
  { key: "d60", days: 60 },
];
const FLOOR_DAYS = 65; // d60 + slack · never auto-call bookings older than this
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure · the earliest un-fired touch whose due-time has passed, else null.
 * Touches fire in order (d7 → d30 → d60), ONE per run — so a brand-new
 * completion gets d7 at ~day 7, then d30, then d60, never all at once.
 */
export function nextDueTouch(createdAt: Date, fired: Set<string>, now: number): TouchKey | null {
  for (const t of TOUCHES) {
    if (fired.has(t.key)) continue;
    return createdAt.getTime() + t.days * DAY_MS <= now ? t.key : null;
  }
  return null;
}

/** Current hour (0-23) in America/New_York (Cleveland) — quiet-hours guard. */
function getClevelandHour(): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })
    .formatToParts(new Date()).find((p) => p.type === "hour")?.value ?? "0";
  const n = parseInt(part, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

export async function runFollowupCadence(): Promise<RunResult> {
  if (!process.env.VAPI_API_KEY) return { recordsProcessed: 0, details: "Skipped · VAPI_API_KEY missing" };
  if (process.env.FEATURE_FOLLOWUP_CADENCE !== "1") return { recordsProcessed: 0, details: "Skipped · FEATURE_FOLLOWUP_CADENCE != '1' (off by default)" };
  // Routed through the shared chokepoint rather than reading the env directly:
  // a pin naming a RETIRED assistant returns null here, so this rail skips
  // instead of placing real outbound calls with a retired assistant. Skipping
  // an unattended customer-facing rail is the safe direction; misdialling is not.
  const { followUpAssistantIdOrNull } = await import("../../services/vapi");
  if (!followUpAssistantIdOrNull()) {
    return { recordsProcessed: 0, details: "Skipped · VAPI_FOLLOWUP_ASSISTANT_ID missing or retired" };
  }
  // wave-145 · resolve the outbound number (env override → else auto-lookup
  // the shop's VAPI line). Was a bare VAPI_PHONE_NUMBER_ID env check that
  // skipped forever because the var was never set.
  const { resolveVapiPhoneNumberId } = await import("../../services/vapi");
  if (!(await resolveVapiPhoneNumberId())) return { recordsProcessed: 0, details: "Skipped · no VAPI outbound number resolvable" };

  const dryRun = process.env.FOLLOWUP_CADENCE_DRY_RUN === "1";
  const dailyCap = Math.min(Number(process.env.FOLLOWUP_CADENCE_DAILY_CAP) || 10, 50);

  // Quiet-hours guard (skipped in dry-run so you can preview anytime).
  const hour = getClevelandHour();
  if (!dryRun && (hour < 9 || hour >= 18)) {
    return { recordsProcessed: 0, details: `Outside call window (Cleveland ${hour}:00 · window 9–18)` };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // `customers` was imported only for the local opt-out query that
  // loadSuppressionIndex now owns — see the block below.
  const { bookings, voiceFollowups } = await import("../../../drizzle/schema");
  const now = Date.now();
  const floor = new Date(now - FLOOR_DAYS * DAY_MS);
  const minAge = new Date(now - 7 * DAY_MS); // must be ≥7d old to have any touch due

  // 1. Completed bookings in the window.
  let candidates: Array<{ id: number; name: string; phone: string; service: string; createdAt: Date }> = [];
  try {
    candidates = await d.select({
      id: bookings.id,
      name: bookings.name,
      phone: bookings.phone,
      service: bookings.service,
      createdAt: bookings.createdAt,
    }).from(bookings).where(and(
      eq(bookings.status, "completed"),
      gte(bookings.createdAt, floor),
      lte(bookings.createdAt, minAge),
    )).orderBy(bookings.createdAt);
  } catch (err) {
    // 2026-09-01 (audit F-9): rethrow so the run is recorded as failed.
    log.error("[followup-cadence] candidate query failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  if (candidates.length === 0) return { recordsProcessed: 0, details: "No completed bookings in window" };

  // 2. Touches already fired for these bookings (+ how many fired today, for the cap).
  const ids = candidates.map((b) => b.id);
  const fired = new Map<number, Set<string>>();
  let firedToday = 0;
  try {
    const rows = await d.select({
      bookingId: voiceFollowups.bookingId,
      touch: voiceFollowups.touch,
      createdAt: voiceFollowups.createdAt,
    }).from(voiceFollowups).where(inArray(voiceFollowups.bookingId, ids));
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    for (const r of rows) {
      if (!fired.has(r.bookingId)) fired.set(r.bookingId, new Set());
      fired.get(r.bookingId)!.add(r.touch);
      if (r.createdAt && r.createdAt >= todayStart) firedToday++;
    }
  } catch (err) {
    // 2026-09-01 (audit F-9): rethrow — an unreadable fired-touch set must not
    // read as a clean run (it is the guard against re-texting).
    log.error("[followup-cadence] fired-touch query failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  /**
   * 3. Suppression, from the SAME index the SMS path uses — and FAILING CLOSED.
   *
   * What was here until 2026-09-16 was the SECOND copy of the four-line bug
   * `voiceRecovery.ts` had, found by sweeping every caller of
   * `placeVapiOutboundCall` instead of stopping at the first one:
   *
   *   const optedOut = new Set<string>();
   *   try { ...select customers where smsOptOut = 1... }
   *   catch (err) { log.warn("opt-out query failed (proceeding without)") }
   *
   * It read ONLY `customers.smsOptOut`, so it missed `sms_preferences` (what
   * `persistOptOutPreference` actually writes), the inbound message log (the
   * 2026-07-20 ground truth: 10 numbers had said STOP and only 5 had a
   * preference row) and carrier block notices. And "proceeding without" is an
   * EMPTY set, which reads as "nobody opted out" — so an unreadable list meant
   * every candidate got dialled. The log line said so out loud.
   *
   * ⚠ The file already applied the right reasoning one block up: the
   * fired-touch query RETHROWS, because "an unreadable fired-touch set must not
   * read as a clean run (it is the guard against re-texting)". The re-contact
   * guard failed closed and the CONSENT guard failed open, twelve lines apart.
   *
   * This lane is squarely marketing, not transactional — the header says these
   * touches "ask for the referral, and pull the customer back for the next
   * job", and the safety block above promises "SMS-opted-out customers skipped"
   * under the operator's no-spam bar. Fixing this keeps a promise the file
   * already makes; it is not a new policy decision.
   *
   * `stale` is refused too, for the reason spelled out in voiceRecovery.ts:
   * sms.ts's `stale()` never consults `optOutCacheLoadedAt`, so a stale
   * snapshot's age is UNBOUNDED, not the 5-minute TTL.
   */
  const { loadSuppressionIndex } = await import("../../sms");
  const suppression = await loadSuppressionIndex();
  if (!suppression.ok) {
    log.error("[followup-cadence] suppression index unreadable — placing NO calls", {
      reason: suppression.reason,
      candidates: candidates.length,
      errorId: "FOLLOWUP_CADENCE_SUPPRESSION_UNREADABLE",
    });
    throw new Error(`followup cadence aborted — suppression index unreadable: ${suppression.reason}`);
  }
  if (suppression.stale) {
    log.error("[followup-cadence] suppression index is STALE (refresh failed, age unbounded) — placing NO calls", {
      suppressed: suppression.phones.size,
      candidates: candidates.length,
      errorId: "FOLLOWUP_CADENCE_SUPPRESSION_STALE",
    });
    throw new Error(
      "followup cadence aborted — suppression index is STALE: the last refresh failed, so its age is unbounded and an opt-out recorded since is invisible",
    );
  }
  const optedOut = suppression.phones;

  // 4. Place calls · one touch per booking, hard daily cap.
  const { placeVapiOutboundCall } = await import("../../services/vapi");
  let placed = 0, skipped = 0, failed = 0;
  const preview: string[] = [];

  for (const b of candidates) {
    if (firedToday + placed >= dailyCap) {
      log.info(`[followup-cadence] hit daily cap ${dailyCap}, stopping early`);
      break;
    }
    const touch = nextDueTouch(b.createdAt, fired.get(b.id) ?? new Set(), now);
    if (!touch) continue;

    const phone10 = b.phone.replace(/\D/g, "").slice(-10);
    if (phone10.length !== 10) { skipped++; continue; }
    if (optedOut.has(phone10)) { skipped++; continue; }

    const firstName = b.name.split(" ")[0] || b.name;
    const e164 = `+1${phone10}`;

    if (dryRun) {
      preview.push(`${touch} → ${firstName} (...${phone10.slice(-4)}) · ${b.service}`);
      // Reserve the touch within this preview so the same booking + cap behave realistically.
      if (!fired.has(b.id)) fired.set(b.id, new Set());
      fired.get(b.id)!.add(touch);
      placed++;
      continue;
    }

    // At-most-once claim · INSERT before the call. The voice_followups
    // UNIQUE(bookingId, touch) means an overlapping run or a retry can't
    // double-dial — a duplicate INSERT throws and we treat it as "already done".
    try {
      await d.insert(voiceFollowups).values({
        bookingId: b.id, touch, phone: e164, customerName: firstName, status: "called",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isDuplicateKeyError(err)) { skipped++; continue; }
      log.warn(`[followup-cadence] claim failed booking ${b.id} ${touch}`, { error: msg });
      failed++; continue;
    }

    const voicemailMsg = `Hey ${firstName}, Nick's Tire \u2014 checking in after your ${b.service}. Everything running smooth, no need to call back. Something feels off, hit us at 216-862-0005. Drive safe.`;

    const call = await placeVapiOutboundCall({
      customerNumber: e164,
      variableValues: { name: firstName, lastService: b.service },
      voicemailMessage: voicemailMsg,
      maxDurationSeconds: 180,
    });

    if (call.success && call.callId) {
      await d.update(voiceFollowups).set({ vapiCallId: call.callId })
        .where(and(eq(voiceFollowups.bookingId, b.id), eq(voiceFollowups.touch, touch)));
      placed++;
      log.info(`[followup-cadence] placed ${touch} call ${call.callId} for booking ${b.id}`);
    } else {
      // Claimed-then-failed is TERMINAL (the UNIQUE blocks a retry) — better to
      // miss one touch than risk a double-dial. Other touches still fire.
      await d.update(voiceFollowups).set({ status: "failed", errorMessage: (call.error ?? "unknown").slice(0, 500) })
        .where(and(eq(voiceFollowups.bookingId, b.id), eq(voiceFollowups.touch, touch)));
      failed++;
      log.warn(`[followup-cadence] place failed booking ${b.id} ${touch}`, { error: call.error });
    }

    await new Promise((r) => setTimeout(r, 1000)); // throttle · stays under VAPI burst limits
  }

  if (dryRun) {
    log.info(`[followup-cadence] DRY RUN · would place ${placed} call(s)`, { preview: preview.slice(0, 25) });
    return {
      recordsProcessed: 0,
      details: `DRY RUN · would call ${placed}${preview.length ? `: ${preview.slice(0, 10).join(" | ")}${preview.length > 10 ? ` (+${preview.length - 10} more)` : ""}` : " (none due)"}`,
    };
  }

  return { recordsProcessed: placed, details: `placed=${placed} skipped=${skipped} failed=${failed} cap=${dailyCap}` };
}

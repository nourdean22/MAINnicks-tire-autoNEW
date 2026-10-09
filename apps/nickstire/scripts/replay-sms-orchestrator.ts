/**
 * SMS Operating System Replay Engine
 * Dry-runs historical/mock events through the central orchestrator to check safety and mismatch copy.
 *
 * 2026-10-09 (autoresearch audit, SMS replay isolation). This script READS real
 * customer rows (up to 50 sms_orchestrations per event type) from whatever
 * DATABASE_URL the shell carries, and every nickstire worktree carries prod's.
 * It used to also WRITE: REPLAY_DRY_RUN faked only sendSms, so each replayed
 * event inserted a `sent` orchestration row with the real phone and cooldownKey
 * (the live cooldown reads those), and replayed STOP / START / YES / CANCEL
 * rewrote opt-outs, consent, bookings and reminders. Now:
 *
 *   1. it refuses to start without --i-understand-this-reads-production;
 *   2. a startup self-test proves the replay scope skips an effect in THIS
 *      process (exit 1 if not);
 *   3. every orchestrateSms call runs inside runInSmsReplayScope with a
 *      recorder, so every write / send / notify is skipped and listed;
 *   4. globalThis.fetch denies everything for the run (no Telegram, email,
 *      webhook or model call; model-backed drafts therefore fail closed and
 *      are counted in their own "Failed" column, not as no-sends), restored
 *      afterwards;
 *   5. READ-ONLY post-checks, each printed with exactly what it measured:
 *      a. sms_orchestrations rows carrying the fake replay sid created since
 *         start (catches only a leaked FINAL write of a faked send);
 *      b. sms_orchestrations and nickgpt_drafts row counts for the replayed
 *         phones, taken before and after the run. A new row for a fictional
 *         backfill number is a leak; a new row for a real replayed number may
 *         be live traffic and is reported as UNKNOWN.
 *      Leaked or unknown exits 1. A zero here does not cover customers,
 *      bookings or the consent ledger; the replay scope and its tests do.
 *   6. it exits explicitly (server/sms.ts holds an interval open forever).
 *
 * Known difference from production, inherent to skipping effects: a replay
 * sees the state from BEFORE each event. An inbound opt-in (START, UNSTOP, or
 * YES from an SMS-suppressed number) ran its opt-in first in production and got
 * a reply; the replay skips that opt-in, still reads the number as opted out
 * and returns blocked / customer_opted_out. Those rows get their own column
 * ("Opt-in, pre-event state"), never No-Sends. A YES from an opted-out number
 * that is not suppressed is blocked in production too and lands there as well.
 *
 * The orchestrator itself logs body lengths, not bodies, during a replay; this
 * script prints bodies cut to 120 characters and phones as a 4-digit suffix.
 * Testable logic lives in server/services/smsReplayScope.ts (scripts/ is
 * outside the typecheck project). Usage, from apps/nickstire:
 *   pnpm exec tsx scripts/replay-sms-orchestrator.ts --i-understand-this-reads-production
 */

import { orchestrateSms } from "../server/services/smsOrchestrator";
import {
  REPLAY_PHONE_TABLES,
  REPLAY_PRODUCTION_READ_ACK_FLAG,
  createSmsEffectRecorder,
  evaluateReplayIsolation,
  flushThenExit,
  hasProductionReadAck,
  installDenyAllFetch,
  isSmsReplayActive,
  readLeakCount,
  replayLeakCheckQuery,
  replayOutcomeBucket,
  replayPhoneCountQuery,
  replayPhoneKeys,
  replayScopeSelfTest,
  runInSmsReplayScope,
  truncateForPrint,
  type ReplayPhoneDelta,
} from "../server/services/smsReplayScope";
import { getDbTyped } from "../server/db";
import { smsOrchestrations } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { createLogger } from "../server/lib/logger";

const log = createLogger("replay-engine");

// Belt and braces: inside the orchestrator this flag now skips EVERY effect,
// not just the send. The per-call replay scope below is the primary guard.
process.env.REPLAY_DRY_RUN = "true";

interface ReplayStats {
  total: number;
  autoSendCount: number;
  draftOnlyCount: number;
  noSendCount: number;
  /** status "failed": model blocked by the deny-all fetch, or an internal error. */
  failedCount: number;
  /** Inbound opt-in keyword read as blocked: the replay skipped the opt-in (see header). */
  optInPreEventCount: number;
  mismatchCount: number;
  stalePriceCount: number;
  /** Assumed per-job dollar figures for auto-sent bodies. Illustrative only: not measured, not revenue. */
  illustrativeOpportunityValue: number;
  errors: number;
  mismatches: Array<{
    phone: string;
    legacy: string;
    orch: string;
  }>;
}

const EVENT_TYPES = [
  "inbound_sms",
  "vapi_forwarded_call_followup",
  "vapi_confirmation",
  "stale_lead_followup",
  "abandoned_form_recovery",
  "after_hours_capture"
] as const;

/** Hard-coded assumptions, kept from the original script. Never report these as revenue. */
function illustrativeValueFor(body: string): number {
  const txt = body.toLowerCase();
  if (txt.includes("tire")) return 60;
  if (txt.includes("brake")) return 298;
  if (txt.includes("oil")) return 80;
  if (txt.includes("diagnostic") || txt.includes("check")) return 79;
  return 150;
}

/** Fictional 216-555 numbers (2165551000-2165551549) for a fresh database. */
function backfillEvents(eventType: (typeof EVENT_TYPES)[number], needed: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < needed; i++) {
    const mockPhone = `216555${String(1000 + i + EVENT_TYPES.indexOf(eventType) * 100)}`;
    if (eventType === "inbound_sms") {
      out.push({
        type: "inbound_sms",
        phone: mockPhone,
        body: i % 3 === 0 ? "what are your hours?" : i % 3 === 1 ? "how much for used tires?" : "need to cancel my visit",
        conversationId: 9999 + i
      });
    } else if (eventType === "vapi_forwarded_call_followup") {
      out.push({ type: "vapi_forwarded_call_followup", phone: mockPhone, vapiCallId: `vc_${i}` });
    } else if (eventType === "vapi_confirmation") {
      out.push({
        type: "vapi_confirmation",
        phone: mockPhone,
        summary: "Customer needs 4 used tires installed tomorrow",
        vapiCallId: `vc_${i}`,
        mapLink: "https://nickstire.org/contact"
      });
    } else if (eventType === "stale_lead_followup") {
      out.push({ type: "stale_lead_followup", phone: mockPhone, leadId: 5000 + i });
    } else if (eventType === "abandoned_form_recovery") {
      out.push({ type: "abandoned_form_recovery", phone: mockPhone, name: "Alex", formType: "tire_quote" });
    } else if (eventType === "after_hours_capture") {
      out.push({ type: "after_hours_capture", phone: mockPhone, name: "Jordan", captureType: "callback" });
    }
  }
  return out;
}

function countOutcome(
  stats: ReplayStats,
  result: { status: string; shouldAutoSend: boolean; statusReason?: string | null },
  event: { type: string; body?: unknown },
) {
  const bucket = replayOutcomeBucket(result, event);
  if (bucket === "failed") stats.failedCount++;
  else if (bucket === "opt_in_pre_event") stats.optInPreEventCount++;
  else if (bucket === "auto_send") stats.autoSendCount++;
  else if (bucket === "draft_only") stats.draftOnlyCount++;
  else stats.noSendCount++;
}

async function main(): Promise<number> {
  if (!hasProductionReadAck(process.argv)) {
    log.error(`Refusing to start: this replay reads real customer rows from the database in DATABASE_URL (production in every worktree). Re-run with ${REPLAY_PRODUCTION_READ_ACK_FLAG} if that is intended.`);
    return 2;
  }

  const selfTest = replayScopeSelfTest();
  if (!selfTest.ok) {
    log.error("Replay scope self-test FAILED: effects would not be isolated. Not running.", { reason: selfTest.reason });
    return 1;
  }
  // The env flag is the second guard: even an effect reached outside a scope
  // (a lost async context) is skipped while it holds, and the first such skip
  // logs one SMS_REPLAY_DRY_RUN_ENV_ACTIVE line, so a lost context is visible.
  if (!isSmsReplayActive()) {
    log.error("REPLAY_DRY_RUN did not take effect in this process. Not running.");
    return 1;
  }

  log.info("Starting SMS Orchestrator Replay Engine...");
  const db = await getDbTyped();
  if (!db) {
    log.error("Failed to connect to database");
    return 1;
  }

  // 1. READ the historical rows (up to 50 per type) and build the backfill.
  const plan: Array<{ eventType: (typeof EVENT_TYPES)[number]; records: any[]; backfilled: any[] }> = [];
  for (const eventType of EVENT_TYPES) {
    const records = await db.select()
      .from(smsOrchestrations)
      .where(eq(smsOrchestrations.eventType, eventType))
      .orderBy(desc(smsOrchestrations.createdAt))
      .limit(50);
    log.info(`Loaded ${records.length} historical records for ${eventType} from db.`);
    plan.push({ eventType, records, backfilled: backfillEvents(eventType, 50 - records.length) });
  }

  // 2. READ-ONLY baseline counts for the phones about to be replayed.
  const fictionalKeys = replayPhoneKeys(plan.flatMap((p) => p.backfilled.map((e) => e.phone)));
  const realKeys = replayPhoneKeys(plan.flatMap((p) => p.records.map((r) => r.customerPhone)));
  const countRows = async (table: (typeof REPLAY_PHONE_TABLES)[number], keys: string[]): Promise<number | null> => {
    if (keys.length === 0) return 0;
    try {
      return readLeakCount(await db.execute(replayPhoneCountQuery(table, keys)));
    } catch (err) {
      log.error("Replay phone count failed", { table, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  const phoneDeltas: ReplayPhoneDelta[] = [];
  for (const table of REPLAY_PHONE_TABLES) {
    phoneDeltas.push({ table, kind: "fictional", phoneCount: fictionalKeys.length, before: await countRows(table, fictionalKeys), after: null });
    phoneDeltas.push({ table, kind: "real", phoneCount: realKeys.length, before: await countRows(table, realKeys), after: null });
  }

  const startedAt = Date.now();
  const recorder = createSmsEffectRecorder();
  const replay = <T,>(fn: () => Promise<T>) => runInSmsReplayScope(fn, recorder);
  const fetchGuard = installDenyAllFetch();

  const reports: Record<string, ReplayStats> = {};

  // 3. Replay, with every effect skipped and recorded.
  try {
    for (const { eventType, records, backfilled } of plan) {
      log.info(`Replaying event type: ${eventType}...`);

      const stats: ReplayStats = {
        total: 0,
        autoSendCount: 0,
        draftOnlyCount: 0,
        noSendCount: 0,
        failedCount: 0,
        optInPreEventCount: 0,
        mismatchCount: 0,
        stalePriceCount: 0,
        illustrativeOpportunityValue: 0,
        errors: 0,
        mismatches: []
      };

      // Run historical database records
      for (const rec of records) {
        stats.total++;
        try {
          const mockEvent: any = {
            type: rec.eventType,
            phone: rec.customerPhone,
          };
          if (rec.eventType === "inbound_sms") {
            mockEvent.body = rec.messageBody;
            mockEvent.conversationId = rec.relatedConversationId || 101;
          } else if (rec.eventType === "vapi_confirmation") {
            mockEvent.summary = "Vapi call booking recap";
          } else if (rec.eventType === "stale_lead_followup") {
            mockEvent.leadId = rec.relatedLeadId || 1;
          } else if (rec.eventType === "booking_reminder") {
            mockEvent.reminderType = "confirmation-request";
          }

          const result = await replay(() => orchestrateSms(mockEvent));
          countOutcome(stats, result, mockEvent);

          // Detect stale price (should quote $60 installed for tires, never the old $25 web quote)
          if (result.body.includes("$25") && rec.eventType.includes("tire")) {
            stats.stalePriceCount++;
          }

          // Compare legacy vs orchestrator body
          const legacyComparison = result.body !== rec.legacyMessageBody;
          if (legacyComparison && rec.legacyMessageBody) {
            stats.mismatchCount++;
            stats.mismatches.push({
              phone: rec.customerPhone,
              legacy: rec.legacyMessageBody,
              orch: result.body
            });
          }

          if (result.shouldAutoSend) stats.illustrativeOpportunityValue += illustrativeValueFor(result.body);
        } catch (err) {
          stats.errors++;
        }
      }

      // Run backfilled mock events
      for (const mockEvent of backfilled) {
        stats.total++;
        try {
          const result = await replay(() => orchestrateSms(mockEvent));
          countOutcome(stats, result, mockEvent);

          // Detect stale price
          if (result.body.includes("$25") && eventType.includes("tire")) {
            stats.stalePriceCount++;
          }

          if (result.shouldAutoSend) stats.illustrativeOpportunityValue += illustrativeValueFor(result.body);
        } catch (err) {
          stats.errors++;
        }
      }

      reports[eventType] = stats;
    }
  } finally {
    fetchGuard.restore();
  }

  // 4. READ-ONLY post-checks. The sid window runs from start to now plus a
  // minute of clock slack, computed in SQL (see replayLeakCheckQuery).
  const windowSeconds = (Date.now() - startedAt) / 1000 + 60;
  let sidRows: number | null = null;
  try {
    sidRows = readLeakCount(await db.execute(replayLeakCheckQuery(windowSeconds)));
  } catch (err) {
    log.error("Post-run sid check could not run", { error: err instanceof Error ? err.message : String(err) });
  }
  for (const d of phoneDeltas) {
    d.after = await countRows(d.table, d.kind === "fictional" ? fictionalKeys : realKeys);
  }
  const isolation = evaluateReplayIsolation({ sidRows, windowSeconds, phoneDeltas });

  // Print Summary Table
  console.log("\n==========================================================================");
  console.log("             SMS ORCHESTRATOR DRY-RUN REPLAY TESTING ENGINE REPORT         ");
  console.log("==========================================================================");
  console.table(
    Object.entries(reports).map(([type, s]) => ({
      "Event Type": type,
      "Total Run": s.total,
      "Auto-Sends": s.autoSendCount,
      "Draft-Only": s.draftOnlyCount,
      "No-Sends": s.noSendCount,
      "Failed (incl. model blocked)": s.failedCount,
      "Opt-in, pre-event state": s.optInPreEventCount,
      "Mismatches": s.mismatchCount,
      "Stale Prices": s.stalePriceCount,
      "Illustrative $ (assumed, not measured)": `$${s.illustrativeOpportunityValue}`,
      "Errors": s.errors
    }))
  );
  console.log(
    'Note: "Opt-in, pre-event state" = inbound START / UNSTOP / YES replayed as blocked (customer_opted_out). ' +
      "The replay skips the opt-in write, so it reads the opt-out from BEFORE the event; production ran the opt-in first and replied. " +
      "A YES from an opted-out number that is not SMS-suppressed is blocked in production too and is counted here as well."
  );

  console.log("\n--------------------------------------------------------------------------");
  console.log("                       SAMPLE COPY MISMATCH REPORTS                       ");
  console.log("--------------------------------------------------------------------------");
  for (const [type, s] of Object.entries(reports)) {
    if (s.mismatches.length > 0) {
      const suffix = s.mismatches[0].phone.slice(-4);
      console.log(`\n[${type}] Sample Mismatch:`);
      console.log(`- Customer Suffix: ...${suffix}`);
      console.log(`- Legacy Sent:     "${truncateForPrint(s.mismatches[0].legacy)}"`);
      console.log(`- Orchestrator:    "${truncateForPrint(s.mismatches[0].orch)}"`);
    }
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log("              ISOLATION RECEIPT (effects skipped, never run)              ");
  console.log("--------------------------------------------------------------------------");
  console.table(Object.entries(recorder.counts()).map(([effect, n]) => ({ "Skipped effect": effect, "Count": n })));
  const blockedByHost: Record<string, number> = {};
  for (const host of fetchGuard.blockedHosts) blockedByHost[host] = (blockedByHost[host] ?? 0) + 1;
  console.log(`Outbound fetches blocked: ${fetchGuard.blockedHosts.length}`, blockedByHost);
  console.log(`Post-run leak checks (read-only), verdict ${isolation.verdict.toUpperCase()}:`);
  for (const line of isolation.lines) console.log(`- ${line}`);
  console.log("\n==========================================================================\n");

  if (isolation.verdict === "leaked") {
    log.error("Replay LEAKED: rows were written during this run. See the post-run checks above.");
    return 1;
  }
  if (isolation.verdict === "unknown") {
    log.error("Replay isolation is UNKNOWN (an unreadable count, or new rows for real replayed numbers that may be live traffic). Treating as failed.");
    return 1;
  }
  return 0;
}

main()
  .then((code) => flushThenExit(code))
  .catch((err) => {
    log.error("Replay Engine script crashed", err);
    flushThenExit(1);
  });
// Co-Authored-By: Antigravity <noreply@anthropic.com>

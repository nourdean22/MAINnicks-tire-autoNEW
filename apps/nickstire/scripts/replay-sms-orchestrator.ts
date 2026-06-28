/**
 * SMS Operating System Replay Engine
 * Dry-runs historical/mock events through the central orchestrator to check safety, mismatch copy, and revenue opportunity.
 */

import { orchestrateSms } from "../server/services/smsOrchestrator";
import { getDbTyped } from "../server/db";
import { smsOrchestrations } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { createLogger } from "../server/lib/logger";

const log = createLogger("replay-engine");

// Force Dry-Run Safety!
process.env.REPLAY_DRY_RUN = "true";

interface ReplayStats {
  total: number;
  autoSendCount: number;
  draftOnlyCount: number;
  noSendCount: number;
  mismatchCount: number;
  stalePriceCount: number;
  revenueEst: number;
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

async function main() {
  log.info("Starting SMS Orchestrator Replay Engine...");
  const db = await getDbTyped();
  if (!db) {
    log.error("Failed to connect to database");
    process.exit(1);
  }

  const reports: Record<string, ReplayStats> = {};

  for (const eventType of EVENT_TYPES) {
    log.info(`Replaying event type: ${eventType}...`);
    
    // 1. Load up to 50 historical entries
    let records = await db.select()
      .from(smsOrchestrations)
      .where(eq(smsOrchestrations.eventType, eventType))
      .orderBy(desc(smsOrchestrations.createdAt))
      .limit(50);

    log.info(`Loaded ${records.length} historical records for ${eventType} from db.`);

    // 2. Backfill with realistic mock events if database is fresh
    const needed = 50 - records.length;
    const backfilledEvents: any[] = [];
    
    for (let i = 0; i < needed; i++) {
      const mockPhone = `216555${String(1000 + i + EVENT_TYPES.indexOf(eventType) * 100)}`;
      if (eventType === "inbound_sms") {
        backfilledEvents.push({
          type: "inbound_sms",
          phone: mockPhone,
          body: i % 3 === 0 ? "what are your hours?" : i % 3 === 1 ? "how much for used tires?" : "need to cancel my visit",
          conversationId: 9999 + i
        });
      } else if (eventType === "vapi_forwarded_call_followup") {
        backfilledEvents.push({
          type: "vapi_forwarded_call_followup",
          phone: mockPhone,
          vapiCallId: `vc_${i}`
        });
      } else if (eventType === "vapi_confirmation") {
        backfilledEvents.push({
          type: "vapi_confirmation",
          phone: mockPhone,
          summary: "Customer needs 4 used tires installed tomorrow",
          vapiCallId: `vc_${i}`,
          mapLink: "https://nickstire.org/contact"
        });
      } else if (eventType === "stale_lead_followup") {
        backfilledEvents.push({
          type: "stale_lead_followup",
          phone: mockPhone,
          leadId: 5000 + i
        });
      } else if (eventType === "abandoned_form_recovery") {
        backfilledEvents.push({
          type: "abandoned_form_recovery",
          phone: mockPhone,
          name: "Alex",
          formType: "tire_quote"
        });
      } else if (eventType === "after_hours_capture") {
        backfilledEvents.push({
          type: "after_hours_capture",
          phone: mockPhone,
          name: "Jordan",
          captureType: "callback"
        });
      }
    }

    const stats: ReplayStats = {
      total: 0,
      autoSendCount: 0,
      draftOnlyCount: 0,
      noSendCount: 0,
      mismatchCount: 0,
      stalePriceCount: 0,
      revenueEst: 0,
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

        const result = await orchestrateSms(mockEvent);

        // Analyze stats
        if (result.shouldAutoSend) stats.autoSendCount++;
        else if (result.status === "drafted") stats.draftOnlyCount++;
        else stats.noSendCount++;

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

        // Estimate revenue influence
        if (result.shouldAutoSend) {
          let rev = 150; // default
          const txt = result.body.toLowerCase();
          if (txt.includes("tire")) rev = 60;
          else if (txt.includes("brake")) rev = 298;
          else if (txt.includes("oil")) rev = 80;
          else if (txt.includes("diagnostic") || txt.includes("check")) rev = 79;
          stats.revenueEst += rev;
        }
      } catch (err) {
        stats.errors++;
      }
    }

    // Run backfilled mock events
    for (const mockEvent of backfilledEvents) {
      stats.total++;
      try {
        const result = await orchestrateSms(mockEvent);

        if (result.shouldAutoSend) stats.autoSendCount++;
        else if (result.status === "drafted") stats.draftOnlyCount++;
        else stats.noSendCount++;

        // Detect stale price
        if (result.body.includes("$25") && eventType.includes("tire")) {
          stats.stalePriceCount++;
        }

        // Estimate revenue
        if (result.shouldAutoSend) {
          let rev = 150;
          const txt = result.body.toLowerCase();
          if (txt.includes("tire")) rev = 60;
          else if (txt.includes("brake")) rev = 298;
          else if (txt.includes("oil")) rev = 80;
          else if (txt.includes("diagnostic") || txt.includes("check")) rev = 79;
          stats.revenueEst += rev;
        }
      } catch (err) {
        stats.errors++;
      }
    }

    reports[eventType] = stats;
  }

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
      "Mismatches": s.mismatchCount,
      "Stale Prices": s.stalePriceCount,
      "Est. Revenue Opportunity": `$${s.revenueEst}`,
      "Errors": s.errors
    }))
  );

  console.log("\n--------------------------------------------------------------------------");
  console.log("                       SAMPLE COPY MISMATCH REPORTS                       ");
  console.log("--------------------------------------------------------------------------");
  for (const [type, s] of Object.entries(reports)) {
    if (s.mismatches.length > 0) {
      const suffix = s.mismatches[0].phone.slice(-4);
      console.log(`\n[${type}] Sample Mismatch:`);
      console.log(`- Customer Suffix: ...${suffix}`);
      console.log(`- Legacy Sent:     "${s.mismatches[0].legacy}"`);
      console.log(`- Orchestrator:    "${s.mismatches[0].orch}"`);
    }
  }
  console.log("\n==========================================================================\n");
}

main().catch((err) => {
  log.error("Replay Engine script crashed", err);
});
// Co-Authored-By: Antigravity <noreply@anthropic.com>
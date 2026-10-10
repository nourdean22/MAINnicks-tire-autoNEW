/**
 * Gmail → Brain Memory Pipeline
 *
 * This module is designed to be called from a cron or scheduled task.
 * It uses the Gmail MCP tools (available in Claude Code/Cowork sessions)
 * to scan the inbox and create brain memories, leads, or tasks.
 *
 * Since MCP tools can't be called from server-side Next.js code directly,
 * this provides the processing logic that a Cowork session or scheduled
 * Claude agent can use to push data into statenour-os.
 *
 * Usage from a Claude session:
 *   1. Use gmail_search_messages to find actionable emails
 *   2. Call processGmailItems() with the results
 *   3. It creates brain memories, leads, or tasks as appropriate
 */

import { prisma } from "@/lib/prisma";
import { gmailSourceUrl, intakeExternalMemory } from "@/lib/brain/external-memory-intake";

// 2026-10-10 · audit 05-M9. Email text is written by whoever sent it. It
// used to land via remember() with source "manual" (= OPERATOR, recalled as
// "you stated") or "device_analysis"; it now takes the external-content door
// (quarantine first). The "email:" prefix classifies as EXTERNAL_CONTENT.
const SOURCE = "email:gmail-sync";

/** One email into memory through the policy layer. True when it was written
 *  (stored, or already committed from review); false when quarantined. */
async function intakeEmail(
  item: GmailItem,
  category: string,
  key: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const r = await intakeExternalMemory({
    category,
    key,
    content,
    source: SOURCE,
    sourceType: "gmail_sync",
    sourceUrl: gmailSourceUrl(item.id),
    metadata,
  });
  return r.outcome !== "quarantined";
}

export interface GmailItem {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  category: "invoice" | "customer_request" | "appointment" | "follow_up" | "general";
}

/**
 * Process Gmail items into statenour-os entities.
 * Called from a sync endpoint that a Claude agent can POST to.
 */
export async function processGmailItems(items: GmailItem[]): Promise<{
  memoriesCreated: number;
  leadsCreated: number;
  actionsCreated: number;
  /** Held in the review inbox (/system/inbox), not yet memory. */
  quarantined: number;
}> {
  let memoriesCreated = 0;
  let leadsCreated = 0;
  let actionsCreated = 0;
  let quarantined = 0;

  for (const item of items) {
    switch (item.category) {
      case "invoice": {
        const written = await intakeEmail(
          item,
          "insight",
          `email_invoice_${item.id}`,
          `Invoice from ${item.from}: ${item.subject}. ${item.snippet.slice(0, 200)}`,
          { emailId: item.id, date: item.date },
        );
        if (written) memoriesCreated++;
        else quarantined++;
        break;
      }
      case "customer_request": {
        // v10.0.59 · Wave A part 2 · pre-fix this was a dead
        // `Promise.resolve(null)` placeholder that never actually
        // created a lead. Lead persistence lives on nickstire admin
        // (autonicks-side createLead throws ServiceError(501) per
        // v10.0.53). We capture the customer-request signal as a
        // brainMemory note so the operator can review + manually
        // triage on nickstire admin. Task auto-create dropped —
        // Task model has many required fields (mission, effort,
        // roiScore, finishCondition...) that can't be inferred from
        // an email subject; the brainMemory entry surfaces in
        // search results when the operator triages the inbox.
        const written = await intakeEmail(
          item,
          "lead_intent",
          `email_lead_${item.id}`,
          `Customer-request email from ${item.from} — Subject: ${item.subject} — Snippet: ${item.snippet.slice(0, 240)}. Date: ${item.date}.`,
          { emailId: item.id, from: item.from, subject: item.subject, date: item.date },
        );
        if (written) leadsCreated++;
        else quarantined++;
        break;
      }
      case "appointment": {
        await prisma.scheduledAction.create({
          data: {
            actionType: "follow-up",
            entityType: "lead",
            entityId: "email",
            description: `${item.subject} — from ${item.from}`,
            scheduledFor: new Date(item.date),
            status: "pending",
            metadata: { emailId: item.id } as any,
          },
        });
        actionsCreated++;
        break;
      }
      case "follow_up": {
        const written = await intakeEmail(
          item,
          "routine",
          `email_followup_${item.id}`,
          `Follow up needed: ${item.subject} from ${item.from}`,
          { emailId: item.id },
        );
        if (written) memoriesCreated++;
        else quarantined++;
        break;
      }
      default: {
        // General — just create a brain memory
        const written = await intakeEmail(item, "insight", `email_${item.id}`, `Email: ${item.subject} from ${item.from}`);
        if (written) memoriesCreated++;
        else quarantined++;
      }
    }
  }

  // v10.0.59 · sync log persisted as auditEvent so /system/errors +
  // sync-history dashboards can render run-by-run trend.
  await prisma.auditEvent
    .create({
      data: {
        actor: "gmail-sync",
        eventType: "sync_run",
        detail: `Processed ${items.length} email(s): ${memoriesCreated} memories, ${leadsCreated} lead-intent, ${actionsCreated} actions, ${quarantined} held for review.`,
        payload: {
          memoriesCreated,
          leadsCreated,
          actionsCreated,
          quarantined,
          itemCount: items.length,
        } as any,
      },
    })
    .catch(() => undefined);

  return { memoriesCreated, leadsCreated, actionsCreated, quarantined };
}

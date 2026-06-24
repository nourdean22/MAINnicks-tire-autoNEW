/**
 * Central SMS Operating System & Decision Engine
 */

import { getDbTyped } from "../db";
import {
  smsOrchestrations,
  nickgptDrafts,
  bookings,
  leads,
  customers,
  callbackRequests,
  smsConversations,
  smsMessages,
  vapiCallLogs,
  algEstimates,
  appSecretKv,
  invoices
} from "../../drizzle/schema";
import { sendSms } from "../sms";
import { parseSmsResponse, executeAutoAction } from "./smsResponseParser";
import { draftSmsReply } from "./nickgpt-client";
import { classifyIntent } from "./classifiers";
import { isEnabled } from "./featureFlags";
import { BUSINESS } from "@shared/business";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";
import { eq, and, desc, gte, sql, like, or } from "drizzle-orm";
import { getTemplateVariant, assignVariantWithExperiment, REPLY_CONFIGS } from "./smsMessageCatalog";

const log = createLogger("sms-orchestrator");

export type SmsOrchestratorEvent =
  | { type: "inbound_sms"; phone: string; body: string; conversationId: number }
  | { type: "vapi_confirmation"; phone: string; summary: string; mapLink?: string; vapiCallId?: string }
  | { type: "vapi_forwarded_call_followup"; phone: string; vapiCallId?: string }
  | { type: "after_hours_capture"; phone: string; name: string; captureType: "lead" | "booking" | "callback"; sourceId?: string }
  | { type: "stale_lead_followup"; phone: string; leadId: number }
  | { type: "abandoned_form_recovery"; phone: string; name: string; formType: string; sourceId?: string }
  | { type: "booking_reminder"; phone: string; name: string; reminderType: string; service: string; vehicle?: string; preferredTime?: string; refCode?: string; bookingId?: number }
  | { type: "review_request"; phone: string; name: string; bookingId?: number }
  | { type: "manual_admin_reply"; phone: string; message: string; conversationId?: number }
  | { type: "photo_assess_reply"; phone: string; replyText: string; leadId?: number };

export interface SmsOrchestratorResult {
  id?: number;
  body: string;
  source: string;
  variantKey: string;
  shouldAutoSend: boolean;
  requiresHumanApproval: boolean;
  reason: string;
  customerContext: string;
  providerUsed: "shop" | "twilio" | "none";
  cooldownKey?: string;
  status: "received" | "classified" | "compiled" | "drafted" | "approved" | "blocked" | "skipped" | "queued" | "sending" | "sent" | "delivered" | "failed" | "replied" | "expired" | "cancelled";
}

export interface CustomerContext {
  phone: string;
  customerRecord?: {
    id: number;
    firstName: string;
    lastName: string | null;
    smsOptOut: boolean;
    vehicleYear: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
  };
  activeBooking?: {
    id: number;
    vehicle: string | null;
    service: string;
    stage: string;
    preferredDate: string | null;
    preferredTime: string | null;
  };
  activeLead?: {
    id: number;
    name: string;
    problem: string | null;
    status: string;
    source: string;
  };
  activeCallback?: {
    id: number;
    name: string;
    notes: string | null;
    status: string;
  };
  activeEstimate?: {
    id: number;
    externalId: string;
    serviceDescription: string | null;
    estimatedAmount: number;
  };
  lastOutboundVariant?: string;
  lastVapiCall?: {
    vapiCallId: string;
    aiSummary: string | null;
    serviceMention: string | null;
  };
  last5Messages?: Array<{ direction: "inbound" | "outbound"; body: string; createdAt: Date }>;
  recentServiceMention?: string;
}

/**
 * Strips corporate adjectives, ChatGPT fluff, robotic preambles, and applies
 * caregiver warmth and the eagerness beat. Enforces the brand-voice guidelines.
 */
export function humanizeCopy(body: string): string {
  let clean = body.trim();
  
  // 1. Remove robotic preambles (LLM preambles)
  clean = clean.replace(/^(let's dive in|let's get started|here's the thing|first, let's|i'd be happy to|i'm happy to help|i'm grateful|hope you are doing well|hope you are having a great day|i'm happy to assist|happy to help|feel free to|don't hesitate to|please don't hesitate to),?\s*/i, "");
  
  // 2. Enforce the kill-list words with preferred replacements
  clean = clean.replace(/\btrusted\b/gi, "honest");
  clean = clean.replace(/\bexpert\b/gi, "experienced");
  clean = clean.replace(/\bexperts\b/gi, "crew");
  clean = clean.replace(/\bquality\b/gi, "reliable");
  clean = clean.replace(/\brest assured\b/gi, "we'll make sure");
  clean = clean.replace(/\bhassle[- ]free\b/gi, "straightforward");
  clean = clean.replace(/\bstate[- ]of[- ]the[- ]art\b/gi, "laser");
  clean = clean.replace(/\bcomprehensive\b/gi, "thorough");
  clean = clean.replace(/\bpremium\b/gi, "top");
  clean = clean.replace(/\btop[- ]notch\b/gi, "excellent");
  clean = clean.replace(/\bper your inquiry\b/gi, "as requested");
  clean = clean.replace(/\bhow may I assist\b/gi, "how can we help");
  clean = clean.replace(/\bfree inspection\b/gi, "free check");
  clean = clean.replace(/\bdiagnostic fee\b/gi, "free check");
  clean = clean.replace(/\bwithout your approval\b/gi, "until you say yes");
  clean = clean.replace(/\bno surprises\b/gi, "we tell you the cost first");
  clean = clean.replace(/\bsatisfaction guaranteed\b/gi, "we'll make it right");
  
  // 3. Make sure the business name is standardized to "Nick's Tire & Auto"
  clean = clean.replace(/\bNick's Tire\b/gi, "Nick's Tire & Auto");
  clean = clean.replace(/\bNick's Tire and Auto\b/gi, "Nick's Tire & Auto");

  return clean;
}

/**
 * Loads customer context for enrichment
 */
export async function loadCustomerContext(phone: string): Promise<CustomerContext> {
  const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "").slice(-10);
  const db = await getDbTyped();
  
  const ctx: CustomerContext = {
    phone: normalizedPhone
  };

  if (!db) return ctx;

  try {
    const { like, eq, and, desc, sql } = await import("drizzle-orm");

    // 1. Load customer record
    const [cust] = await db.select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      smsOptOut: customers.smsOptOut,
      vehicleYear: customers.vehicleYear,
      vehicleMake: customers.vehicleMake,
      vehicleModel: customers.vehicleModel
    })
    .from(customers)
    .where(like(customers.phone, `%${normalizedPhone}`))
    .limit(1);

    if (cust) {
      ctx.customerRecord = {
        id: cust.id,
        firstName: cust.firstName,
        lastName: cust.lastName,
        smsOptOut: cust.smsOptOut === 1,
        vehicleYear: cust.vehicleYear,
        vehicleMake: cust.vehicleMake,
        vehicleModel: cust.vehicleModel
      };
    }

    // 2. Load open bookings
    const activeBookings = await db.select()
      .from(bookings)
      .where(and(like(bookings.phone, `%${normalizedPhone}`), sql`${bookings.status} IN ('new', 'confirmed')`))
      .orderBy(desc(bookings.createdAt))
      .limit(1);
    if (activeBookings && activeBookings.length > 0) {
      ctx.activeBooking = {
        id: activeBookings[0].id,
        vehicle: activeBookings[0].vehicle,
        service: activeBookings[0].service,
        stage: activeBookings[0].stage || "unknown",
        preferredDate: activeBookings[0].preferredDate || null,
        preferredTime: activeBookings[0].preferredTime || null
      };
    }

    // 3. Load open callback requests
    const openCallbacks = await db.select()
      .from(callbackRequests)
      .where(and(like(callbackRequests.phone, `%${normalizedPhone}`), sql`${callbackRequests.status} IN ('new', 'pending')`))
      .orderBy(desc(callbackRequests.createdAt))
      .limit(1);
    if (openCallbacks && openCallbacks.length > 0) {
      ctx.activeCallback = {
        id: openCallbacks[0].id,
        name: openCallbacks[0].name,
        notes: openCallbacks[0].notes || null,
        status: openCallbacks[0].status
      };
    }

    // 4. Load open leads
    const openLeads = await db.select()
      .from(leads)
      .where(and(like(leads.phone, `%${normalizedPhone}`), sql`${leads.status} NOT IN ('lost', 'sold', 'archived')`))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (openLeads && openLeads.length > 0) {
      ctx.activeLead = {
        id: openLeads[0].id,
        name: openLeads[0].name,
        problem: openLeads[0].problem,
        status: openLeads[0].status,
        source: openLeads[0].source
      };
    }

    // 5. Load active estimate
    const activeEsts = await db.select()
      .from(algEstimates)
      .where(like(algEstimates.customerPhone, `%${normalizedPhone}`))
      .orderBy(desc(algEstimates.estimateDate))
      .limit(1);
    if (activeEsts && activeEsts.length > 0) {
      ctx.activeEstimate = {
        id: activeEsts[0].id,
        externalId: activeEsts[0].externalId,
        serviceDescription: activeEsts[0].serviceDescription || null,
        estimatedAmount: activeEsts[0].estimatedAmount
      };
    }

    // 6. Load last 5 SMS messages
    const [conv] = await db.select({ id: smsConversations.id })
      .from(smsConversations)
      .where(like(smsConversations.phone, `%${normalizedPhone}`))
      .limit(1);

    if (conv) {
      const dbMsgs = await db.select({
        direction: smsMessages.direction,
        body: smsMessages.body,
        createdAt: smsMessages.createdAt
      })
      .from(smsMessages)
      .where(eq(smsMessages.conversationId, conv.id))
      .orderBy(desc(smsMessages.createdAt))
      .limit(5);

      if (dbMsgs) {
        ctx.last5Messages = dbMsgs.reverse();
      }
    }

    // 7. Load last outbound variant from orchestrator log
    const lastOrch = await db.select({ variantKey: smsOrchestrations.variantKey })
      .from(smsOrchestrations)
      .where(and(eq(smsOrchestrations.customerPhone, normalizedPhone), sql`${smsOrchestrations.status} = 'sent'`))
      .orderBy(desc(smsOrchestrations.createdAt))
      .limit(1);
    if (lastOrch && lastOrch.length > 0) {
      ctx.lastOutboundVariant = lastOrch[0].variantKey;
    }

    // 8. Load last VAPI call
    const lastVapi = await db.select({
      vapiCallId: vapiCallLogs.vapiCallId,
      aiSummary: vapiCallLogs.aiSummary,
      serviceMention: vapiCallLogs.serviceMention
    })
    .from(vapiCallLogs)
    .where(like(vapiCallLogs.phoneNumber, `%${normalizedPhone}`))
    .orderBy(desc(vapiCallLogs.id))
    .limit(1);
    if (lastVapi && lastVapi.length > 0) {
      ctx.lastVapiCall = {
        vapiCallId: lastVapi[0].vapiCallId,
        aiSummary: lastVapi[0].aiSummary,
        serviceMention: lastVapi[0].serviceMention
      };
      if (lastVapi[0].serviceMention) {
        ctx.recentServiceMention = lastVapi[0].serviceMention;
      }
    }

    // 9. Infers recent service mention from lead / booking if none from VAPI
    if (!ctx.recentServiceMention) {
      if (ctx.activeLead?.problem) {
        ctx.recentServiceMention = ctx.activeLead.problem;
      } else if (ctx.activeBooking?.service) {
        ctx.recentServiceMention = ctx.activeBooking.service;
      }
    }

  } catch (err) {
    log.error("Failed to load customer context enrichment", err);
  }

  return ctx;
}

/**
 * Checks if a cooldown is active for the given cooldownKey.
 */
async function checkCooldown(cooldownKey: string, ttlMs: number): Promise<boolean> {
  const db = await getDbTyped();
  if (!db) return false;
  
  const cutoff = new Date(Date.now() - ttlMs);
  
  const recent = await db.select({ id: smsOrchestrations.id })
    .from(smsOrchestrations)
    .where(
      and(
        eq(smsOrchestrations.cooldownKey, cooldownKey),
        gte(smsOrchestrations.createdAt, cutoff),
        sql`${smsOrchestrations.status} IN ('sent', 'queued')`
      )
    )
    .limit(1);
    
  return recent.length > 0;
}

/** Helper to get next opening time as string */
function getNextOpenTimeStr(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
  const day = et.getDay();
  const hour = et.getHours();

  if (day === 0) {
    if (hour < 9) return "9:00 AM today";
    return "8:00 AM tomorrow (Monday)";
  }
  if (day === 6) {
    if (hour < 8) return "8:00 AM today";
    return "9:00 AM Sunday";
  }
  if (hour < 8) return "8:00 AM today";
  if (day === 5) return "8:00 AM Saturday";
  return "8:00 AM tomorrow";
}

/**
 * Main SMS Orchestrator execution method.
 */
/**
 * Helper to check rollout mode for a given event type
 */
export async function getRolloutMode(eventType: string): Promise<"off" | "shadow" | "draft_only" | "live_send" | "legacy_passthrough"> {
  const db = await getDbTyped();
  if (!db) return "legacy_passthrough";

  try {
    const [globalRow] = await db.select({ v: appSecretKv.v })
      .from(appSecretKv)
      .where(eq(appSecretKv.k, "sms_orchestrator_global_mode"))
      .limit(1);

    if (globalRow?.v === "legacy_passthrough") {
      return "legacy_passthrough";
    }

    const flagKey = `sms_orch_${eventType}_mode`;
    const [flagRow] = await db.select({ v: appSecretKv.v })
      .from(appSecretKv)
      .where(eq(appSecretKv.k, flagKey))
      .limit(1);

    if (flagRow?.v) {
      return flagRow.v as any;
    }
  } catch (err) {
    log.error("Failed to query rollout mode", err);
  }

  // Default every migrated callsite to shadow first unless it is already proven safe.
  return "shadow";
}

/**
 * Main SMS Orchestrator execution method.
 */
export async function orchestrateSms(event: SmsOrchestratorEvent): Promise<SmsOrchestratorResult> {
  const normalizedPhone = normalizePhone(event.phone) || event.phone.replace(/\D/g, "").slice(-10);
  const db = await getDbTyped();

  // Exclude test/fake phone numbers from matching the exact logic or logs when needed, but keep logging.
  const isTestNumber = /^(555\d{7}|1?555\d{7})$/.test(normalizedPhone);
  
  // Define default values
  let body = "";
  let source = event.type;
  let variantKey = "control";
  let shouldAutoSend = true;
  let requiresHumanApproval = false;
  let reason = "system_triggered";
  let providerUsed: "shop" | "twilio" | "none" = "shop";
  let cooldownKey: string | undefined = undefined;
  let status: SmsOrchestratorResult["status"] = "compiled";
  let statusReason = "compiled_successfully";

  // Enriched shadow / trace variables
  let riskTier: "low" | "medium" | "high" = "medium";
  let humanReviewReason: string | null = null;
  let noSendReason: string | null = null;
  let selectedTemplateKey: string = event.type;
  let selectedVariantKey = "control";
  let templateVersion = "1.0.0";
  let experimentId = "";
  let journeyId = "";
  let correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let idempotencyKey = `idemp_${event.type}_${normalizedPhone}_${Date.now().toString().slice(0, 7)}`;
  let legacyComparisonJson = "";
  let shadowWouldSend = false;
  let shadowMessageBody = "";
  
  // Experiment split details
  let isControl = true;
  let trafficWeight = 100;
  let variantAssignmentReason = "default_assignment";

  // Context relations
  let sourceTable: string | null = null;
  let sourceId: string | null = null;
  let relatedConversationId: number | null = null;
  let relatedLeadId: number | null = null;
  let relatedBookingId: number | null = null;
  let relatedCallbackId: number | null = null;
  let relatedVapiCallId: string | null = null;
  let relatedEstimateId: string | null = null;
  let metadataJson: Record<string, any> = {};

  // For inbound, we first save a 'received' state
  let orchestrationId: number | null = null;

  if (event.type === "inbound_sms") {
    sourceTable = "sms_messages";
    relatedConversationId = event.conversationId;
    if (db) {
      try {
        const [row] = await db.insert(smsOrchestrations).values({
          eventType: "inbound_sms",
          customerPhone: normalizedPhone,
          messageBody: event.body,
          variantKey: "none",
          shouldAutoSend: false,
          requiresHumanApproval: false,
          reason: "inbound_message_received",
          providerUsed: "none",
          status: "received",
          statusReason: "inbound_message_received",
          relatedConversationId: event.conversationId,
          sourceTable: "sms_messages"
        }).$returningId();
        orchestrationId = row?.id;
      } catch (err) {
        log.warn("Failed to write received log to sms_orchestrations", err);
      }
    }
  }

  // ─── 0. Check Rollout Controls & Modes ───
  const rolloutMode = await getRolloutMode(event.type);

  // Compile legacy body first for comparison or passthrough
  let legacyBody = "";
  if (event.type !== "inbound_sms") {
    if (event.type === "vapi_confirmation") {
      legacyBody = (event as any).legacyMessageBody || `${event.summary}\n\n📍 17625 Euclid Ave, Cleveland\n📞 ${BUSINESS.phone.display}\n${(event as any).mapLink || "https://nickstire.org/contact"}`;
    } else if (event.type === "manual_admin_reply") {
      legacyBody = (event as any).legacyMessageBody || event.message;
    } else if (event.type === "photo_assess_reply") {
      legacyBody = (event as any).legacyMessageBody || event.replyText;
    } else {
      const legacyCompiled = getTemplateVariant(event.type, {
        name: (event as any).name || "",
        service: event.type === "booking_reminder" ? event.service : "service",
        reminderType: event.type === "booking_reminder" ? event.reminderType : undefined,
        nextOpen: getNextOpenTimeStr(),
      }, 0);
      legacyBody = (event as any).legacyMessageBody || legacyCompiled.body;
    }
    legacyBody = humanizeCopy(legacyBody);
  }

  if (rolloutMode === "off") {
    status = "skipped";
    statusReason = "rollout_mode_off";
    reason = "event_rollout_mode_is_off";
    shouldAutoSend = false;
    noSendReason = "rollout_mode_off";
    body = "";
    
    const finalResult: SmsOrchestratorResult = {
      body: "",
      source,
      variantKey: "none",
      shouldAutoSend: false,
      requiresHumanApproval: false,
      reason,
      customerContext: "{}",
      providerUsed: "none",
      status,
    };
    if (db && orchestrationId) {
      await db.update(smsOrchestrations).set({ status, statusReason, reason, noSendReason }).where(eq(smsOrchestrations.id, orchestrationId));
    }
    return finalResult;
  }

  if (rolloutMode === "legacy_passthrough") {
    status = "sent";
    statusReason = "legacy_passthrough_send";
    reason = "global_kill_switch_or_event_passthrough";
    shouldAutoSend = true;
    body = legacyBody;
    variantKey = "legacy";
    
    let sendResultJson: any = null;
    if (body) {
      const isVapi = event.type === "vapi_confirmation" || event.type === "vapi_forwarded_call_followup";
      const isReminder = event.type === "booking_reminder" || event.type === "review_request";
      const isTransactional = isVapi || (isReminder && event.type !== "booking_reminder" || (event.type === "booking_reminder" && event.reminderType !== "maintenance-reminder"));

      const sendResult = (process.env.REPLAY_DRY_RUN === "true")
        ? { success: true, queued: false, sid: "SM_replay_dry_run" }
        : await sendSms(normalizedPhone, body, {
            via: "shop",
            transactional: isTransactional,
            variantKey: "legacy",
            skipPersist: false,
          });
      if (sendResult.success) {
        status = sendResult.queued ? "queued" : "sent";
        statusReason = sendResult.queued ? "outside_hours_queued" : "sent_successfully";
        sendResultJson = sendResult;
      } else {
        status = "failed";
        statusReason = "transmission_failed";
        sendResultJson = sendResult;
      }
    }

    const finalResult: SmsOrchestratorResult = {
      body,
      source,
      variantKey,
      shouldAutoSend,
      requiresHumanApproval: false,
      reason,
      customerContext: "{}",
      providerUsed: "shop",
      status,
    };

    if (db) {
      try {
        const payload = {
          eventType: source,
          customerPhone: normalizedPhone,
          messageBody: body,
          variantKey,
          shouldAutoSend,
          requiresHumanApproval: false,
          reason,
          customerContext: "{}",
          providerUsed: "shop" as const,
          status,
          statusReason,
          legacyMessageBody: legacyBody,
          noSendReason,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        if (event.type === "inbound_sms" && orchestrationId) {
          await db.update(smsOrchestrations).set(payload).where(eq(smsOrchestrations.id, orchestrationId));
          finalResult.id = orchestrationId;
        } else {
          const [row] = await db.insert(smsOrchestrations).values(payload).$returningId();
          finalResult.id = row?.id;
        }
      } catch (err) {
        log.warn("Failed to write legacy passthrough log", err);
      }
    }
    return finalResult;
  }

  // ─── Start standard Orchestrator Logic ───
  let ctx: CustomerContext = { phone: normalizedPhone };
  try {
    ctx = await loadCustomerContext(normalizedPhone);
    
    // Assign Journey ID
    if (ctx.activeBooking) journeyId = `booking:${ctx.activeBooking.id}`;
    else if (ctx.activeLead) journeyId = `lead:${ctx.activeLead.id}`;
    else if (ctx.activeCallback) journeyId = `callback:${ctx.activeCallback.id}`;
    else journeyId = `customer:${ctx.customerRecord?.id || normalizedPhone}`;

    if (ctx.customerRecord) {
      if (ctx.customerRecord.smsOptOut) {
        log.info("Orchestrator blocked send: customer opted out", { customerPhoneSuffix: normalizedPhone.slice(-4) });
        status = "blocked";
        statusReason = "customer_opted_out";
        reason = "customer_opted_out_status_true";
        shouldAutoSend = false;
        noSendReason = "customer_opted_out";
        
        const finalResult: SmsOrchestratorResult = {
          body: "",
          source,
          variantKey,
          shouldAutoSend,
          requiresHumanApproval,
          reason,
          customerContext: JSON.stringify(ctx),
          providerUsed: "none",
          cooldownKey,
          status,
        };

        if (db && event.type === "inbound_sms" && orchestrationId) {
          await db.update(smsOrchestrations).set({
            status,
            statusReason,
            reason,
            noSendReason,
            customerContext: finalResult.customerContext,
          }).where(eq(smsOrchestrations.id, orchestrationId));
        } else if (db) {
          const [row] = await db.insert(smsOrchestrations).values({
            eventType: source,
            customerPhone: normalizedPhone,
            messageBody: "",
            variantKey,
            shouldAutoSend,
            requiresHumanApproval,
            reason,
            customerContext: finalResult.customerContext,
            providerUsed: "none",
            status,
            statusReason,
            noSendReason,
            journeyId,
            correlationId,
            idempotencyKey,
          }).$returningId();
          finalResult.id = row?.id;
        }
        return finalResult;
      }
    }

    if (ctx.activeBooking) relatedBookingId = ctx.activeBooking.id;
    if (ctx.activeLead) relatedLeadId = ctx.activeLead.id;
    if (ctx.activeCallback) relatedCallbackId = ctx.activeCallback.id;
    if (ctx.activeEstimate) relatedEstimateId = ctx.activeEstimate.externalId;
    if (ctx.lastVapiCall) relatedVapiCallId = ctx.lastVapiCall.vapiCallId;

    if (event.type === "inbound_sms") {
      shouldAutoSend = false;
      riskTier = "medium";

      const parsed = parseSmsResponse(event.body);
      if (parsed.intent === "unsubscribe" || (parsed.autoAction === "unsubscribe-customer")) {
        if (db) {
          await db.update(customers)
            .set({ smsOptOut: 1 })
            .where(like(customers.phone, `%${normalizedPhone}`));
            
          if (orchestrationId) {
            const { trackOrchestrationOutcome } = await import("./smsLearningEngine");
            await trackOrchestrationOutcome(orchestrationId, "customer_opted_out", "1", "customers", String(ctx.customerRecord?.id || ""));
          }
        }
        status = "blocked";
        statusReason = "customer_opted_out";
        reason = "unsubscribe_keyword_matched";
        noSendReason = "unsubscribed_via_keyword";
        body = "";
        riskTier = "low";
      } 
      else if (parsed.intent === "confirm" && ctx.activeBooking) {
        if (db) {
          await db.update(bookings)
            .set({ status: "confirmed" })
            .where(eq(bookings.id, ctx.activeBooking.id));
            
          if (orchestrationId) {
            const { trackOrchestrationOutcome } = await import("./smsLearningEngine");
            await trackOrchestrationOutcome(orchestrationId, "booking_created", "1", "bookings", String(ctx.activeBooking.id));
          }
        }
        status = "skipped";
        statusReason = "booking_confirmed_via_keyword";
        reason = "booking_confirmed_automatically";
        body = "";
        riskTier = "low";
      }
      else if (parsed.intent === "cancel" && ctx.activeBooking) {
        if (db) {
          await db.update(bookings)
            .set({ status: "cancelled" })
            .where(eq(bookings.id, ctx.activeBooking.id));
          const { cancelBookingReminders } = await import("./sms-scheduler");
          await cancelBookingReminders(ctx.activeBooking.id);
        }
        status = "skipped";
        statusReason = "booking_cancelled_via_keyword";
        reason = "booking_cancelled_automatically";
        body = "";
        riskTier = "low";
      }
      else if (parsed.intent === "approve-estimate" && ctx.activeEstimate) {
        if (db) {
          const { sendNotification } = await import("../email-notify");
          await sendNotification({
            category: "booking",
            subject: `Estimate Approved by Customer (***${normalizedPhone.slice(-4)})`,
            body: `Customer approved estimate #${ctx.activeEstimate.externalId} via SMS reply.`,
          });
          
          if (orchestrationId) {
            const { trackOrchestrationOutcome } = await import("./smsLearningEngine");
            await trackOrchestrationOutcome(orchestrationId, "lead_converted", "1", "alg_estimates", String(ctx.activeEstimate.id));
          }
        }
        status = "skipped";
        statusReason = "estimate_approved_via_keyword";
        reason = "estimate_approved_automatically";
        body = "";
        riskTier = "low";
      }
      else if (parsed.intent === "decline-estimate" && ctx.activeEstimate) {
        status = "skipped";
        statusReason = "estimate_declined_via_keyword";
        reason = "estimate_declined_automatically";
        body = "";
        riskTier = "low";
      }
      else {
        const bodyLower = event.body.toLowerCase().trim();
        let matchedCatalogEvent: string | null = null;
        let leadProblem: string | null = null;

        if (bodyLower.includes("hour") || bodyLower.includes("time") || bodyLower.includes("open") || bodyLower.includes("close")) {
          matchedCatalogEvent = "hours_location";
        } else if (bodyLower.includes("address") || bodyLower.includes("location") || bodyLower.includes("where")) {
          matchedCatalogEvent = "hours_location";
        } else if (bodyLower.includes("oil") || bodyLower.includes("lube")) {
          matchedCatalogEvent = "price_question_oil";
          leadProblem = "Oil change price inquiry";
        } else if (bodyLower.includes("tire")) {
          matchedCatalogEvent = "price_question_tires";
          leadProblem = "Tires price inquiry";
        } else if (bodyLower.includes("brake") || bodyLower.includes("rotor")) {
          matchedCatalogEvent = "price_question_brakes";
          leadProblem = "Brakes price inquiry";
        } else if (bodyLower.includes("alignment") || bodyLower.includes("align")) {
          matchedCatalogEvent = "price_question_alignment";
          leadProblem = "Alignment price inquiry";
        } else if (bodyLower.includes("diagnostic") || bodyLower.includes("check engine") || bodyLower.includes("scan") || bodyLower.includes("code") || bodyLower.includes("e-check") || bodyLower.includes("echeck")) {
          matchedCatalogEvent = "price_question_diagnostic";
          leadProblem = "Diagnostic/E-Check inquiry";
        } else if (bodyLower.includes("come today") || bodyLower.includes("walk in") || bodyLower.includes("stop by")) {
          matchedCatalogEvent = "same_day_visit";
        } else if (bodyLower.includes("drop off") || bodyLower.includes("dropoff")) {
          matchedCatalogEvent = "drop_off";
        }

        if (matchedCatalogEvent) {
          const autoReplyEnabled = await isEnabled("smart_sms_auto_reply");
          
          const contextPayload: Record<string, any> = {
            name: ctx.customerRecord?.firstName || "there",
            nextOpen: getNextOpenTimeStr(),
          };
          
          if (ctx.activeLead?.problem && matchedCatalogEvent === "same_day_visit") {
            contextPayload.service = ctx.activeLead.problem.toLowerCase().includes("brake") ? "brakes" : "vehicle";
          }
          
          const experimentAssignment = assignVariantWithExperiment(matchedCatalogEvent, contextPayload);
          body = humanizeCopy(experimentAssignment.body);
          variantKey = experimentAssignment.variantKey;
          shouldAutoSend = autoReplyEnabled;
          reason = `deterministic_auto_reply:${matchedCatalogEvent}`;
          status = autoReplyEnabled ? "compiled" : "drafted";
          statusReason = autoReplyEnabled ? "compiled_successfully" : "auto_send_disabled";
          riskTier = "low";

          experimentId = experimentAssignment.experimentId;
          isControl = experimentAssignment.isControl;
          trafficWeight = experimentAssignment.trafficWeight;
          variantAssignmentReason = experimentAssignment.variantAssignmentReason;
          selectedTemplateKey = experimentAssignment.selectedTemplateKey;
          selectedVariantKey = experimentAssignment.variantKey;

          if (leadProblem && db) {
            try {
              const [newLead] = await db.insert(leads).values({
                name: ctx.customerRecord ? `${ctx.customerRecord.firstName} ${ctx.customerRecord.lastName || ""}`.trim() : `SMS Inquiry (***${normalizedPhone.slice(-4)})`,
                phone: normalizedPhone,
                source: "sms",
                problem: leadProblem,
                urgencyScore: 3,
                status: "new",
              }).$returningId();
              relatedLeadId = newLead?.id;
            } catch (leadErr) {
              log.warn("Failed to create lead for deterministic price request", leadErr);
            }
          }
        }
        else {
          const autoReplyEnabled = await isEnabled("smart_sms_auto_reply");
          const lowRiskEnabled = await isEnabled("nickgpt_low_risk_autosend_enabled");

          let conversationContext: Array<{ role: "user" | "assistant"; content: string }> = [];
          if (ctx.last5Messages) {
            conversationContext = ctx.last5Messages.map((m: any) => ({
              role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
              content: m.body
            }));
          }

          const draftResult = await draftSmsReply({
            inboundMessage: event.body,
            conversationContext,
            activeBooking: ctx.activeBooking,
          });

          if (draftResult.ok && draftResult.draft) {
            body = humanizeCopy(draftResult.draft);
            variantKey = "nickgpt_v1";
            selectedVariantKey = "nickgpt_v1";
            experimentId = "exp_nickgpt_replies";

            const candidateLabels = [
              "asking about hours or location",
              "greeting or hello",
              "asking about brake service",
              "asking about tire prices or sizes",
              "asking about oil change",
              "asking about diagnostic or check engine",
              "asking about appointment scheduling",
              "complaint or negative feedback",
              "opting out of texts"
            ] as const;

            const classification = await classifyIntent(event.body, { labels: candidateLabels });
            let isLowRisk = false;
            let confScore = 0;
            let detectedIntent = "general";

            if (classification.ok) {
              detectedIntent = classification.topLabel;
              confScore = classification.topScore;

              const lowRiskLabels = [
                "asking about hours or location",
                "greeting or hello",
                "asking about brake service",
                "asking about tire prices or sizes",
                "asking about oil change",
                "asking about diagnostic or check engine",
                "asking about appointment scheduling"
              ];

              if (lowRiskLabels.includes(classification.topLabel) && classification.topScore >= 0.85) {
                isLowRisk = true;
              }
            }

            const isComplaint = detectedIntent === "complaint or negative feedback" || /complaint|refund|sue|legal|lawyer|police|rip|fraud/i.test(event.body);
            const lowConfidence = confScore < 0.85;
            
            if (isComplaint) {
              isLowRisk = false;
              requiresHumanApproval = true;
              humanReviewReason = "high_risk_complaint_detected";
              riskTier = "high";
            } else if (lowConfidence) {
              requiresHumanApproval = true;
              humanReviewReason = "low_nickgpt_confidence";
              riskTier = "medium";
            }

            const isRepeated = ctx.last5Messages && ctx.last5Messages.length > 0 && ctx.last5Messages[ctx.last5Messages.length - 1].body === event.body;
            if (isRepeated) {
              requiresHumanApproval = true;
              humanReviewReason = "repeated_customer_message";
              riskTier = "medium";
            }

            if (autoReplyEnabled && lowRiskEnabled && isLowRisk && !requiresHumanApproval) {
              shouldAutoSend = true;
              reason = `low_risk_auto_send:${detectedIntent}`;
              status = "compiled";
              statusReason = "compiled_successfully";
              riskTier = "low";
            } else {
              shouldAutoSend = false;
              requiresHumanApproval = true;
              if (!humanReviewReason) humanReviewReason = `complex_intent:${detectedIntent}`;
              reason = humanReviewReason;
              status = "drafted";
              statusReason = "requires_operator_review";
            }

            if (db) {
              try {
                await db.insert(nickgptDrafts).values({
                  customerPhone: normalizedPhone,
                  inboundMessage: event.body,
                  draftReply: body,
                  intent: detectedIntent,
                  confidence: confScore,
                  provider: draftResult.source,
                  latencyMs: draftResult.latencyMs,
                  status: shouldAutoSend ? "approved" : "draft",
                  autoSent: shouldAutoSend,
                });
              } catch (err) {
                log.warn("Failed to log draft to nickgpt_drafts", err);
              }
            }
          } else {
            body = "";
            shouldAutoSend = false;
            requiresHumanApproval = true;
            humanReviewReason = "nickgpt_generation_failed";
            reason = "nickgpt_generation_failed";
            status = "failed";
            statusReason = "nickgpt_failed";
            riskTier = "high";
          }
        }
      }
    } 
    else {
      let cooldownTtlMs = 0;

      if (event.type === "vapi_forwarded_call_followup") {
        cooldownKey = `vapi_forward:${normalizedPhone}`;
        cooldownTtlMs = 24 * 60 * 60 * 1000;
        sourceTable = "vapi_call_logs";
        riskTier = "medium";
      } else if (event.type === "booking_reminder") {
        cooldownKey = `booking_reminder:${event.refCode || event.bookingId || "noref"}:${event.reminderType}`;
        cooldownTtlMs = 365 * 24 * 60 * 60 * 1000;
        sourceTable = "bookings";
        sourceId = String(event.bookingId || "");
        riskTier = "low";
      } else if (event.type === "abandoned_form_recovery") {
        cooldownKey = `abandoned_form:${normalizedPhone}`;
        cooldownTtlMs = 7 * 24 * 60 * 60 * 1000;
        sourceTable = "form_abandonment";
        sourceId = event.sourceId || null;
        riskTier = "medium";
      } else if (event.type === "review_request") {
        cooldownKey = `review_request:${normalizedPhone}`;
        cooldownTtlMs = 30 * 24 * 60 * 60 * 1000;
        sourceTable = "bookings";
        sourceId = String(event.bookingId || "");
        riskTier = "medium";
      } else if (event.type === "vapi_confirmation") {
        cooldownKey = `vapi_confirmation:${event.vapiCallId || normalizedPhone}`;
        cooldownTtlMs = 1 * 60 * 60 * 1000;
        sourceTable = "vapi_call_logs";
        sourceId = event.vapiCallId || null;
        riskTier = "low";
      } else if (event.type === "stale_lead_followup") {
        cooldownKey = `stale_lead:${normalizedPhone}`;
        cooldownTtlMs = 24 * 60 * 60 * 1000;
        sourceTable = "leads";
        sourceId = String(event.leadId);
        riskTier = "medium";
      } else if (event.type === "manual_admin_reply") {
        sourceTable = "sms_conversations";
        riskTier = "low";
      } else if (event.type === "after_hours_capture") {
        sourceTable = event.captureType;
        sourceId = event.sourceId || null;
        riskTier = "low";
      } else if (event.type === "photo_assess_reply") {
        sourceTable = "photo_assess";
        sourceId = String(event.leadId || "");
        riskTier = "medium";
      }

      if (cooldownKey && cooldownTtlMs > 0) {
        const hasCooldown = await checkCooldown(cooldownKey, cooldownTtlMs);
        if (hasCooldown) {
          status = "skipped";
          statusReason = "cooldown_active";
          reason = "cooldown_active";
          noSendReason = "cooldown_active";
          shouldAutoSend = false;
          body = "";
        }
      }

      if (status !== "skipped") {
        const contextPayload: Record<string, any> = {
          name: (event as any).name || ctx.customerRecord?.firstName || "there",
          service: event.type === "booking_reminder" ? event.service : "service",
          reminderType: event.type === "booking_reminder" ? event.reminderType : undefined,
          nextOpen: getNextOpenTimeStr(),
        };

        let compiledAssignment;
        if (event.type === "booking_reminder") {
          compiledAssignment = assignVariantWithExperiment("booking_reminder", contextPayload);
        } else if (event.type === "vapi_confirmation") {
          compiledAssignment = assignVariantWithExperiment("vapi_confirmation", contextPayload);
          compiledAssignment.body = `${event.summary}\n\n📍 17625 Euclid Ave, Cleveland\n📞 ${BUSINESS.phone.display}\n${event.mapLink || "https://nickstire.org/contact"}`;
        } else if (event.type === "manual_admin_reply") {
          compiledAssignment = {
            body: event.message,
            variantKey: "manual",
            experimentId: "manual",
            isControl: true,
            trafficWeight: 100,
            variantAssignmentReason: "manual_admin_response",
            selectedTemplateKey: "manual_admin_reply"
          };
        } else if (event.type === "photo_assess_reply") {
          compiledAssignment = {
            body: event.replyText,
            variantKey: "photo_assess",
            experimentId: "photo_assess",
            isControl: true,
            trafficWeight: 100,
            variantAssignmentReason: "photo_assess_response",
            selectedTemplateKey: "photo_assess_reply"
          };
        } else {
          compiledAssignment = assignVariantWithExperiment(event.type, contextPayload);
        }

        body = humanizeCopy(compiledAssignment.body);
        variantKey = compiledAssignment.variantKey;
        shouldAutoSend = true;

        experimentId = compiledAssignment.experimentId;
        isControl = compiledAssignment.isControl;
        trafficWeight = compiledAssignment.trafficWeight;
        variantAssignmentReason = compiledAssignment.variantAssignmentReason;
        selectedTemplateKey = compiledAssignment.selectedTemplateKey;
        selectedVariantKey = compiledAssignment.variantKey;

        if (event.type === "stale_lead_followup" || event.type === "abandoned_form_recovery" || event.type === "after_hours_capture") {
          const autoReplyEnabled = await isEnabled("smart_sms_auto_reply");
          shouldAutoSend = autoReplyEnabled;
          if (!autoReplyEnabled) {
            status = "skipped";
            statusReason = "auto_send_disabled";
            reason = "smart_sms_auto_reply_flag_off";
            noSendReason = "auto_send_disabled";
          }
        }
      }
    }

    const repConfig = REPLY_CONFIGS[event.type];
    if (repConfig) {
      metadataJson.replyConfig = repConfig;
    }

    const decisionTrace = {
      eventType: event.type,
      phone: normalizedPhone,
      rolloutMode,
      riskTier,
      humanReviewReason,
      noSendReason,
      customerContext: {
        smsOptOut: ctx.customerRecord?.smsOptOut,
        activeBooking: ctx.activeBooking?.id,
        activeLead: ctx.activeLead?.id,
      },
      rules: {
        cooldownActive: status === "skipped" && statusReason === "cooldown_active",
        cooldownKeyUsed: cooldownKey || null,
        optOutChecked: true,
      },
      experiment: {
        experimentId,
        variantKey,
        isControl,
        trafficWeight,
        variantAssignmentReason,
      },
      legacyComparison: {
        legacyBody,
        orchestratorBody: body,
        disagree: legacyBody !== body,
      }
    };
    decisionTraceJson = JSON.stringify(decisionTrace);
    legacyComparisonJson = JSON.stringify(decisionTrace.legacyComparison);

    shadowWouldSend = shouldAutoSend && body !== "" && status !== "skipped" && status !== "blocked";
    shadowMessageBody = body;

    let finalBodyToSend = body;
    let finalVariantKey = variantKey;

    if (rolloutMode === "shadow") {
      finalBodyToSend = legacyBody;
      finalVariantKey = "legacy_shadow";
      statusReason = "shadow_mode_legacy_send";
      log.info(`[Shadow Mode] Would send orchestrator body: "${body}" but sending legacy instead: "${legacyBody}"`);
    } else if (rolloutMode === "draft_only") {
      shouldAutoSend = false;
      status = "drafted";
      statusReason = "draft_only_rollout_mode";
      noSendReason = "draft_only_mode";
      log.info(`[Draft Only Mode] Computed body: "${body}" - saved as draft.`);
    }

    if (shouldAutoSend && finalBodyToSend && status !== "skipped" && status !== "blocked" && rolloutMode !== "draft_only") {
      const isVapi = event.type === "vapi_confirmation" || event.type === "vapi_forwarded_call_followup";
      const isReminder = event.type === "booking_reminder" || event.type === "review_request";
      const isTransactional = isVapi || (isReminder && event.type !== "booking_reminder" || (event.type === "booking_reminder" && event.reminderType !== "maintenance-reminder"));

      status = "sending";
      statusReason = "sending_to_gateway";

      const sendResult = (process.env.REPLAY_DRY_RUN === "true")
        ? { success: true, queued: false, sid: "SM_replay_dry_run" }
        : await sendSms(normalizedPhone, finalBodyToSend, {
            via: "shop",
            transactional: isTransactional,
            variantKey: finalVariantKey,
            skipPersist: false,
          });

      if (sendResult.success) {
        status = sendResult.queued ? "queued" : "sent";
        statusReason = sendResult.queued ? "outside_hours_queued" : (rolloutMode === "shadow" ? "shadow_mode_sent_successfully" : "sent_successfully");
        if (sendResult.queued) {
          const now = new Date();
          const tomorrow8am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
          metadataJson.queuedUntil = tomorrow8am.toISOString();
        }
        sendResultJson = sendResult;
      } else {
        status = "failed";
        statusReason = "transmission_failed";
        metadataJson.failureReason = sendResult.error || "transmission_failed";
        sendResultJson = sendResult;
      }
      providerUsed = "shop";
    }

  } catch (orchestrateError) {
    log.error("Error executing orchestrator", orchestrateError);
    status = "failed";
    statusReason = "internal_error";
    metadataJson.failureReason = orchestrateError instanceof Error ? orchestrateError.message : "internal_orchestrator_error";
    shouldAutoSend = false;
  }

  const finalResult: SmsOrchestratorResult = {
    body,
    source,
    variantKey,
    shouldAutoSend,
    requiresHumanApproval,
    reason,
    customerContext: JSON.stringify(ctx),
    providerUsed,
    cooldownKey,
    status,
  };

  if (db) {
    try {
      const payload = {
        eventType: source,
        customerPhone: normalizedPhone,
        messageBody: body,
        variantKey,
        shouldAutoSend,
        requiresHumanApproval,
        reason,
        customerContext: finalResult.customerContext,
        providerUsed,
        cooldownKey: cooldownKey || null,
        status,
        statusReason,
        deliveryStatus: status === "sent" ? "delivered" : status === "failed" ? "undelivered" : null,
        deliveredAt: status === "sent" ? new Date() : null,
        sentAt: (status === "sent" || status === "queued") ? new Date() : null,
        failedAt: status === "failed" ? new Date() : null,
        failureReason: metadataJson.failureReason || null,
        sourceTable,
        sourceId,
        relatedConversationId,
        relatedLeadId,
        relatedBookingId,
        relatedCallbackId,
        relatedVapiCallId,
        relatedEstimateId,
        sendResultJson: sendResultJson ? JSON.stringify(sendResultJson) : null,
        metadataJson: Object.keys(metadataJson).length > 0 ? JSON.stringify(metadataJson) : null,
        
        decisionTraceJson,
        riskTier,
        humanReviewReason,
        noSendReason,
        selectedTemplateKey,
        selectedVariantKey,
        templateVersion,
        experimentId,
        journeyId,
        correlationId,
        idempotencyKey,
        legacyComparisonJson,
        shadowWouldSend,
        shadowMessageBody,
        legacyMessageBody: legacyBody,
        variantAssignmentReason,
        isControl,
        trafficWeight,
      };

      if (event.type === "inbound_sms" && orchestrationId) {
        await db.update(smsOrchestrations)
          .set(payload)
          .where(eq(smsOrchestrations.id, orchestrationId));
        finalResult.id = orchestrationId;
      } else {
        const [row] = await db.insert(smsOrchestrations).values(payload).$returningId();
        finalResult.id = row?.id;
      }
    } catch (dbErr) {
      log.warn("Failed to write log row to sms_orchestrations table", dbErr);
    }
  }

  return finalResult;
}

let sendResultJson: any = null;
let decisionTraceJson: string | null = null;

// tRPC helper keys for label printing
const EVENT_TYPE_LABELS: Record<string, string> = {
  inbound_sms: "Inbound SMS",
  vapi_confirmation: "Voice Confirmation",
  vapi_forwarded_call_followup: "Call Follow-up",
  after_hours_capture: "After Hours",
  stale_lead_followup: "Stale Lead Nudge",
  abandoned_form_recovery: "Abandoned Form",
  booking_reminder: "Booking Reminder",
  review_request: "Review Request",
  manual_admin_reply: "Admin Response",
  photo_assess_reply: "MMS Photo Reply",
};

/**
 * Customer Journey Timeline Aggregator (Track K)
 */
export async function getCustomerJourneyTimeline(phone: string) {
  const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "").slice(-10);
  const db = await getDbTyped();
  if (!db) return [];

  const timelineEvents: Array<{
    id: string;
    timestamp: Date;
    type: string;
    title: string;
    description: string;
    meta?: any;
  }> = [];

  try {
    const [conv] = await db.select({ id: smsConversations.id })
      .from(smsConversations)
      .where(like(smsConversations.phone, `%${normalizedPhone}`))
      .limit(1);

    if (conv) {
      const dbMsgs = await db.select()
        .from(smsMessages)
        .where(eq(smsMessages.conversationId, conv.id))
        .limit(100);

      for (const m of dbMsgs) {
        timelineEvents.push({
          id: `msg_${m.id}`,
          timestamp: m.createdAt,
          type: m.direction === "inbound" ? "inbound_sms" : "outbound_sms",
          title: m.direction === "inbound" ? "Inbound SMS" : "Outbound SMS",
          description: m.body,
          meta: { status: m.status, sid: m.twilioSid }
        });
      }
    }

    const orchs = await db.select()
      .from(smsOrchestrations)
      .where(eq(smsOrchestrations.customerPhone, normalizedPhone))
      .limit(100);

    for (const o of orchs) {
      timelineEvents.push({
        id: `orch_${o.id}`,
        timestamp: o.createdAt,
        type: "orchestrator_decision",
        title: `Orchestrator Decision: ${EVENT_TYPE_LABELS[o.eventType] || o.eventType}`,
        description: `Status: ${o.status} | Variant: ${o.variantKey} | AutoSend: ${o.shouldAutoSend}`,
        meta: {
          id: o.id,
          eventType: o.eventType,
          status: o.status,
          variantKey: o.variantKey,
          reason: o.reason,
          noSendReason: o.noSendReason,
          riskTier: o.riskTier,
          messageBody: o.messageBody,
          decisionTraceJson: o.decisionTraceJson
        }
      });
    }

    const drafts = await db.select()
      .from(nickgptDrafts)
      .where(eq(nickgptDrafts.customerPhone, normalizedPhone))
      .limit(100);

    for (const d of drafts) {
      timelineEvents.push({
        id: `draft_${d.id}`,
        timestamp: d.createdAt,
        type: "nickgpt_draft",
        title: "NickGPT Draft Generated",
        description: `Draft: "${d.draftReply?.slice(0, 80) || ""}..." (Intent: ${d.intent}, Confidence: ${((d.confidence || 0) * 100).toFixed(0)}%)`,
        meta: d
      });
    }

    const vapis = await db.select()
      .from(vapiCallLogs)
      .where(like(vapiCallLogs.phoneNumber, `%${normalizedPhone}`))
      .limit(50);

    for (const v of vapis) {
      timelineEvents.push({
        id: `vapi_${v.id}`,
        timestamp: v.createdAt || new Date(),
        type: "vapi_call",
        title: `Vapi Call`,
        description: v.aiSummary || `Duration: ${v.durationSeconds}s | Ended: ${v.endedReason || "unknown"}`,
        meta: v
      });
    }

    const dbLeads = await db.select()
      .from(leads)
      .where(like(leads.phone, `%${normalizedPhone}`))
      .limit(50);

    for (const l of dbLeads) {
      timelineEvents.push({
        id: `lead_${l.id}`,
        timestamp: l.createdAt,
        type: "lead",
        title: "Website Lead Created",
        description: `Service needed: ${l.problem || "Not specified"} | Status: ${l.status}`,
        meta: l
      });
    }

    const dbBookings = await db.select()
      .from(bookings)
      .where(like(bookings.phone, `%${normalizedPhone}`))
      .limit(50);

    for (const b of dbBookings) {
      timelineEvents.push({
        id: `booking_${b.id}`,
        timestamp: b.createdAt,
        type: "booking",
        title: "Appointment Booking",
        description: `Service: ${b.service} | Vehicle: ${b.vehicle || "N/A"} | Date: ${b.preferredDate} (${b.preferredTime}) | Status: ${b.status}`,
        meta: b
      });
    }

    const callbacks = await db.select()
      .from(callbackRequests)
      .where(like(callbackRequests.phone, `%${normalizedPhone}`))
      .limit(50);

    for (const c of callbacks) {
      timelineEvents.push({
        id: `callback_${c.id}`,
        timestamp: c.createdAt,
        type: "callback_request",
        title: "Callback Request",
        description: `Name: ${c.name} | Status: ${c.status} | Notes: ${c.notes || "None"}`,
        meta: c
      });
    }

    const dbInvoices = await db.select()
      .from(invoices)
      .where(like(invoices.customerPhone, `%${normalizedPhone}`))
      .limit(50);

    for (const i of dbInvoices) {
      timelineEvents.push({
        id: `invoice_${i.id}`,
        timestamp: i.createdAt || new Date(),
        type: "invoice",
        title: `Invoice #${i.invoiceNumber || i.id}`,
        description: `Total: $${(i.totalAmount / 100).toFixed(2)} | Service: ${i.serviceDescription || "N/A"}`,
        meta: i
      });
    }

    timelineEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (err) {
    log.error("Failed to load customer journey timeline", err);
  }

  return timelineEvents;
}


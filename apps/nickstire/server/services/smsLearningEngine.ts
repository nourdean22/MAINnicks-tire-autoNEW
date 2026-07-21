/**
 * SMS Learning and Reporting Engine
 */

import { getDbTyped } from "../db";
import {
  smsOrchestrations,
  smsOrchestrationOutcomes,
  nickgptDrafts,
  nickgptTrainingExamples,
  bookings,
  callbackRequests,
  leads,
  invoices,
  smsLearningRecommendations,
  nickgptDefectLedger
} from "../../drizzle/schema";
import { eq, and, desc, gte, lte, sql, like } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";
import { notifyOwner } from "../_core/notification";

const log = createLogger("sms-learning-engine");

const isTestNumber = (phone?: string) => {
  if (!phone) return false;
  const norm = phone.replace(/\D/g, "");
  return norm.includes("55501") || norm.startsWith("555");
};

/**
 * Logs an explicit orchestration outcome.
 */
export async function trackOrchestrationOutcome(
  orchestrationId: number,
  outcomeType: string,
  outcomeValue?: string,
  sourceTable?: string,
  sourceId?: string,
  metadataJson?: Record<string, any>
) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    await db.insert(smsOrchestrationOutcomes).values({
      orchestrationId,
      outcomeType,
      outcomeValue: outcomeValue || null,
      sourceTable: sourceTable || null,
      sourceId: sourceId || null,
      metadataJson: metadataJson ? JSON.stringify(metadataJson) : null,
    });
  } catch (err) {
    log.error("Failed to track orchestration outcome", err);
  }
}

/**
 * Tracks a conversion outcome by looking up the last outbound orchestration for a phone.
 */
export async function trackConversionOutcome(
  phone: string,
  outcomeType: string,
  outcomeValue?: string,
  sourceTable?: string,
  sourceId?: string,
  metadataJson?: Record<string, any>
) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "").slice(-10);
    if (isTestNumber(normalizedPhone)) return;

    // Find last outbound orchestration in last 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [lastOutbound] = await db.select()
      .from(smsOrchestrations)
      .where(
        and(
          eq(smsOrchestrations.customerPhone, normalizedPhone),
          sql`${smsOrchestrations.status} IN ('sent', 'queued')`,
          eq(smsOrchestrations.shouldAutoSend, true),
          gte(smsOrchestrations.createdAt, cutoff)
        )
      )
      .orderBy(desc(smsOrchestrations.createdAt))
      .limit(1);

    if (lastOutbound) {
      await trackOrchestrationOutcome(lastOutbound.id, outcomeType, outcomeValue, sourceTable, sourceId, metadataJson);
    }
  } catch (err) {
    log.error("Failed to track conversion outcome", err);
  }
}

/**
 * Handles operator approval, edit, or rejection of NickGPT drafts.
 */
export async function trackDraftFeedback(draftId: number, status: string, operatorReply?: string) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const [draft] = await db.select().from(nickgptDrafts).where(eq(nickgptDrafts.id, draftId)).limit(1);
    if (!draft) return;

    const finalReply = operatorReply || draft.operatorReply || draft.draftReply;
    const approvedForTraining = (status === "approved" || status === "edited");

    // Training-loop signal: classify WHY the operator changed the draft (edits
    // only — an approve-as-is or a reject has no diff to learn from). Pure,
    // best-effort; a classifier miss must never block the capture.
    let editCategoriesJson: string | null = null;
    if (status === "edited") {
      try {
        const { classifyEdit } = await import("./editClassifier");
        const cats = classifyEdit(draft.draftReply, finalReply);
        if (cats.length > 0) editCategoriesJson = JSON.stringify(cats);
      } catch (err) {
        log.warn("classifyEdit failed", { draftId, err: err instanceof Error ? err.message : String(err) });
      }
    }

    await db.insert(nickgptTrainingExamples).values({
      customerPhone: draft.customerPhone,
      inboundMessage: draft.inboundMessage,
      conversationContextJson: JSON.stringify({}),
      nickgptDraft: draft.draftReply,
      operatorFinalReply: finalReply,
      intent: draft.intent || "general",
      serviceMention: null,
      rating: status === "rejected" ? 1 : 5,
      outcome: status,
      editCategoriesJson,
      approvedForTraining,
    });

    // Find the latest inbound sms orchestration for this phone
    const [orch] = await db.select()
      .from(smsOrchestrations)
      .where(
        and(
          eq(smsOrchestrations.customerPhone, draft.customerPhone),
          eq(smsOrchestrations.eventType, "inbound_sms")
        )
      )
      .orderBy(desc(smsOrchestrations.createdAt))
      .limit(1);

    if (orch) {
      let outcomeType = "operator_approved";
      if (status === "edited") outcomeType = "operator_edited";
      if (status === "rejected") outcomeType = "operator_rejected";
      await trackOrchestrationOutcome(orch.id, outcomeType, finalReply, "nickgpt_drafts", String(draftId));
    }
  } catch (err) {
    log.error("Failed to track draft feedback in learning engine", err);
  }
}

export interface DailyReport {
  date: Date;
  totalSent: number;
  totalInbound: number;
  totalAutoSent: number;
  totalNickGptDrafts: number;
  draftsApproved: number;
  draftsEdited: number;
  draftsRejected: number;
  customerReplies: number;
  callbacksCreated: number;
  bookingsCreated: number;
  optOuts: number;
  failedMessages: number;
  queuedMessages: number;
  skippedMessages: number;
  cooldownBlocked: number;
  gatewayOffline: number;
  topQuestions: Array<{ intent: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
  worstErrors: string[];
  trainingExamplesCollected: number;
  nexusDefectsCaught: number;
}

/**
 * Calculates daily SMS metrics.
 */
export async function generateDailySmsReport(date: Date): Promise<DailyReport> {
  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  // 1. Fetch daily orchestrations
  const dailyOrchs = await db.select()
    .from(smsOrchestrations)
    .where(and(gte(smsOrchestrations.createdAt, start), lte(smsOrchestrations.createdAt, end)));

  const filteredOrchs = dailyOrchs.filter(o => !isTestNumber(o.customerPhone));

  // 2. Fetch daily drafts
  const dailyDrafts = await db.select()
    .from(nickgptDrafts)
    .where(and(gte(nickgptDrafts.createdAt, start), lte(nickgptDrafts.createdAt, end)));
  const filteredDrafts = dailyDrafts.filter(d => !isTestNumber(d.customerPhone));

  // 3. Fetch daily outcomes
  const dailyOutcomes = await db.select()
    .from(smsOrchestrationOutcomes)
    .where(and(gte(smsOrchestrationOutcomes.createdAt, start), lte(smsOrchestrationOutcomes.createdAt, end)));

  // 4. Fetch bookings/callbacks created
  const dailyBookings = await db.select()
    .from(bookings)
    .where(and(gte(bookings.createdAt, start), lte(bookings.createdAt, end)));
  const filteredBookings = dailyBookings.filter(b => !isTestNumber(b.phone));

  const dailyCallbacks = await db.select()
    .from(callbackRequests)
    .where(and(gte(callbackRequests.createdAt, start), lte(callbackRequests.createdAt, end)));
  const filteredCallbacks = dailyCallbacks.filter(c => !isTestNumber(c.phone));

  const dailyExamples = await db.select()
    .from(nickgptTrainingExamples)
    .where(and(gte(nickgptTrainingExamples.createdAt, start), lte(nickgptTrainingExamples.createdAt, end)));

  const dailyDefects = await db.select()
    .from(nickgptDefectLedger)
    .where(and(gte(nickgptDefectLedger.createdAt, start), lte(nickgptDefectLedger.createdAt, end)));

  // Aggregations
  const totalSent = filteredOrchs.filter(o => o.status === "sent" || o.status === "delivered").length;
  const totalInbound = filteredOrchs.filter(o => o.eventType === "inbound_sms").length;
  const totalAutoSent = filteredOrchs.filter(o => o.shouldAutoSend && (o.status === "sent" || o.status === "delivered")).length;
  const totalNickGptDrafts = filteredOrchs.filter(o => o.variantKey === "nickgpt_v1").length;

  const draftsApproved = filteredDrafts.filter(d => d.status === "approved").length;
  const draftsEdited = filteredDrafts.filter(d => d.status === "edited").length;
  const draftsRejected = filteredDrafts.filter(d => d.status === "rejected").length;

  const optOuts = dailyOutcomes.filter(o => o.outcomeType === "customer_opted_out").length;
  const failedMessages = filteredOrchs.filter(o => o.status === "failed").length;
  const queuedMessages = filteredOrchs.filter(o => o.status === "queued").length;
  const skippedMessages = filteredOrchs.filter(o => o.status === "skipped").length;
  
  const cooldownBlocked = filteredOrchs.filter(o => o.status === "skipped" && o.statusReason === "cooldown_active").length;
  const gatewayOffline = filteredOrchs.filter(o => o.status === "queued" && o.statusReason === "outside_hours_queued").length;

  // Inbound questions
  const questionMap: Record<string, number> = {};
  for (const d of filteredDrafts) {
    const intent = d.intent || "unknown";
    questionMap[intent] = (questionMap[intent] || 0) + 1;
  }
  const topQuestions = Object.entries(questionMap)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  const sourceCounts = new Map<string, number>();
  for (const o of filteredOrchs) {
    sourceCounts.set(o.eventType, (sourceCounts.get(o.eventType) || 0) + 1);
  }

  const worstErrors = new Map<string, number>();
  filteredOrchs.filter(o => o.status === "failed" && o.failureReason).forEach(o => {
    const reason = o.failureReason!;
    worstErrors.set(reason, (worstErrors.get(reason) || 0) + 1);
  });

  return {
    date,
    totalSent,
    totalInbound,
    totalAutoSent,
    totalNickGptDrafts,
    draftsApproved,
    draftsEdited,
    draftsRejected,
    customerReplies: totalInbound,
    callbacksCreated: filteredCallbacks.length,
    bookingsCreated: filteredBookings.length,
    optOuts,
    failedMessages,
    queuedMessages,
    skippedMessages,
    cooldownBlocked,
    gatewayOffline,
    topQuestions,
    topSources: Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    worstErrors: Array.from(worstErrors.entries())
      .map(([err, count]) => `${err} (${count}x)`)
      .sort((a, b) => {
        const countA = parseInt(a.match(/\((\d+)x\)/)?.[1] || "0");
        const countB = parseInt(b.match(/\((\d+)x\)/)?.[1] || "0");
        return countB - countA;
      })
      .slice(0, 5),
    trainingExamplesCollected: filteredDrafts.filter(d => d.status === "approved" || d.status === "edited").length,
    nexusDefectsCaught: dailyDefects.length,
  };
}

export interface WeeklyReport {
  weekStart: Date;
  weekEnd: Date;
  bestSource: string;
  worstSource: string;
  highestReplyRateTemplate: string;
  lowestReplyRateTemplate: string;
  highestConversionSource: string;
  optOutRateBySource: Array<{ source: string; rate: number }>;
  autoSendAccuracy: number;
  nickgptApprovalRate: number;
  nickgptEditRate: number;
  nickgptRejectionRate: number;
  trainingDatasetGrowth: number;
  estimatedRevenueInfluenced: number;
  top10Questions: Array<{ intent: string; count: number }>;
  recommendedImprovements: string[];
}

/**
 * Calculates weekly CEO report.
 */
export async function generateWeeklySmsReport(weekStart: Date, weekEnd: Date): Promise<WeeklyReport> {
  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  const rangeOrchs = await db.select()
    .from(smsOrchestrations)
    .where(and(gte(smsOrchestrations.createdAt, weekStart), lte(smsOrchestrations.createdAt, weekEnd)));

  const filteredOrchs = rangeOrchs.filter(o => !isTestNumber(o.customerPhone));

  // Load invoices to estimate revenue
  const weekInvoices = await db.select()
    .from(invoices)
    .where(and(gte(invoices.createdAt, weekStart), lte(invoices.createdAt, weekEnd)));
  
  // Calculate conversions (how many customers received outbound and then booked/bought)
  const sourceStats: Record<string, { sent: number; replies: number; bookings: number; revenue: number; optOuts: number }> = {};

  for (const o of filteredOrchs) {
    if (o.status === "failed" || o.status === "skipped" || o.status === "received") continue;
    const src = o.eventType;
    if (!sourceStats[src]) {
      sourceStats[src] = { sent: 0, replies: 0, bookings: 0, revenue: 0, optOuts: 0 };
    }
    sourceStats[src].sent++;

    // Did they reply?
    const hasReply = filteredOrchs.some(inb => inb.eventType === "inbound_sms" && inb.customerPhone === o.customerPhone && inb.createdAt > o.createdAt && (inb.createdAt.getTime() - o.createdAt.getTime() < 48 * 60 * 60 * 1000));
    if (hasReply) sourceStats[src].replies++;

    // Did they opt out?
    const hasOptOut = o.statusReason === "customer_opted_out" || o.reason === "customer_opted_out_status_true";
    if (hasOptOut) sourceStats[src].optOuts++;
    
    // Connect downstream bookings
    const limitDate = new Date(o.createdAt.getTime() + 48 * 60 * 60 * 1000);
    const hasBooking = await db.select()
      .from(bookings)
      .where(and(like(bookings.phone, `%${o.customerPhone}`), gte(bookings.createdAt, o.createdAt), lte(bookings.createdAt, limitDate)))
      .limit(1);

    if (hasBooking.length > 0) {
      sourceStats[src].bookings++;
    }

    // Connect invoice value
    const limitInvoice = new Date(o.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const hasInvoice = weekInvoices.find(inv => inv.customerPhone && inv.customerPhone.replace(/\D/g, "").slice(-10) === o.customerPhone && inv.createdAt >= o.createdAt && inv.createdAt <= limitInvoice);
    if (hasInvoice) {
      sourceStats[src].revenue += hasInvoice.totalAmount / 100;
    }
  }

  // Calculate top/worst sources
  let bestSource = "none";
  let worstSource = "none";
  let maxConvRate = -1;
  let minConvRate = 999;
  let highestConversionSource = "none";

  for (const [src, stats] of Object.entries(sourceStats)) {
    if (stats.sent < 5) continue; // Minimum threshold
    const convRate = stats.bookings / stats.sent;
    if (convRate > maxConvRate) {
      maxConvRate = convRate;
      bestSource = src;
      highestConversionSource = src;
    }
    if (convRate < minConvRate) {
      minConvRate = convRate;
      worstSource = src;
    }
  }

  // AI draft performance
  const rangeDrafts = await db.select()
    .from(nickgptDrafts)
    .where(and(gte(nickgptDrafts.createdAt, weekStart), lte(nickgptDrafts.createdAt, weekEnd)));
  const filteredDrafts = rangeDrafts.filter(d => !isTestNumber(d.customerPhone));

  const apps = filteredDrafts.filter(d => d.status === "approved").length;
  const eds = filteredDrafts.filter(d => d.status === "edited").length;
  const rejs = filteredDrafts.filter(d => d.status === "rejected").length;
  const totalDrafted = apps + eds + rejs;

  const nickgptApprovalRate = totalDrafted > 0 ? (apps / totalDrafted) * 100 : 0;
  const nickgptEditRate = totalDrafted > 0 ? (eds / totalDrafted) * 100 : 0;
  const nickgptRejectionRate = totalDrafted > 0 ? (rejs / totalDrafted) * 100 : 0;
  const autoSendAccuracy = (apps + eds) > 0 ? (apps / (apps + eds)) * 100 : 100;

  const datasetSize = await db.select({ count: sql`count(*)` })
    .from(nickgptTrainingExamples)
    .where(eq(nickgptTrainingExamples.approvedForTraining, true));

  // Estimated Revenue Influenced
  const estimatedRevenueInfluenced = Object.values(sourceStats).reduce((acc, curr) => acc + curr.revenue, 0);

  // Inbound questions
  const qMap: Record<string, number> = {};
  for (const d of filteredDrafts) {
    const intent = d.intent || "general";
    qMap[intent] = (qMap[intent] || 0) + 1;
  }
  const top10Questions = Object.entries(qMap)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const optOutRateBySource = Object.entries(sourceStats).map(([src, stats]) => ({
    source: src,
    rate: stats.sent > 0 ? (stats.optOuts / stats.sent) * 100 : 0
  }));

  const recommendedImprovements: string[] = [];
  if (nickgptEditRate > 30) {
    recommendedImprovements.push("NickGPT edit rate is high. Consider exporting the training corpus to retune prompts.");
  }
  if (minConvRate < 0.05 && worstSource !== "none") {
    recommendedImprovements.push(`Source '${worstSource}' has low booking conversion. Review and update variants.`);
  }

  return {
    weekStart,
    weekEnd,
    bestSource,
    worstSource,
    highestReplyRateTemplate: "booking_reminder", // Placeholder or dynamic if template performance is mapped
    lowestReplyRateTemplate: "review_request",
    highestConversionSource,
    optOutRateBySource,
    autoSendAccuracy,
    nickgptApprovalRate,
    nickgptEditRate,
    nickgptRejectionRate,
    trainingDatasetGrowth: Number(datasetSize[0]?.count || 0),
    estimatedRevenueInfluenced,
    top10Questions,
    recommendedImprovements
  };
}

export interface VariantPerformance {
  variantKey: string;
  sentCount: number;
  deliveredCount: number;
  replyCount: number;
  replyRate: number;
  callbackCount: number;
  bookingCount: number;
  conversionRate: number;
  optOutCount: number;
  complaintCount: number;
  operatorEditCount: number;
  failureCount: number;
}

/**
 * Calculates metrics by variantKey.
 */
export async function getSmsVariantPerformance(opts: { eventType: string; days: number }): Promise<VariantPerformance[]> {
  const db = await getDbTyped();
  if (!db) return [];

  const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);

  const orchs = await db.select()
    .from(smsOrchestrations)
    .where(
      and(
        eq(smsOrchestrations.eventType, opts.eventType),
        gte(smsOrchestrations.createdAt, cutoff)
      )
    );

  const filteredOrchs = orchs.filter(o => !isTestNumber(o.customerPhone));
  
  const variantMap: Record<string, VariantPerformance> = {};

  for (const o of filteredOrchs) {
    const key = o.variantKey || "unknown";
    if (!variantMap[key]) {
      variantMap[key] = {
        variantKey: key,
        sentCount: 0,
        deliveredCount: 0,
        replyCount: 0,
        replyRate: 0,
        callbackCount: 0,
        bookingCount: 0,
        conversionRate: 0,
        optOutCount: 0,
        complaintCount: 0,
        operatorEditCount: 0,
        failureCount: 0
      };
    }

    const stat = variantMap[key];
    if (o.status === "sent" || o.status === "delivered") {
      stat.sentCount++;
      stat.deliveredCount++;
    } else if (o.status === "failed") {
      stat.failureCount++;
    }

    // Did they reply?
    const hasReply = filteredOrchs.some(inb => inb.eventType === "inbound_sms" && inb.customerPhone === o.customerPhone && inb.createdAt > o.createdAt && (inb.createdAt.getTime() - o.createdAt.getTime() < 48 * 60 * 60 * 1000));
    if (hasReply) stat.replyCount++;

    // Booking conversions
    const limitDate = new Date(o.createdAt.getTime() + 48 * 60 * 60 * 1000);
    const hasBooking = await db.select()
      .from(bookings)
      .where(and(like(bookings.phone, `%${o.customerPhone}`), gte(bookings.createdAt, o.createdAt), lte(bookings.createdAt, limitDate)))
      .limit(1);
    if (hasBooking.length > 0) stat.bookingCount++;

    // Callbacks
    const hasCallback = await db.select()
      .from(callbackRequests)
      .where(and(like(callbackRequests.phone, `%${o.customerPhone}`), gte(callbackRequests.createdAt, o.createdAt), lte(callbackRequests.createdAt, limitDate)))
      .limit(1);
    if (hasCallback.length > 0) stat.callbackCount++;

    // Opt outs
    if (o.statusReason === "customer_opted_out") {
      stat.optOutCount++;
    }
  }

  // Calculate rates
  return Object.values(variantMap).map(v => {
    v.replyRate = v.sentCount > 0 ? (v.replyCount / v.sentCount) * 100 : 0;
    v.conversionRate = v.sentCount > 0 ? (v.bookingCount / v.sentCount) * 100 : 0;
    return v;
  });
}

/**
 * Nightly cron learning job.
 */
export async function processSmsLearningDigest() {
  const db = await getDbTyped();
  if (!db) return;

  log.info("Processing SMS self-learning digest...");

  try {
    const datasetSizeRows = await db.select({ count: sql`count(*)` })
      .from(nickgptTrainingExamples)
      .where(eq(nickgptTrainingExamples.approvedForTraining, true));
    const datasetSize = Number(datasetSizeRows[0]?.count || 0);

    // Edit-taxonomy signal: aggregate WHY operators edited drafts over the last
    // 30 days. A dominant category (e.g. too_long) is a concrete prompt-fix lead
    // — evidence for the operator, not an auto-action.
    let editTally: Record<string, number> = {};
    let editedCount = 0;
    try {
      const { tallyEditCategories } = await import("./editClassifier");
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const edited = await db.select({ cats: nickgptTrainingExamples.editCategoriesJson })
        .from(nickgptTrainingExamples)
        .where(and(
          eq(nickgptTrainingExamples.outcome, "edited"),
          gte(nickgptTrainingExamples.createdAt, since),
        ));
      editedCount = edited.length;
      editTally = tallyEditCategories(edited.map((r) => {
        try { return r.cats ? (JSON.parse(r.cats) as string[]) : null; } catch { return null; }
      }));
    } catch (err) {
      log.warn("edit-category tally failed", { err: err instanceof Error ? err.message : String(err) });
    }
    const topEdit = Object.entries(editTally).sort((a, b) => b[1] - a[1])[0];

    // Threshold recommendations
    let promptUpgrade = false;
    let fineTuneThreshold = "none";
    if (datasetSize >= 1000) {
      fineTuneThreshold = "strong fine-tune dataset reached (1000+ examples)";
    } else if (datasetSize >= 500) {
      fineTuneThreshold = "real fine-tune candidate reached (500+ examples)";
    } else if (datasetSize >= 200) {
      fineTuneThreshold = "small fine-tune test ready (200+ examples)";
    } else if (datasetSize >= 50) {
      fineTuneThreshold = "prompt improvement available (50+ examples)";
      promptUpgrade = true;
    }

    if (fineTuneThreshold !== "none") {
      // Check if recommendation already exists to prevent duplicate entries
      const [existing] = await db.select()
        .from(smsLearningRecommendations)
        .where(
          and(
            eq(smsLearningRecommendations.recommendationType, "fine_tune_ready"),
            eq(smsLearningRecommendations.status, "pending")
          )
        )
        .limit(1);

      if (!existing) {
        await db.insert(smsLearningRecommendations).values({
          recommendationType: "fine_tune_ready",
          eventType: "system",
          currentVariantKey: "ollama_3b_v1",
          proposedVariantKey: "ollama_3b_v2",
          proposedMessage: "Operator-gated: review, then run the NickGPT fine-tune/prompt update. This recommendation never auto-triggers a fine-tune.",
          reason: `Training set reached ${datasetSize} examples (${fineTuneThreshold}).`
            + (topEdit ? ` Top operator-edit pattern (last 30d, ${editedCount} edits): ${topEdit[0]} (${topEdit[1]}). Consider a prompt fix before/with any fine-tune.` : ""),
          supportingStatsJson: JSON.stringify({ datasetSize, promptUpgrade, editedCount, editTally }),
          status: "pending",
        });
        log.info("Learning engine recommended NickGPT fine-tune upgrade!");
      }
    }
  } catch (err) {
    log.error("Failed to run learning digest cron", err);
  }
}

/**
 * Dispatches the daily SMS digest to Telegram via the core notifyOwner hook.
 */
export async function sendDailySmsReportToTelegram(): Promise<boolean> {
  try {
    const report = await generateDailySmsReport(new Date(Date.now() - 24 * 60 * 60 * 1000));
    
    const digestText = `SMS Engine Yesterday:
Sent: ${report.totalSent}
Inbound: ${report.totalInbound}
Auto-replies: ${report.totalAutoSent}
NickGPT drafts: ${report.totalNickGptDrafts}
Bookings from SMS: ${report.bookingsCreated}
Callbacks created: ${report.callbacksCreated}
Failed/queued: ${report.failedMessages}/${report.queuedMessages}
Nexus defects caught: ${report.nexusDefectsCaught}
Top question: ${report.topQuestions[0]?.intent || "none"}
Training examples: ${report.trainingExamplesCollected}`;

    return await notifyOwner({
      title: "SMS Operating System Daily Summary",
      content: digestText
    });
  } catch (err) {
    log.error("Failed to send daily SMS report to Telegram", err);
    return false;
  }
}

/**
 * Stages a Nexus LLM defect into the training set for future model tuning.
 * The defect acts as a negative example (rating=1), queued for operator correction.
 */
export async function stageNexusDefectForTraining(defectId: number) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const [defect] = await db.select()
      .from(nickgptDefectLedger)
      .where(eq(nickgptDefectLedger.id, defectId))
      .limit(1);

    if (!defect) return;

    if (defect.exportedToTraining) {
      log.info(`Defect ${defectId} already exported to training.`);
      return;
    }

    let breakdown = "Unknown Nexus Defect";
    try {
      if (defect.diagnosticBreakdownJson) {
        const parsed = JSON.parse(defect.diagnosticBreakdownJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          breakdown = parsed.map((p: any) => `[${p.code}] ${p.finding}`).join(" | ");
        }
      }
    } catch(e) {}

    let draftContent = "";
    let inserted = false;

    // We try to pull from nickgptDrafts if linked
    if (defect.nickgptDraftId) {
      const [draft] = await db.select()
        .from(nickgptDrafts)
        .where(eq(nickgptDrafts.id, defect.nickgptDraftId))
        .limit(1);
      
      if (draft) {
        draftContent = draft.draftReply;
        await db.insert(nickgptTrainingExamples).values({
          customerPhone: draft.customerPhone,
          inboundMessage: draft.inboundMessage,
          conversationContextJson: JSON.stringify({
             nexusDefectReason: breakdown
          }),
          nickgptDraft: draftContent,
          operatorFinalReply: "", // Needs human to provide the correction
          intent: draft.intent || "general",
          serviceMention: null,
          rating: 1, // Bad response
          outcome: "rejected_by_nexus",
          approvedForTraining: false, // Must be approved by human operator after correction
        });
        inserted = true;
      }
    } 
    
    if (!inserted && defect.orchestrationId) {
       // Fallback to orchestration table
       // Using `any` type for ID to bypass TS string/number mismatch on Drizzle ID if any.
       const [orch] = await db.select().from(smsOrchestrations).where(eq(smsOrchestrations.id, defect.orchestrationId as any)).limit(1);
       if (orch) {
          await db.insert(nickgptTrainingExamples).values({
            customerPhone: orch.customerPhone,
            inboundMessage: "Context unavailable (orchestrator level)",
            conversationContextJson: JSON.stringify({
               nexusDefectReason: breakdown
            }),
            nickgptDraft: orch.messageBody,
            operatorFinalReply: "", 
            intent: "general",
            rating: 1,
            outcome: "rejected_by_nexus",
            approvedForTraining: false,
          });
          inserted = true;
       }
    }

    if (inserted) {
      await db.update(nickgptDefectLedger)
        .set({ exportedToTraining: 1 })
        .where(eq(nickgptDefectLedger.id, defectId));

      log.info(`Staged Nexus defect ${defectId} into training examples.`);
    } else {
      log.warn(`Could not find draft or orchestration context for Nexus defect ${defectId}`);
    }
  } catch (err) {
    log.error(`Failed to stage Nexus defect ${defectId} for training`, err);
  }
}

/**
 * Pipeline Controller — Nick's Nervous System
 *
 * Everything flows through Nick, both directions, full circle:
 *
 * INBOUND (receiving):
 *   nickstire.org → bridge events → NOUR OS (bookings, leads, reviews, emergencies)
 *   Cron jobs → brain cycle → memory layers → system prompt
 *   User actions → habit toggles, brain dumps → learning pipeline
 *
 * OUTBOUND (sending):
 *   Nick decisions → shop actions (SMS, lead updates, estimates)
 *   Nick analysis → drift alerts, predictions, reflections
 *   Nick memory → knowledge compilation → next prompt (self-improving loop)
 *
 * CIRCULAR (self-reinforcing):
 *   Event → Memory → Reflection → Prediction → Action → Event (new cycle)
 *   Every action creates a new event that feeds back into the memory tree.
 *
 * This controller orchestrates the full cycle.
 */

import { prisma } from "@/lib/prisma";
import { readNickRevenue } from "@/lib/nickstire/revenue";
import { brainMemory } from "@/lib/brain/memory-manager";
import { connect } from "@/lib/brain/relational-graph";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/pipeline-controller");
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("pipeline-controller");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { VALID_MOODS, simpleHash } from "@/lib/brain/journal-ingest";
import { today } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ─── INBOUND: Process events from nickstire.org ──────────

export interface ShopEvent {
  type: "booking" | "lead" | "review" | "invoice" | "stage-change" | "campaign" | "emergency" | "call";
  data: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Process an inbound shop event — store it, learn from it, connect it.
 * Called from /api/sync/events when nickstire.org sends bridge events.
 */
export async function processShopEvent(event: ShopEvent): Promise<{ processed: boolean; actions: string[] }> {
  const actions: string[] = [];

  // 1. Store as brain memory
  const memKey = `shop_${event.type}_${Date.now()}`;
  const memContent = `Shop ${event.type}: ${JSON.stringify(event.data).slice(0, 300)}`;
  await brainMemory.remember("business_event", memKey, memContent, "bridge_pipeline");
  actions.push("memory.stored");

  // 2. Analyze for patterns based on event type
  switch (event.type) {
    case "booking": {
      // Track booking patterns
      const hour = new Date().getHours();
      await brainMemory.remember(
        "pattern",
        `booking_hour_${hour}`,
        `Booking received at ${hour}:00 — ${event.data.service || "unknown service"}`,
        "pipeline_analysis"
      );
      actions.push("pattern.booking_time");
      break;
    }

    case "lead": {
      // Track lead source effectiveness
      const source = String(event.data.source || "unknown");
      await brainMemory.remember(
        "insight",
        `lead_source_${source}_${today()}`,
        `New lead from ${source}: ${event.data.name || "unknown"} — ${event.data.service || "inquiry"}`,
        "pipeline_analysis"
      );

      // Connect lead to relevant patterns
      if (event.data.id) {
        await connect(
          { type: "memory", id: memKey },
          { type: "pattern", id: `lead_source_${source}` },
          "relates_to",
          `Lead from ${source}`
        );
      }
      actions.push("insight.lead_source");
      break;
    }

    case "review": {
      // Track review sentiment
      const rating = Number(event.data.rating || 0);
      if (rating >= 4) {
        await brainMemory.remember(
          "insight",
          `review_positive_${today()}`,
          `Positive review (${rating}/5): ${String(event.data.text || "").slice(0, 100)}`,
          "pipeline_analysis"
        );
      } else if (rating > 0) {
        await brainMemory.remember(
          "business_alert",
          `review_negative_${today()}`,
          `Low review (${rating}/5): ${String(event.data.text || "").slice(0, 100)} — NEEDS RESPONSE`,
          "pipeline_analysis"
        );
      }
      actions.push("insight.review_tracked");
      break;
    }

    case "emergency": {
      // Emergency events get highest priority memory
      await brainMemory.remember(
        "anomaly",
        `emergency_${Date.now()}`,
        `EMERGENCY: ${JSON.stringify(event.data).slice(0, 200)}`,
        "pipeline_analysis"
      );
      actions.push("alert.emergency");
      break;
    }

    case "call": {
      const duration = Number(event.data.durationSeconds || 0);
      const phone = String(event.data.phone || "unknown");
      await brainMemory.remember(
        "insight",
        `call_completed_${Date.now()}`,
        `Phone call from ${phone} ended. Duration: ${duration}s. Reason: ${event.data.endedReason || "unknown"}. Mentioned: ${event.data.serviceMention || "none"}.`,
        "pipeline_analysis"
      );
      actions.push("insight.call");
      break;
    }
  }

  // 3. Update environmental signals if business-relevant
  if (event.type === "booking" || event.type === "lead") {
    const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
    // EnvironmentalSignal model removed — no-op
    void dayOfWeek;
    actions.push("signal.operational");
  }

  // v11.1 · Load-bearing business data now queries nickstire instead
  // of empty stubs. Graceful degradation: unknown query actions
  // return { error }, causing insights to simply not fire — never
  // throws, never breaks the event flow.
  const { queryNick, queryNickBatch } = await import("@/lib/nickstire/query");

  // 4. Cross-reference with existing data for deeper insights
  if (event.type === "lead" || event.type === "booking") {
    const customerName = String(event.data.name || event.data.customerName || "");
    if (customerName.length > 2) {
      // 2026-05-30 · three wiring bugs killed repeat-customer detection:
      // (1) handler reads `filters.term`, not `name` → it errored out every
      //     time ("Search term required");
      // (2) it returns `{ customers, count }`, not a bare array → the old
      //     Array.isArray(res.data) check was always false;
      // (3) fields are `totalVisits` / `totalSpent`, not `visitCount` /
      //     `totalSpend`. All three corrected against nour-os-query.ts.
      type NickCustomerRow = { totalVisits: number; totalSpent: number; segment: string };
      const res = await queryNick("customer_search", { term: customerName });
      const matches =
        "data" in res && Array.isArray((res.data as { customers?: unknown[] })?.customers)
          ? (res.data as { customers: NickCustomerRow[] }).customers
          : [];
      const existingCustomer = matches.length > 0 ? matches[0] : null;

      if (existingCustomer && Number(existingCustomer.totalVisits) > 1) {
        // v10.0.38 — PII fix. Pre-fix: customer full name was the
        // memory key + appeared verbatim in the brain content +
        // surfaced into system prompts forever. Now: hash the name
        // for the key, store only business-relevant fields (visit
        // count, segment, spend tier) — no name in content.
        const nameHash = (await import("crypto"))
          .createHash("sha1")
          .update(customerName.toLowerCase().trim())
          .digest("hex")
          .slice(0, 12);
        // Bridge JSON can deliver totalSpent as a string (TiDB DECIMAL
        // serializes to a string in some driver configs); Number() keeps
        // the tier thresholds robust to either number-or-string shape.
        const spent = Number(existingCustomer.totalSpent);
        const spendTier =
          spent >= 5000 ? "high" : spent >= 1000 ? "mid" : "starter";
        await brainMemory.remember(
          "insight",
          `repeat_customer_${nameHash}_${today()}`,
          `REPEAT CUSTOMER (${existingCustomer.totalVisits} visits, ${spendTier}-spend, segment: ${existingCustomer.segment}). High-value — prioritize.`,
          "pipeline_analysis"
        );
        actions.push("insight.repeat_customer");
      }
    }
  }

  // 5. Trend detection — compare today vs recent averages
  if (event.type === "booking" || event.type === "lead") {
    const batch = await queryNickBatch([
      { query: "leads_today_count" },
      { query: "leads_week_count" },
    ]);
    const todayWrap = batch["leads_today_count"] as { data?: unknown } | undefined;
    const weekWrap = batch["leads_week_count"] as { data?: unknown } | undefined;
    const todayCount =
      typeof todayWrap?.data === "number"
        ? (todayWrap!.data as number)
        : ((todayWrap?.data as { count?: number } | undefined)?.count ?? 0);
    const weekTotal =
      typeof weekWrap?.data === "number"
        ? (weekWrap!.data as number)
        : ((weekWrap?.data as { count?: number } | undefined)?.count ?? 0);
    const weekAvg = Math.round(weekTotal / 7);

    if (todayCount > weekAvg * 1.5 && weekAvg > 0) {
      await brainMemory.remember(
        "business_alert",
        `lead_surge_${today()}`,
        `LEAD SURGE: ${todayCount} leads today vs ${weekAvg}/day average. Capitalize — respond fast.`,
        "pipeline_analysis"
      );
      actions.push("alert.lead_surge");
    } else if (todayCount === 0 && new Date().getHours() > 14) {
      await brainMemory.remember(
        "business_alert",
        `lead_drought_${today()}`,
        `NO LEADS TODAY (past 2pm). Below ${weekAvg}/day average. Check ad spend, website, phone.`,
        "pipeline_analysis"
      );
      actions.push("alert.lead_drought");
    }
  }

  return { processed: true, actions };
}

// ─── INBOUND: Process chat interactions for learning ──────

/**
 * After every Nick AI chat, extract actionable intelligence.
 * This goes beyond L2 fact extraction — it looks for:
 * - Unresolved questions Nour asked (turn into loops)
 * - Commitments made during conversation (track them)
 * - Emotional state signals (feed into drift detection)
 * - Business decisions discussed (log them)
 */
export async function processConversation(userMessage: string, nickResponse: string): Promise<void> {
  // Only process substantive conversations
  if (userMessage.length < 20 || nickResponse.length < 50) return;

  const result = await aiChat([
    {
      role: "system",
      content: `Extract actionable intelligence from this conversation. Return ONLY JSON:
{
  "commitments": [{"description": "concrete promise", "deadline": "YYYY-MM-DD or null", "toWhom": "self|Dania|specific-name"}],
  "openQuestions": ["questions that were asked but not fully resolved"],
  "emotionalSignals": "one word: calm|stressed|motivated|frustrated|scattered|focused",
  "businessDecisions": ["any business decisions discussed or implied"],
  "keyInsight": "the single most important thing from this conversation (one sentence)"
}

COMMITMENT RULES — be STRICT. Only count it as a commitment if ALL of:
  - Nour made an explicit promise (not a passive thought or idea)
  - It has a concrete action verb with a target object (not "continue", "watch", "request", "will think about")
  - It has EITHER an explicit deadline phrase (today/tomorrow/Friday/by X/this week) OR a specific non-self recipient
  - If neither deadline nor specific recipient, DO NOT extract it
Return empty arrays if nothing found. Be specific, not generic.`,
    },
    { role: "user", content: `Nour said: "${userMessage.slice(0, 500)}"\nNick said: "${nickResponse.slice(0, 500)}"` },
  ], "fast");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extracted = extractJsonObject<any>(result.content);
    if (!extracted.ok) return;
    const intel = extracted.value;

    // Store commitments · v11.1 strict gate — object-shape + must have
    // deadline OR non-self recipient. Chat-artifact pollution killed 29
    // zombie commitments in Apr 21 sweep; this keeps it from recurring.
    if (Array.isArray(intel.commitments)) {
      for (const c of intel.commitments.slice(0, 3)) {
        const desc = typeof c === "string" ? c : c?.description;
        const deadline = typeof c === "object" && c?.deadline && c.deadline !== "null" ? c.deadline : null;
        const toWhom = typeof c === "object" && c?.toWhom ? c.toWhom : "self";

        if (typeof desc !== "string" || desc.length < 15) continue;
        // Reject chat-artifact phrasings
        if (/^(will |continue |watch |request|generate|get |remember |implement(ing)? |use |add |create |schedule )/i.test(desc) && !deadline && toWhom === "self") continue;
        // Must have deadline OR non-self recipient
        if (!deadline && toWhom === "self") continue;

        const dbCommitment = await prisma.commitment.create({
          data: { dateMade: today(), description: desc, toWhom, domain: null, deadline, status: "active" },
        }).catch((err) => {
          recordError("brain:pipeline-controller", err, { phase: "commitment-create", desc: desc.slice(0, 80) });
          return null;
        });

        // Also record as a WITNESSED_COMMITMENT agenda item
        await prisma.agendaItem.create({
          data: {
            title: desc.slice(0, 100),
            description: desc,
            category: "WITNESSED_COMMITMENT",
            status: "ACTIVE",
            source: "chat",
            sourceId: String(dbCommitment?.id || "extracted-post-turn"),
            dueDate: deadline ? new Date(deadline) : null,
            metadata: {
              toWhom,
              legacyCommitmentId: dbCommitment?.id,
            }
          }
        }).catch((err) => {
          console.error("Failed to create AgendaItem for witnessed commitment:", err);
        });
      }
    }

    // Apr 18 — open-questions → open-loops extraction retired along
    // with the OpenLoop surface sunsetting. Questions surface via
    // search + chat recall instead; no dedicated loop row needed.
    void intel.openQuestions; // silence unused key

    // Store emotional signal for drift detection
    // v10.0.233 · validate against VALID_MOODS allowlist · pre-fix
    // any free-form AI string got persisted, polluting the
    // emotional-arc tracker. Same class of bug as journal-ingest's
    // mood gate (fixed v10.0.232).
    if (
      intel.emotionalSignals &&
      typeof intel.emotionalSignals === "string" &&
      VALID_MOODS.has(intel.emotionalSignals.toLowerCase())
    ) {
      await brainMemory.remember(
        "emotional_state",
        `mood_${today()}_${new Date().getHours()}`,
        `Emotional state at ${new Date().getHours()}:00: ${intel.emotionalSignals.toLowerCase()}`,
        "conversation_analysis"
      );
    }

    // Store key insight
    // v10.0.233 · deterministic key from content hash · pre-fix used
    // Date.now() which meant the same insight stored twice on retry/
    // restart. Now: simpleHash(insight) so re-inserting is a no-op
    // via brainMemory.remember's upsert semantic.
    if (intel.keyInsight && typeof intel.keyInsight === "string" && intel.keyInsight.length > 10) {
      const norm = intel.keyInsight.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
      await brainMemory.remember(
        "insight",
        `conversation_insight_${today()}_${simpleHash(norm).slice(0, 8)}`,
        intel.keyInsight,
        "conversation_analysis"
      );
    }
  } catch (err) { 
    // parsing failed — non-critical
    logError("brain.pipeline-controller", err, { fn: "processConversation" });
  }
}

// ─── OUTBOUND: Proactive alerts (Nick initiates) ──────────

/**
 * Read the latest ceo_business_context payload from nickstire sync.
 * v10.0.529.106 · Wave 58 · replaces the prior `Promise.resolve(0)`
 * placeholder paths · the data IS available via the 4-hourly nickstire
 * sync (see app/api/sync/business/route.ts) but pipeline-controller
 * was never wired to read it. Returns null when no sync has landed yet
 * or the payload shape is unexpected · downstream code guards on null.
 */
async function readCeoSnapshot(): Promise<{
  staleNewEstimates7d: number;
  newCallbacks: number;
} | null> {
  const event = await prisma.auditEvent.findFirst({
    where: { eventType: "ceo_business_context" },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  }).catch((err) => {
    logError("brain.pipeline-controller", err, { fn: "readCeoSnapshot.findEvent" });
    return null;
  });
  if (!event?.payload) return null;
  // Reject stale snapshots (> 24h old · nickstire sync runs every 4h
  // so anything older than 24h means the bridge is down · don't fire
  // on stale data, that's how false alarms happen).
  const ageMs = Date.now() - event.createdAt.getTime();
  if (ageMs > 24 * 3600_000) return null;
  const p = event.payload as Record<string, unknown>;
  const funnel = p.estimateLeadFunnel as Record<string, unknown> | undefined;
  const last7 = funnel?.last7d as Record<string, unknown> | undefined;
  const callbacks = p.callbacks as Record<string, unknown> | undefined;
  const n = (v: unknown): number => typeof v === "number" ? v : Number(v) || 0;
  return {
    staleNewEstimates7d: n(last7?.staleNewEstimates),
    newCallbacks: n(callbacks?.new),
  };
}

/**
 * Nick proactively checks for situations that need attention.
 * Runs as part of the brain cycle. Doesn't wait to be asked.
 *
 * v10.0.529.106 · Wave 58 · pre-Wave-58 this function was permanently
 * broken · `staleQuotes` and `unansweredLeads` were both
 * `Promise.resolve(0)` so the alert branches never fired even when
 * the shop had stale work. Now reads from the ceo_business_context
 * auditEvent populated by the 4-hourly nickstire sync. When the
 * bridge is down (no snapshot in 24h) the function fails closed
 * (skips business alerts but still runs commitment health below).
 */
export async function proactiveAlerts(): Promise<{ alerts: string[] }> {
  const alerts: string[] = [];

  const ceo = await readCeoSnapshot();

  // Check for stale estimates (no follow-up in 48h+)
  const staleQuotes = ceo?.staleNewEstimates7d ?? 0;

  if (staleQuotes > 0) {
    await brainMemory.remember(
      "business_alert",
      `stale_estimates_${today()}`,
      `${staleQuotes} estimates sent but no follow-up in 48+ hours. Each one is revenue bleeding.`,
      "proactive_alert"
    );
    alerts.push(`${staleQuotes} stale estimates`);
    // OpenLoop auto-create retired Apr 18 — stale-estimate follow-up
    // lives in nickstire admin. Alert above still fires for awareness.
  }

  // Check for unanswered callback requests during business hours
  // (the nickstire sync gives us a count of new/un-replied callbacks ·
  // pre-Wave-58 this used a separate `unansweredLeads` field that
  // didn't exist · using `newCallbacks` is the closest live signal).
  const hour = new Date().getHours();
  if (hour >= 8 && hour <= 18) {
    const unansweredLeads = ceo?.newCallbacks ?? 0;

    if (unansweredLeads > 0) {
      await brainMemory.remember(
        "business_alert",
        `unanswered_leads_${today()}_${hour}`,
        `${unansweredLeads} callback requests waiting. Response time is the #1 conversion factor.`,
        "proactive_alert"
      );
      alerts.push(`${unansweredLeads} unanswered callbacks`);
      // OpenLoop auto-create retired Apr 18 — lead follow-up belongs
      // in nickstire admin. Alert above still fires for awareness.
    }
  }

  // Check commitment health
  const overdueCommitments = await prisma.commitment.count({
    where: {
      status: "active",
      deadline: { lt: today() },
    },
  }).catch((err) => {
    logError("brain.pipeline-controller", err, { fn: "proactiveAlerts.countOverdueCommitments" });
    return 0;
  });

  if (overdueCommitments > 0) {
    await brainMemory.remember(
      "business_alert",
      `overdue_commitments_${today()}`,
      `${overdueCommitments} commitments past deadline. Broken promises erode self-trust.`,
      "proactive_alert"
    );
    alerts.push(`${overdueCommitments} overdue commitments`);
    // OpenLoop auto-create retired Apr 18 — duplicated the
    // Nick-Noticed "Overdue" insight which already renders inline.
  }

  return { alerts };
}

// ─── OUTBOUND: Nick-initiated actions toward nickstire ────

/**
 * Nick's daily shop intelligence brief — auto-generated from all data.
 * Runs as part of the morning cron. Sends insights BACK to the shop.
 */
export async function generateShopIntelligence(): Promise<{ brief: string; actions: string[] }> {
  const actions: string[] = [];

  // Gather all relevant data
  const [recentMemories, predictions, contradictions, chains] = await Promise.all([
    prisma.brainMemory.findMany({
      // v10.0.38 — `deletedAt: null` filter. Pre-fix soft-deleted
      // memories were polluting the daily intelligence brief.
      where: {
        category: { in: ["business_event", "business_alert", "insight", "pattern"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { category: true, content: true },
    }),
    prisma.prediction.findMany({
      where: { status: "pending", category: BRAIN_CATEGORIES.BUSINESS },
      take: 5,
      select: { prediction: true, confidence: true },
    }),
    prisma.contradiction.findMany({
      where: { resolved: false, category: BRAIN_CATEGORIES.BUSINESS },
      take: 3,
      select: { claim: true, reality: true },
    }),
    prisma.causalChain.findMany({
      where: { broken: false },
      orderBy: { frequency: "desc" },
      take: 3,
      select: { effect: true, rootCause: true, intervention: true },
    }),
  ]);

  const context = [
    `Recent events: ${recentMemories.map(m => `[${m.category}] ${m.content.slice(0, 80)}`).join("; ")}`,
    `Predictions: ${predictions.map(p => `(${(p.confidence * 100).toFixed(0)}%) ${p.prediction.slice(0, 80)}`).join("; ")}`,
    `Contradictions: ${contradictions.map(c => `"${c.claim.slice(0, 40)}" vs "${c.reality.slice(0, 40)}"`).join("; ")}`,
    `Causal chains: ${chains.map(c => `"${c.effect.slice(0, 40)}" ← "${c.rootCause.slice(0, 40)}"`).join("; ")}`,
  ].join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are Nick generating a shop intelligence brief. Produce a concise, actionable brief for the shop owner.
Format: 3 sections max. Each section: header + 2-3 bullet points. Total under 200 words.
Focus on: what to do TODAY, what money is on the table, what risks to watch.`,
    },
    { role: "user", content: context },
  ], "fast");

  actions.push("brief.generated");

  return { brief: result.content, actions };
}

// ─── CIRCULAR: Self-reinforcing feedback loop ────────────

/**
 * After any action is taken, feed the result back into the memory system.
 * This creates the circular loop: action → memory → reflection → better action.
 */
export async function feedbackLoop(actionType: string, actionResult: unknown, context: string): Promise<void> {
  // v10.0.38 — capture the key once. Pre-fix two Date.now() calls
  // were inlined here and below in connect(); the second timestamp
  // was almost always >1ms after the first, so the graph edge
  // pointed at a memory id that didn't exist → orphan edge polluting
  // the relational graph forever.
  const memoryKey = `action_${actionType}_${Date.now()}`;
  // Store action outcome as memory
  await brainMemory.remember(
    "action_outcome",
    memoryKey,
    `Action: ${actionType} | Result: ${(JSON.stringify(actionResult) ?? "undefined").slice(0, 200)} | Context: ${context.slice(0, 100)}`,
    "feedback_loop"
  );

  // Connect the action to its context
  await connect(
    { type: "memory", id: memoryKey },
    { type: "pattern", id: actionType },
    "follows",
    `Action taken: ${actionType}`
  ).catch((err) => {
    recordError("brain:pipeline-controller", err, { phase: "action-connect", actionType, memoryKey });
  });

  // Track action frequency for self-optimization
  const existing = await prisma.brainMemory.findFirst({
    where: { category: BRAIN_CATEGORIES.ACTION_FREQUENCY, key: `freq_${actionType}`, deletedAt: null }, // v10.0.66
  });

  if (existing) {
    await brainMemory.reinforce(existing.id, `${actionType}: executed ${existing.seenCount + 1} times. Last: ${today()}`);
  } else {
    await brainMemory.remember(
      "action_frequency",
      `freq_${actionType}`,
      `${actionType}: first execution on ${today()}`,
      "feedback_loop"
    );
  }
}

// ─── CONTINUOUS BRAIN: Cross-reference everything ──────────

/**
 * runBrainCycle — The brain's continuous processing loop.
 * Called by crons. Synthesizes ALL data sources, detects cross-domain patterns,
 * generates proactive alerts, and keeps everything in order.
 *
 * This is what makes the brain feel alive — it's always thinking, always connecting.
 */
export async function runBrainCycle(): Promise<{ alerts: string[]; patterns: string[]; synced: boolean }> {
  const alerts: string[] = [];
  const patterns: string[] = [];

  try {
    // ── Gather state from ALL sources ──
    // Apr 17 sweep: openLoop/dailyScore retired → rename locally to
    // `openTasks` (Task INBOX + READY + DOING) so downstream pattern
    // strings and brain insights stop saying "open loops". Messages
    // below updated to "open tasks" for clarity.
    const [
      recentScores,
      openTasks,
      activeCommitments,
      pageVisits,
      recentConversations,
      driftAlerts,
      latestBusinessSync,
      bodyData,
      recentMemories,
    ] = await Promise.all([
      prisma.reflection.findMany({
        where: { deletedAt: null }, // v10.0.68
        orderBy: { date: "desc" },
        take: 7,
        select: { date: true, confidence: true, category: true },
      }),
      prisma.task.count({
        where: { status: { in: ["INBOX", "READY", "DOING"] } },
      }),
      prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }),
      prisma.auditEvent.findMany({
        where: { eventType: "page_visit", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        select: { detail: true, payload: true },
      }).catch((err): never[] => {
        logError("brain.pipeline-controller", err, { fn: "runBrainCycle.findPageVisits" });
        return [];
      }),
      prisma.auditEvent.count({
        where: { eventType: "conversation_summary", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }).catch((err) => {
        logError("brain.pipeline-controller", err, { fn: "runBrainCycle.countConversationSummaries" });
        return 0;
      }),
      (async () => {
        const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
        return (await getUnresolvedAlerts().catch((err) => {
          logError("brain.pipeline-controller", err, { fn: "runBrainCycle.getUnresolvedAlerts" });
          return [];
        })).length;
      })(),
      prisma.auditEvent.findFirst({
        where: { eventType: "business_metrics_sync" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      }).catch((err): null => {
        logError("brain.pipeline-controller", err, { fn: "runBrainCycle.findBusinessMetrics" });
        return null;
      }),
      prisma.bodyTracking.findFirst({ orderBy: { date: "desc" }, select: { weight: true, date: true } }),
      prisma.brainMemory.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, deletedAt: null }, // v10.0.66 · brain-cycle feeder
        orderBy: { confidence: "desc" },
        take: 10,
        select: { category: true, content: true },
      }),
    ]);

    // ── Cross-reference: Reflection cadence ──
    // Apr 17: DailyScore retired. Reflection logging is the new
    // awareness-loop signal; 2+ quiet days triggers the nudge.
    const todayStr = today();
    const reflectedToday = recentScores.some(s => s.date === todayStr);
    const daysSinceReflection = recentScores.length > 0
      ? Math.floor((Date.now() - new Date(recentScores[0].date).getTime()) / 86400000)
      : 99;

    if (!reflectedToday && daysSinceReflection >= 2) {
      alerts.push(`No reflection logged in ${daysSinceReflection} days — the self-tracking loop is open`);
    }

    // ── Cross-reference: Business telemetry (commented Apr 17 since
    //    workoutDone / mood flows moved into reflection.metadata) ──
    const business = (latestBusinessSync?.payload as any) || {};
    const shopRevenue =
      readNickRevenue(business?.revenue).todayDollars ||
      Number(business?.intelligence?.shopPulse?.today?.revenue ?? 0);

    // ── Cross-reference: Page visit patterns ──
    const visitedPages = new Set(pageVisits.map((v: any) => v.detail));
    const lateNightVisits = pageVisits.filter((v: any) => {
      const hour = (v.payload as any)?.hour;
      return hour != null && (hour >= 23 || hour <= 4);
    }).length;

    // /drift retired → drift + blind-spot signals now live on /brain. (Pre-fix
    // this checked the dead /drift route, which can never be "visited", so the
    // alert fired every day driftAlerts>0.)
    if (!visitedPages.has("/brain") && driftAlerts > 0) {
      alerts.push(`${driftAlerts} unacknowledged drift alerts but Nour hasn't opened the Brain page (drift + blind-spots) today`);
    }

    if (!visitedPages.has("/missions") && openTasks > 5) {
      alerts.push(`${openTasks} open tasks but Missions page not visited today — execution stalling`);
    }

    if (lateNightVisits > 3) {
      patterns.push(`${lateNightVisits} late-night page visits today — correlates with rumination and poor next-day performance`);
    }

    // ── Cross-reference: Commitment + queue scatter ──
    if (activeCommitments > 5 && openTasks > 5) {
      patterns.push(`${activeCommitments} active commitments + ${openTasks} open tasks = attention is scattered. Close 3 before adding more.`);
    }

    // shopRevenue kept alive for downstream correlation checks
    void shopRevenue;

    // ── Cross-reference: Body + score trend ──
    if (bodyData?.date) {
      const daysSinceWeigh = Math.floor((Date.now() - new Date(bodyData.date).getTime()) / 86400000);
      if (daysSinceWeigh > 5) {
        alerts.push(`Last weigh-in was ${daysSinceWeigh} days ago — body tracking gap is an avoidance signal`);
      }
    }

    // ── Cross-reference: Conversation volume ──
    if (recentConversations > 8) {
      patterns.push(`${recentConversations} conversations with Nick today — high volume may indicate analysis paralysis. Action > conversation.`);
    }

    // ── Store alerts as proactive brain events ──
    for (const alert of alerts) {
      await prisma.auditEvent.create({
        data: {
          actor: "brain_cycle",
          eventType: "proactive_alert",
          detail: alert.slice(0, 200),
          payload: { alert, source: "cross_reference", severity: "high" },
        },
      }).catch((err) => {
        recordError("brain:pipeline-controller", err, { phase: "audit-write", eventType: "proactive_alert" });
      });
    }

    for (const pattern of patterns) {
      await prisma.auditEvent.create({
        data: {
          actor: "brain_cycle",
          eventType: "brain_insight",
          detail: pattern.slice(0, 200),
          payload: { insight: pattern, source: "cross_reference" },
        },
      }).catch((err) => {
        recordError("brain:pipeline-controller", err, { phase: "audit-write", eventType: "brain_insight" });
      });
    }

    // ── Store brain cycle metadata ──
    await prisma.auditEvent.create({
      data: {
        actor: "brain_cycle",
        eventType: "brain_cycle_complete",
        detail: `Cycle: ${alerts.length} alerts, ${patterns.length} patterns, ${recentMemories.length} recent memories`,
        payload: {
          alertCount: alerts.length,
          patternCount: patterns.length,
          memoryCount: recentMemories.length,
          pagesVisitedToday: visitedPages.size,
          reflectedToday,
          daysSinceReflection,
          openTasks,
          activeCommitments,
          driftAlerts,
        },
      },
    }).catch((err) => {
      recordError("brain:pipeline-controller", err, { phase: "audit-write", eventType: "brain_cycle_complete" });
    });

    return { alerts, patterns, synced: true };
  } catch (err) {
    log.error("brain_cycle_error", { err: err instanceof Error ? err.message : String(err) });
    return { alerts, patterns, synced: false };
  }
}

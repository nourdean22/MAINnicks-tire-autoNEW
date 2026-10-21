/**
 * Business signal tools — business_read / business_write / live_shop.
 *
 * Includes: getShopSnapshot · findCustomer · getRevenueStats ·
 * compareLiveRevenue · getGscSummary · pricing
 * advisory · location feasibility · attribution.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { resolveTrustTier } from "@/lib/brain/memory-trust";

/**
 * 2026-10-10 (audit 07-SN-02) · nickstire bridge payloads carry text strangers
 * write on nickstire.org (lead messages, review bodies, callback notes), so
 * they reach the model inside an external_doc fence -- which also taints the
 * turn, so the sink gate holds any outward side effect for a human.
 *
 * Shape is preserved for the tool wrapper (lib/ai/tools.ts): an `error`
 * result passes through untouched (it is the bridge's own failure, and the
 * wrapper keys on the key), and an EMPTY `data: []` passes through so the
 * wrapper's honest no_data_found path still fires. 20k cap: the 4k default
 * would amputate a customer_search page the model needs to read.
 */
const BRIDGE_FENCE_MAX_CHARS = 20_000;
function fenceBridgeResult(toolName: string, res: unknown): unknown {
  if (!res || typeof res !== "object") return res;
  const r = res as Record<string, unknown>;
  if ("error" in r && r.error) return res;
  if ("data" in r) {
    if (Array.isArray(r.data) && r.data.length === 0) return res;
    return { ...r, data: fenceContent(toolName, "external_doc", JSON.stringify(r.data), { maxChars: BRIDGE_FENCE_MAX_CHARS }) };
  }
  return { data: fenceContent(toolName, "external_doc", JSON.stringify(r), { maxChars: BRIDGE_FENCE_MAX_CHARS }) };
}

export const businessTools = {
  getCameraIntelligence: tool({
    description: "Get camera intelligence — shop traffic, vehicle counts, alerts, bay utilization, employee arrivals",
    inputSchema: z.object({}),
    execute: async () => {
      const { getCameraIntelligence } = await import("@/lib/brain/camera-intelligence");
      return getCameraIntelligence();
    },
  }),

  // NOTE: logDecisionForReplay tool deleted Apr 15 — same rationale
  // as logDecision. The NL interceptor in /api/ai/chat writes to
  // masteryDecision + auto-schedules a review date based on stakes.

  // ── CONTENT CREATION (Apr 17: post generation moved to nickstire
  //    admin; autonicks keeps only image generation which is
  //    cross-domain useful for journal, mastery, personal notes) ──

  getReviewStats: tool({
    description: "Get Google Reviews statistics for Nick's Tire & Auto",
    inputSchema: z.object({}),
    execute: async () => {
      const { getReviewStats } = await import("@/lib/integrations/google-reviews");
      return getReviewStats();
    },
  }),

  getRevenueStats: tool({
    description: "Get revenue statistics for a given period",
    inputSchema: z.object({
      period: z.enum(["day", "week", "month", "year"]).default("month"),
    }),
    execute: async ({ period }) => {
      const { getRevenueStats } = await import("@/lib/services/business-intel");
      const stats = await getRevenueStats(period);
      // A dead shop bridge produced a SUCCESS-SHAPED payload of zeros:
      // totalRevenue "0.00", jobCount 0, avgTicket "0.00". The service marks it
      // with bridgeAvailable, but that flag had no consumer anywhere, and the
      // chat rule only permits "I don't have access" after a tool returns null,
      // errors, or is unavailable — a zeros payload is none of those three, so
      // the model was directed to report the fabricated zero as fact.
      //
      // Replaced wholesale rather than annotated: leaving the zeros in the
      // payload beside a flag is what failed the first time.
      if (!stats.bridgeAvailable) {
        const { revenueUnavailable } = await import("@/lib/ai/tools/bridge-honesty");
        return revenueUnavailable(period);
      }
      return stats;
    },
  }),

  // getTopServices: retired 2026-10-08. It read the bridge query `revenue_top_services`, which
  // nickstire never registered, so it had answered "unknown" on every call since v10.0.51; and
  // the data a top-services list needs has mostly stopped arriving (invoice service descriptions:
  // Jun 31/123, Jul 12/106, Aug 1/30 per apps/nickstire/docs/CURRENT-TRUTH.md). Rebuild it only
  // with a handler that reports how many tickets its ranking covers.

  getDashboardSummary: tool({
    description: "Get full business dashboard summary — revenue, customers, reviews, open jobs",
    inputSchema: z.object({}),
    execute: async () => {
      const { getDashboardSummary } = await import("@/lib/services/business-intel");
      const summary = await getDashboardSummary();
      // Each sub-read degrades independently, so this is PARTIAL rather than
      // all-or-nothing. The decision of what to blank is a pure function so it
      // can be pinned directly — driving it through getDashboardSummary means
      // mocking three concurrent bridge reads, which is exactly the machinery
      // this repo keeps getting wrong.
      const { redactUnreadableSections } = await import("@/lib/ai/tools/bridge-honesty");
      return redactUnreadableSections(summary);
    },
  }),

  // searchKnowledge retired Apr 18 — RAG module deleted (Ollama
  // dependency was removed earlier; nobody kept the vector search
  // path alive). Chat can still recall via the cross-source
  // VectorEmbedding table through brain engines in system-prompt.

  // createPaymentLink retired v7 cleanup · Apr 28 — Stripe payment
  // creation belongs on nickstire.org/admin with the customer DB.
  // generateInvoice retired Apr 18 — invoice-generator moved to
  // nickstire.org/admin with the rest of the shop ops.
  // triggerFollowUp retired v7 cleanup · Apr 28 — post-service SMS
  // path lives on nickstire (real Twilio + customer table).

  getShopSnapshot: tool({
    description: "Get real-time shop data from the nickstire bridge — bookings, leads, revenue, callbacks, sync health",
    inputSchema: z.object({}),
    execute: async () => {
      const { fetchShopSnapshot } = await import("@/lib/services/bridge");
      const data = await fetchShopSnapshot();
      if (!data) return { error: "Bridge not connected. Set NICKS_ADMIN_URL and BRIDGE_API_KEY." };
      return fenceBridgeResult("getShopSnapshot", data);
    },
  }),

  queryNickstire: tool({
    description: "Query live data from nickstire.org. Queries: revenue_today, revenue_range, leads_today, leads_pipeline, leads_urgent, bookings_today, bookings_status, customer_search, callbacks_pending, work_orders_active, attention_needed, shop_pulse, feature_flags, gsc_summary, gsc_top_queries. Money: customer_search.totalSpent is integer CENTS — quote totalSpentDollars. gsc_summary.source says whether totals are Google's official property total or a partial stored-row subset.",
    inputSchema: z.object({
      query: z.string().describe("Query name from the list above"),
      from: z.string().optional().describe("Start date YYYY-MM-DD (revenue_range, gsc_*)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (revenue_range, gsc_*)"),
      term: z.string().optional().describe("Search term (for customer_search)"),
    }),
    execute: async ({ query, from, to, term }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const filters: Record<string, string> = {};
      if (from) filters.from = from;
      if (to) filters.to = to;
      if (term) filters.term = term;
      return fenceBridgeResult("queryNickstire", await queryNick(query, filters));
    },
  }),

  // ─── SEO / Search Console ───
  // Wave-110 (2026-05-09): wired to nickstire bridge actions gsc_summary +
  // gsc_top_queries. Bridge reads from nickstire's search_performance table
  // (populated nightly by Google Service Account). Backfills the gap that
  // caused Nick to fabricate "1,700 imp / 17 clicks / 1% CTR" identical for
  // 30d AND 90d windows. Always prefer these specialized tools over
  // queryNickstire for SEO questions — clearer schema for the LLM.
  getGscSummary: tool({
    description: "Real Google Search Console totals for nickstire.org over a date range — clicks, impressions, CTR, average position. Use whenever Nour asks how SEO is performing, traffic, search visibility, or rankings overall. Defaults to last 30 days if no dates given. Numbers are derived from raw click+impression sums (not avg-of-avg) so multi-day totals are accurate. Position is impression-weighted.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date YYYY-MM-DD (default: 30 days ago)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (default: today)"),
    }),
    execute: async ({ from, to }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const filters: Record<string, string> = {};
      if (from) filters.from = from;
      if (to) filters.to = to;
      return queryNick("gsc_summary", filters);
    },
  }),

  getGscTopQueries: tool({
    description: "Top search queries driving organic traffic to nickstire.org from Google Search. Returns each query's clicks, impressions, CTR, and average position. Use whenever Nour asks 'what searches bring people in', 'top keywords', 'what people search for', or 'which queries convert'. Defaults to top 10 over the last 30 days.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date YYYY-MM-DD (default: 30 days ago)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (default: today)"),
      limit: z.number().int().min(1).max(50).optional().describe("How many top queries (default: 10, max: 50)"),
    }),
    execute: async ({ from, to, limit }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const filters: Record<string, string | number> = {};
      if (from) filters.from = from;
      if (to) filters.to = to;
      if (limit) filters.limit = limit;
      // Search queries are text strangers typed into Google.
      return fenceBridgeResult("getGscTopQueries", await queryNick("gsc_top_queries", filters));
    },
  }),

  // v10.0.500 · ADR-0011 Tier 3 · marketing attribution handler.
  // Closes Nour's most-asked vague category: "what's actually
  // working?" Source-by-source rollup of leads → conversions →
  // revenue. Joins leads.invoiceId → invoices via wave-125 FK.
  // The bridge handler at nickstire-dev returns ranked source rows
  // with leadCount / conversionRate / totalDollars / avgTicket ·
  // Nick now has real numbers to cite instead of approximating.
  getMarketingAttribution: tool({
    description: "Source-by-source attribution for Nick's Tire & Auto leads. Returns lead count + conversion count + conversion rate + revenue + avg ticket per source (popup / chat / booking / callback / sms / etc.) ranked by total dollars. Use whenever Nour asks 'what's working', 'which channel is converting', 'ROI per source', 'where are leads coming from', or 'what's our best marketing'. Defaults to last 30 days.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start date YYYY-MM-DD (default: 30 days ago)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (default: today)"),
    }),
    execute: async ({ from, to }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const filters: Record<string, string> = {};
      if (from) filters.from = from;
      if (to) filters.to = to;
      return queryNick("marketing_attribution", filters);
    },
  }),

  getAttentionAlerts: tool({
    description: "What needs Nour's attention NOW — stale leads, unanswered callbacks, overdue WOs",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      return fenceBridgeResult("getAttentionAlerts", await queryNick("attention_needed"));
    },
  }),

  // v10.0.79 · getLiveRevenue retired — strict subset of getRevenueStats({period:"day"}).
  // Both routed through queryNick("revenue_today") under the hood; the duplicate
  // tool was post-rename rot from before getRevenueStats was wired to the bridge.
  // Canonical: getRevenueStats({period:"day"})

  // v10.0.79 · getShopBriefing retired — dailyPulse now covers the same
  // 6 queries (revenue_today / attention_needed / leads_urgent /
  // callbacks_pending / work_orders_active / bookings_today) PLUS the
  // personal layer (todayScore + tasks + drift). Same intent, broader
  // canonical tool. Canonical: dailyPulse.

  compareLiveRevenue: tool({
    description: "Compare live revenue across two date ranges using nickstire data. Use for 'this week vs last week' or 'this month vs last month'",
    inputSchema: z.object({
      period1From: z.string().describe("First period start YYYY-MM-DD"),
      period1To: z.string().describe("First period end YYYY-MM-DD"),
      period2From: z.string().describe("Second period start YYYY-MM-DD"),
      period2To: z.string().describe("Second period end YYYY-MM-DD"),
    }),
    execute: async ({ period1From, period1To, period2From, period2To }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      // Two paired single queries — NOT queryNickBatch. The batch result is
      // keyed by query NAME, so two "revenue_range" entries collapsed into
      // one key and BOTH periods returned the same value (Nick always said
      // the two periods were identical). v-fix 2026-06-02.
      const [period1, period2] = await Promise.all([
        queryNick("revenue_range", { from: period1From, to: period1To }),
        queryNick("revenue_range", { from: period2From, to: period2To }),
      ]);
      return { period1, period2, note: "Compare totalDollars and invoiceCount between periods" };
    },
  }),

  findCustomer: tool({
    description: "MUST USE before asserting ANY fact about a specific customer · visit count · declined estimates · segment · lifetime spend · last visit · vehicle · phone · plate. Returns 360° lifetime timeline combining nickstire (jobs/invoices/quotes/vehicle), brain memories (notes/patterns), statenour (LTV/churn/relationship). If the user mentions someone by name OR phone digits OR plate — call this FIRST. Returns null if no match · in that case tell the user 'no customer matched <term>' instead of fabricating details. v10.0.503 · ADR-0011 surfacing fix.",
    inputSchema: z.object({
      nameOrPhone: z.string().describe("Customer name or phone number to search"),
    }),
    execute: async ({ nameOrPhone }) => {
      const { queryNick, readBridge } = await import("@/lib/nickstire/query");
      const { prisma } = await import("@/lib/prisma");

      // Search ALL systems in parallel
      // v10.0.54 · Wave A · Pre-fix the customerRecord + quotes lookups
      // were dead `Promise.resolve(null|[])` (those tables live on
      // nickstire). Now both are sourced from the customer_search
      // bridge response, which returns a `{customer, quotes}` shape
      // when a record matches. Bridge failure → null/[] (already
      // handled by the timeline-building code below).
      const [shopResult, brainMemories, personProfile] = await Promise.all([
        queryNick<{
          customer?: {
            fullName: string;
            phone: string | null;
            email: string | null;
            vehicle: string | null;
            lastVisitDate: string | null;
            totalSpend: number;
            visitCount: number;
            lastService: string | null;
            predictedNextService: string | null;
            ltvBand: string | null;
            riskStatus: string | null;
            reviewRequested: boolean;
            reviewCompleted: boolean;
          } | null;
          quotes?: Array<{
            id: string;
            quoteNumber: string;
            grandTotal: number;
            status: string;
            createdAt: string;
            vehicleMake: string;
            vehicleModel: string;
            vehicleYear: number;
          }>;
        }>("customer_search", { term: nameOrPhone }).catch(
          // A thrown read is a failed read, not "no match" (was `{ data: null }`).
          (err: unknown): { error: string } => ({ error: err instanceof Error ? err.message : String(err) }),
        ),
        prisma.brainMemory.findMany({
          where: { content: { contains: nameOrPhone, mode: "insensitive" }, deletedAt: null }, // v7.9
          orderBy: { confidence: "desc" },
          take: 8,
          select: { category: true, content: true, confidence: true, createdAt: true, source: true, trustTier: true },
        }).catch((): never[] => []),
        // Wave AM · 2026-05-28 · soft-delete safety
        prisma.personProfile.findFirst({
          where: {
            name: { contains: nameOrPhone, mode: "insensitive" },
            deletedAt: null,
          },
          select: { name: true, role: true, relationship: true, trustScore: true, interactionCount: true, lastInteraction: true },
        }).catch((): null => null),
      ]);

      // Hydrate customer + quotes from the bridge response.
      const customerRecord = ("data" in shopResult && shopResult.data?.customer) ? shopResult.data.customer : null;
      const quotes = ("data" in shopResult && Array.isArray(shopResult.data?.quotes))
        ? shopResult.data.quotes.map((q) => ({ ...q, createdAt: new Date(q.createdAt) }))
        : [];

      // A failed shop read (transport, unknown query, or a 200 carrying
      // `data.error`) is UNKNOWN: the model must not say "no customer matched".
      const shopRead = readBridge(shopResult);
      const shopUnknown = shopRead.status === "unknown" ? shopRead.reason : null;

      // Build the lifetime timeline
      const timeline: string[] = [];
      const customer = customerRecord;
      if (shopUnknown) {
        timeline.push(`Shop record: unknown — the nickstire read failed (${shopUnknown}). Do not say no customer matched.`);
      }

      // 2026-10-10 (audit 07-SN-02) · the record's name / vehicle / service text
      // is typed by the customer on nickstire.org, so the customer + quote lines
      // reach the model inside an external_doc fence, which also taints the turn.
      const shopLines: string[] = [];
      if (customer) {
        const totalSpend = Number(customer.totalSpend ?? 0);
        const visits = customer.visitCount ?? 0;
        const avgTicket = visits > 0 ? Math.round(totalSpend / visits) : 0;
        const daysSinceVisit = customer.lastVisitDate
          ? Math.round((Date.now() - new Date(customer.lastVisitDate).getTime()) / 86400000)
          : null;

        // LTV classification
        const ltvLabel = customer.ltvBand === "VIP" ? "VIP — top customer" :
          customer.ltvBand === "HIGH" ? "High-value regular" :
          customer.ltvBand === "MID" ? "Reliable regular" :
          customer.ltvBand === "LOW" ? "Occasional" : "New";

        // Churn risk
        const riskLabel = customer.riskStatus === "LOST" ? "⚠️ LOST — needs win-back outreach" :
          customer.riskStatus === "DORMANT" ? "⚠️ Dormant — hasn't been in a while" :
          customer.riskStatus === "AT_RISK" ? "⚠️ At risk — watch closely" :
          customer.riskStatus === "HEALTHY" ? "Healthy — active customer" : "Unknown";

        shopLines.push(`**${customer.fullName}** — ${ltvLabel}`);
        shopLines.push(`📱 ${customer.phone || "no phone"} | ${customer.email || "no email"}`);
        shopLines.push(`🚗 ${customer.vehicle || "vehicle unknown"}`);
        shopLines.push(`💰 $${totalSpend.toLocaleString()} lifetime (${visits} visits, $${avgTicket} avg ticket)`);
        if (daysSinceVisit !== null) shopLines.push(`📅 Last visit: ${daysSinceVisit}d ago (${customer.lastService || "unknown service"})`);
        if (customer.predictedNextService) shopLines.push(`🔮 Predicted next: ${customer.predictedNextService}`);
        shopLines.push(`📊 Status: ${riskLabel}`);
        if (customer.reviewCompleted) shopLines.push(`⭐ Left a review`);
        else if (customer.reviewRequested) shopLines.push(`📧 Review requested, not yet completed`);
      }

      // Quote history
      if (quotes.length > 0) {
        shopLines.push(`\n**Quote History (${quotes.length}):**`);
        for (const q of quotes.slice(0, 5)) {
          const age = Math.round((Date.now() - new Date(q.createdAt).getTime()) / 86400000);
          const statusEmoji = q.status === "booked" || q.status === "completed" ? "✅" : q.status === "declined" || q.status === "lost" ? "❌" : "⏳";
          shopLines.push(`${statusEmoji} ${q.quoteNumber} — $${q.grandTotal.toFixed(0)} for ${q.vehicleYear} ${q.vehicleMake} ${q.vehicleModel} (${age}d ago, ${q.status})`);
        }

        // Declined estimates = recovery opportunity
        const declined = quotes.filter(q => q.status === "declined" || q.status === "lost" || q.status === "pending");
        if (declined.length > 0) {
          const declinedTotal = declined.reduce((s, q) => s + q.grandTotal, 0);
          shopLines.push(`\n💸 **${declined.length} unconverted estimates worth $${declinedTotal.toFixed(0)}** — follow up!`);
        }
      }
      if (shopLines.length > 0) timeline.push(fenceContent("findCustomer", "external_doc", shopLines.join("\n")));

      // Brain memories
      if (brainMemories.length > 0) {
        timeline.push(`\n**Nick's Notes (${brainMemories.length}):**`);
        // S-1 completion (2026-09-02) · memory rows about a customer can carry
        // third-party text (synced notes, SMS) — fenced as memory_recall.
        // 2026-10-10 (07-SN-02) · and a third-party note taints the turn.
        const shown = brainMemories.slice(0, 4);
        const notes = shown.map((m) => `• [${m.category}] ${m.content.slice(0, 150)}`);
        timeline.push(fenceContent("customer360Notes", "memory_recall", notes.join("\n"), {
          taint: shown.some((m) => resolveTrustTier(m) === "EXTERNAL_CONTENT"),
        }));
      }

      // Person profile
      if (personProfile) {
        timeline.push(`\n**Relationship:** ${personProfile.relationship || "customer"} | Trust: ${personProfile.trustScore ?? "?"}/10 | Interactions: ${personProfile.interactionCount ?? 0}`);
      }

      return {
        timeline: timeline.join("\n"),
        shopData: fenceBridgeResult("findCustomer", shopResult),
        customer: customerRecord ? {
          name: customerRecord.fullName,
          phone: customerRecord.phone,
          totalSpend: Number(customerRecord.totalSpend ?? 0),
          visits: customerRecord.visitCount ?? 0,
          riskStatus: customerRecord.riskStatus,
          ltvBand: customerRecord.ltvBand,
        } : shopUnknown ? ("unknown" as const) : null,
        quotesCount: quotes.length,
        memoriesCount: brainMemories.length,
        instruction: "Present the timeline as a STORY. Don't just list fields — narrate the customer's journey with the shop. Highlight: unconverted estimates (money on the table), churn risk (action needed), and relationship depth.",
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // CODE SANDBOX — AI can run scripts and analyze data
  // ═══════════════════════════════════════════════════════════

  getEstimateLeaks: tool({
    description: "Find revenue leaks — estimates that never became invoices (customers who got a quote but didn't convert). This is money walking out the door.",
    inputSchema: z.object({
      daysBack: z.number().min(1).max(90).default(7).describe("How many days back to check"),
    }),
    execute: async ({ daysBack }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const pulse = await queryNick("shop_pulse");
      const attention = await queryNick("attention_needed");
      return {
        pulse: fenceBridgeResult("getEstimateLeaks", pulse),
        attention: fenceBridgeResult("getEstimateLeaks", attention),
        analysis: `An estimate that never became an invoice means the customer walked; those are the leaks to follow up. Invoice payment status is not a signal: payment is collected on a separate register.`,
        daysBack,
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // FILE ACCESS — Read files from Google Drive, local storage
  // ═══════════════════════════════════════════════════════════

  /**
   * Mark a commitment broken with a reason. Different from
   * completeCommitment (which just updates status) because it
   * records the breakage cause in notes — critical for the
   * decision-pattern learning loop.
   */
  /**
   * Classify a thought into one of 8 types without storing it.
   * Useful when Nour is thinking out loud and wants to know what
   * mode he's in. Returns the type + short explanation.
   */

  // v10.0.526 · Arc C · Feature 7 · second-location feasibility scorer.
  // Pure-function · evaluates an address across 5 weighted dimensions
  // (foot traffic · review density · competitor cluster · drive time
  // to Euclid · zoning friction) and returns a 0-100 score, tier
  // (A/B/C/D/F), strongest + weakest dimensions, and operator-facing
  // reasoning. Missing dimensions get neutral 0.5 scores and a
  // warning · the operator sees what data they still need to collect.
  // NO external API fetches · NO database writes (the chat surface
  // exposes the algorithm only · persistence is the cron's job).
  scoreLocation: tool({
    description:
      "Evaluate a candidate address for a second shop. Returns a 0-100 score, tier (A=ship · F=don't), strongest + weakest dimension, and operator-facing reasoning. Five dimensions: footTrafficPercentile (0-100) · reviewDensity (reviews per nearby competitor) · competitorCluster (count within 2mi · lower=better) · driveTimeToHomeMinutes (to Euclid HQ · lower=better) · zoningFriction (0-100 · lower=better). Missing dimensions are scored neutrally (0.5) with an explicit warning. Use this when the operator says 'score this location', 'evaluate Cleveland address', 'second location', 'expansion address', or asks whether a specific spot is viable. Pure compute · no external data fetched · operator supplies the measured params.",
    inputSchema: z.object({
      address: z.string().describe("Candidate address · street + city is enough"),
      footTrafficPercentile: z.number().min(0).max(100).optional().describe("Foot-traffic percentile 0-100 · higher is better"),
      reviewDensity: z.number().min(0).optional().describe("Reviews per nearby competitor · higher is better · saturates ~20"),
      competitorCluster: z.number().min(0).optional().describe("Count of auto-repair shops within 2 miles · LOWER is better"),
      driveTimeToHomeMinutes: z.number().min(0).optional().describe("Drive time in minutes from Euclid HQ · LOWER is better · capped at 60"),
      zoningFriction: z.number().min(0).max(100).optional().describe("Estimated municipal hassle 0-100 · LOWER is better"),
    }),
    execute: async (params) => {
      const { scoreLocation: score } = await import("@/lib/services/location-feasibility");
      const result = score(params);
      return {
        ok: true,
        address: result.address,
        score: result.normalizedScore,
        tier: result.tier,
        strongest: result.strongestDimension,
        weakest: result.weakestDimension,
        reasoning: result.reasoning.join(" "),
        warnings: result.warnings,
        dimensions: result.dimensions,
      };
    },
  }),
};

/**
 * Business signal tools — business_read / business_write / live_shop.
 *
 * Includes: getShopSnapshot · findCustomer · getRevenueStats ·
 * compareLiveRevenue · createQuickQuote · getGscSummary · pricing
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

  createQuickQuote: tool({
    description: "Quote creation belongs on nickstire admin (laborOperations, tires, and quotes tables all live there). Returns a clear redirect message; the quoteCalc surface on nickstire.org/admin is the canonical path.",
    inputSchema: z.object({
      customerName: z.string().optional(),
      customerPhone: z.string().optional(),
      vehicleYear: z.number(),
      vehicleMake: z.string(),
      vehicleModel: z.string(),
      services: z.array(z.string()).describe("Labor operation names to include"),
      tireSize: z.string().optional().describe("Tire size like 225/65R17"),
      tireQty: z.number().default(4),
    }),
    execute: async ({ vehicleYear, vehicleMake, vehicleModel, services, tireSize, tireQty }) => {
      // v10.0.54 · Wave A · Pre-fix this tool was 5 dead Promise.resolve
      // placeholders (laborOps, tires, countToday, quote) and crashed
      // on `quote.quoteNumber` access (TypeError: null.quoteNumber).
      // The labor_operations, tires, and quotes tables all moved to
      // nickstire (TiDB on Railway). No bridge mutation exposed yet,
      // so creating a quote from autonicks would be silent data loss
      // even if the reads worked. Returning a structured redirect
      // is the honest path — Nick relays it, Nour clicks through.
      const summary = `${vehicleYear} ${vehicleMake} ${vehicleModel}` +
        (services.length > 0 ? ` · ${services.join(", ")}` : "") +
        (tireSize ? ` · tires ${tireSize} x${tireQty}` : "");
      return {
        created: false,
        redirect: true,
        message:
          "Quote creation lives on nickstire admin (labor + tire pricing tables + quote sequence are all there). Open nickstire.org/admin/quotes/new and pre-fill these details.",
        prefill: { vehicleYear, vehicleMake, vehicleModel, services, tireSize, tireQty },
        summary,
        adminUrl: "https://nickstire.org/admin/quotes/new",
      };
    },
  }),

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

  getTopServices: tool({
    description: "Get top services by revenue at Nick's Tire & Auto",
    inputSchema: z.object({ limit: z.number().default(10) }),
    execute: async ({ limit }) => {
      const { getTopServices } = await import("@/lib/services/business-intel");
      const services = await getTopServices(limit);
      // null = the shop bridge could not answer. Never hand the model [] for
      // that: an empty list reads as "no services", which is not what we know.
      if (services === null) {
        const { topServicesUnavailable } = await import("@/lib/ai/tools/bridge-honesty");
        return topServicesUnavailable();
      }
      return services;
    },
  }),

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

  compareCompetitors: tool({
    description: "Compare Nick's Tire & Auto against local competitors on reviews and ratings",
    inputSchema: z.object({}),
    execute: async () => {
      const { compareWithNicks } = await import("@/lib/scrapers/competitor-scraper");
      return compareWithNicks();
    },
  }),

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
      return data;
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
      return queryNick(query, filters);
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
      return queryNick("gsc_top_queries", filters);
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
    description: "What needs Nour's attention NOW — stale leads, unanswered callbacks, overdue WOs, unpaid invoices",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      return queryNick("attention_needed");
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
      const { queryNick } = await import("@/lib/nickstire/query");
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
          (): { data: null } => ({ data: null }),
        ),
        prisma.brainMemory.findMany({
          where: { content: { contains: nameOrPhone, mode: "insensitive" }, deletedAt: null }, // v7.9
          orderBy: { confidence: "desc" },
          take: 8,
          select: { category: true, content: true, confidence: true, createdAt: true },
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

      // Build the lifetime timeline
      const timeline: string[] = [];
      const customer = customerRecord;

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

        timeline.push(`**${customer.fullName}** — ${ltvLabel}`);
        timeline.push(`📱 ${customer.phone || "no phone"} | ${customer.email || "no email"}`);
        timeline.push(`🚗 ${customer.vehicle || "vehicle unknown"}`);
        timeline.push(`💰 $${totalSpend.toLocaleString()} lifetime (${visits} visits, $${avgTicket} avg ticket)`);
        if (daysSinceVisit !== null) timeline.push(`📅 Last visit: ${daysSinceVisit}d ago (${customer.lastService || "unknown service"})`);
        if (customer.predictedNextService) timeline.push(`🔮 Predicted next: ${customer.predictedNextService}`);
        timeline.push(`📊 Status: ${riskLabel}`);
        if (customer.reviewCompleted) timeline.push(`⭐ Left a review`);
        else if (customer.reviewRequested) timeline.push(`📧 Review requested, not yet completed`);
      }

      // Quote history
      if (quotes.length > 0) {
        timeline.push(`\n**Quote History (${quotes.length}):**`);
        for (const q of quotes.slice(0, 5)) {
          const age = Math.round((Date.now() - new Date(q.createdAt).getTime()) / 86400000);
          const statusEmoji = q.status === "booked" || q.status === "completed" ? "✅" : q.status === "declined" || q.status === "lost" ? "❌" : "⏳";
          timeline.push(`${statusEmoji} ${q.quoteNumber} — $${q.grandTotal.toFixed(0)} for ${q.vehicleYear} ${q.vehicleMake} ${q.vehicleModel} (${age}d ago, ${q.status})`);
        }

        // Declined estimates = recovery opportunity
        const declined = quotes.filter(q => q.status === "declined" || q.status === "lost" || q.status === "pending");
        if (declined.length > 0) {
          const declinedTotal = declined.reduce((s, q) => s + q.grandTotal, 0);
          timeline.push(`\n💸 **${declined.length} unconverted estimates worth $${declinedTotal.toFixed(0)}** — follow up!`);
        }
      }

      // Brain memories
      if (brainMemories.length > 0) {
        timeline.push(`\n**Nick's Notes (${brainMemories.length}):**`);
        // S-1 completion (2026-09-02) · memory rows about a customer can carry
        // third-party text (synced notes, SMS) — fenced as memory_recall.
        const notes = brainMemories.slice(0, 4).map((m) => `• [${m.category}] ${m.content.slice(0, 150)}`);
        timeline.push(fenceContent("customer360Notes", "memory_recall", notes.join("\n")));
      }

      // Person profile
      if (personProfile) {
        timeline.push(`\n**Relationship:** ${personProfile.relationship || "customer"} | Trust: ${personProfile.trustScore ?? "?"}/10 | Interactions: ${personProfile.interactionCount ?? 0}`);
      }

      return {
        timeline: timeline.join("\n"),
        shopData: shopResult,
        customer: customerRecord ? {
          name: customerRecord.fullName,
          phone: customerRecord.phone,
          totalSpend: Number(customerRecord.totalSpend ?? 0),
          visits: customerRecord.visitCount ?? 0,
          riskStatus: customerRecord.riskStatus,
          ltvBand: customerRecord.ltvBand,
        } : null,
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
        pulse,
        attention,
        analysis: `Check invoices with paymentStatus='pending' older than 3 days. Each one is a potential lost sale. Follow up aggressively.`,
        daysBack,
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // FILE ACCESS — Read files from Google Drive, local storage
  // ═══════════════════════════════════════════════════════════

  triageStaleLead: tool({
    description: "Triage a stale lead requires nickstire admin access (the lead table lives there). Returns a structured redirect — Nick relays the message and the admin URL.",
    inputSchema: z.object({
      leadId: z.string().describe("The lead id from the nickstire admin"),
      outcome: z.enum(["dead", "recovered", "followup", "booked"]).describe("What's the triage decision"),
      reason: z.string().min(1).max(500).describe("Why this outcome (for the learning loop)"),
    }),
    execute: async ({ leadId, outcome, reason }) => {
      // v10.0.54 · Wave A · Pre-fix this tool was a dead `Promise.resolve(null)`
      // then accessed `.id` / `.fullName` → TypeError every call. The
      // lead table lives on nickstire (TiDB on Railway). No bridge
      // mutation exposed yet, so we surface a structured redirect
      // honest-failure instead of silent crash. Nour clicks through
      // to the admin page and triages there; the reason gets logged
      // to BrainMemory locally so the learning loop still captures
      // the *intent* even when the persistence happens elsewhere.
      const statusMap: Record<string, string> = {
        dead: "LOST",
        recovered: "CONTACTED",
        followup: "CONTACTED",
        booked: "BOOKED",
      };
      const targetStatus = statusMap[outcome] ?? "CONTACTED";

      // Local memory: capture the triage intent so the decision-pattern
      // learning loop sees it even though the actual lead state lives
      // on nickstire.
      await prisma.brainMemory
        .upsert({
          where: {
            category_key: {
              category: "lead_triage_intent",
              key: `${leadId}_${new Date().toISOString().slice(0, 10)}`,
            },
          },
          create: {
            category: "lead_triage_intent",
            key: `${leadId}_${new Date().toISOString().slice(0, 10)}`,
            content: `Lead ${leadId} triaged as ${outcome} (${targetStatus}). Reason: ${reason}`,
            confidence: 0.7,
            source: "nick:triageStaleLead",
          },
          update: {
            content: `Lead ${leadId} triaged as ${outcome} (${targetStatus}). Reason: ${reason}`,
          },
        })
        .catch(() => undefined);

      return {
        leadId,
        intent: outcome,
        targetStatus,
        message:
          `Triage intent logged locally. To persist the lead status, open nickstire admin and apply ${targetStatus} on lead ${leadId}.`,
        adminUrl: `https://nickstire.org/admin/leads/${encodeURIComponent(leadId)}`,
      };
    },
  }),

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
  pricingAdvisorySummary: tool({
    description:
      "Read the most recent weekly pricing-strategy advisory: which service categories have low ALG win rates, competitor pricing signal, and the 3 drafted price experiments per outlier. Cite the operator's wisdoms (Munger inversion, Buffett pricing power). Operator-approval only — this tool NEVER changes shop pricing. Use when asked 'what's the pricing advisory', 'where are we losing on price', 'pricing experiments to run', 'win rate by service'.",
    inputSchema: z.object({}),
    execute: async () => {
      const latest = await prisma.brainMemory
        .findFirst({
          where: {
            category: "pricing_advisory",
            key: { startsWith: "weekly_" },
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: {
            key: true,
            content: true,
            confidence: true,
            createdAt: true,
            metadata: true,
          },
        })
        .catch(() => null);

      if (!latest) {
        return {
          ok: true,
          hasAdvisory: false,
          message:
            "No pricing advisory has been generated yet. No cron currently produces advisories — composeAdvisory() has no scheduled caller (wiring planned: ANTIGRAVITY_MASTER_PLAN AG-19).",
        };
      }

      const meta = latest.metadata as
        | {
            snapshot?: {
              outliers?: Array<{
                service: string;
                winRate: number;
                given: number;
                converted: number;
                fleetMedian: number;
                gap: number;
              }>;
              experimentsByCategory?: Record<
                string,
                Array<{
                  hypothesis: string;
                  variant: string;
                  controlGroup: string;
                  successMetric: string;
                  wisdomCited: string;
                }>
              >;
              fleetMedianWinRate?: number;
              headline?: string;
              winRates?: Array<{ service: string; winRate: number; given: number }>;
            };
          }
        | null;
      const snap = meta?.snapshot ?? null;

      return {
        ok: true,
        hasAdvisory: true,
        date: latest.key.replace(/^weekly_/, ""),
        generatedAt: latest.createdAt.toISOString(),
        // the advisory headline is LLM-generated stored text → curated_memory (2026-09-02, #2065 review)
        headline: fenceContent("pricingAdvisorySummary", "curated_memory", latest.content),
        confidence: latest.confidence,
        fleetMedianWinRate: snap?.fleetMedianWinRate ?? null,
        outliers: snap?.outliers ?? [],
        experimentsByCategory: snap?.experimentsByCategory ?? {},
        categoriesScanned: snap?.winRates?.length ?? 0,
      };
    },
  }),

  // v10.0.526 · Arc C · F1 · Revenue-Decision Channel.
  // Surfaces pending revenue moves drafted by the daily cron so Nick
  // can answer "what are the open business decisions" without the
  // operator opening a separate dashboard. Reads BrainMemory(category=
  // "revenue_move") · same source as /api/system/revenue-decisions.
  getPendingRevenueMoves: tool({
    description:
      "List revenue-moves drafted by the Revenue-Decision Channel that are still pending operator approval. Use when the operator asks 'what business moves are open', 'what's waiting on me', or wants to review today's drafted decisions before approving on Telegram.",
    inputSchema: z.object({
      daysBack: z
        .number()
        .min(1)
        .max(30)
        .default(7)
        .describe("Lookback window in days. Default 7."),
      includeDecided: z
        .boolean()
        .default(false)
        .describe(
          "If true, also include approved/rejected moves in the window. Default false (pending only).",
        ),
    }),
    execute: async ({ daysBack, includeDecided }) => {
      const { listMovesSince } = await import(
        "@/lib/services/revenue-decision-channel"
      );
      const rows = await listMovesSince(daysBack);
      const moves = rows.filter(
        (m) => includeDecided || m.status === "pending",
      );
      return {
        count: moves.length,
        windowDays: daysBack,
        moves: moves.map((m) => ({
          date: m.date,
          moveIndex: m.moveIndex,
          status: m.status,
          what: m.move.what,
          why: m.move.why,
          expectedImpact: m.move.expectedImpact,
          oneWayDoor: m.move.oneWayDoor,
          wisdomCited: m.move.wisdomCited,
          createdAt: m.createdAt,
          decidedAt: m.decidedAt,
        })),
      };
    },
  }),

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

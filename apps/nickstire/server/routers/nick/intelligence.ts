/**
 * Nick AI Agent — Intelligence gathering, operator command, context loading.
 * Handles: operatorCommand, pullFromStatenour, runMigrations, importCustomerCSV, syncShopDriver
 */
import { eq, gte, and, sql } from "drizzle-orm";
import { chatSessions, leads, bookings, invoices, customers, callbackRequests, reviewRequests } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import type { Invoice } from "../../../drizzle/schema";
import { log, db } from "./utils";

import { BUSINESS } from "@shared/business";
import { countActionableLeads } from "@shared/leadSource";
// ─── OPERATOR COMMAND (Admin-only Nick AI interface) ──────

export async function handleOperatorCommand(input: {
  command: string;
  context?: Record<string, string>;
}) {
  const d = await db();

  // Gather live business context for Nick AI
  let bizContext = "";
  if (d) {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        leadsToday, bookingsToday, callbacksPending, recentChats,
        weekBookings, monthInvoicesPaid, totalCustomers,
        newCustomersMonth, pendingCallbacks, staleLeads,
        monthReviews, weekLeads,
      ] = await Promise.all([
        d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, todayStart)),
        d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads).where(eq(leads.status, "new")),
        d.select({ count: sql<number>`count(*)` }).from(chatSessions).where(gte(chatSessions.createdAt, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
        d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
        d.select({ count: sql<number>`count(*)` }).from(customers),
        d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo)),
        d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
        d.select({ source: leads.source, callbackId: leads.callbackId }).from(leads).where(and(eq(leads.status, "new"), gte(leads.createdAt, weekAgo))),
        d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, weekAgo)),
      ]);

      const monthRevenueCents = monthInvoicesPaid.reduce((s: number, inv: Invoice) => s + inv.totalAmount, 0);
      const monthRevenue = Math.round(monthRevenueCents / 100);
      const avgTicket = monthInvoicesPaid.length > 0 ? Math.round(monthRevenue / monthInvoicesPaid.length) : 0;

      bizContext = `\nLIVE BUSINESS STATE (Nick's Tire & Auto):
- Time: ${now.toLocaleString("en-US", { timeZone: BUSINESS.timezone })}
- Model: First come first serve, drop-offs encouraged (holds place in line)
TODAY:
- Leads: ${leadsToday[0]?.count ?? 0} | Drop-offs: ${bookingsToday[0]?.count ?? 0}
- Chat sessions: ${recentChats[0]?.count ?? 0}
THIS WEEK:
- Drop-offs: ${weekBookings[0]?.count ?? 0} | Leads: ${weekLeads[0]?.count ?? 0}
PIPELINE:
- Pending leads (new): ${countActionableLeads(callbacksPending)}
- Stale leads (new, 7d): ${countActionableLeads(staleLeads)}
- Pending callbacks: ${pendingCallbacks[0]?.count ?? 0}
FINANCIAL (30d):
- Revenue: $${monthRevenue.toLocaleString()} from ${monthInvoicesPaid.length} paid invoices
- Avg ticket: $${avgTicket}
CUSTOMERS:
- Total: ${totalCustomers[0]?.count ?? 0} | New this month: ${newCustomersMonth[0]?.count ?? 0}
REVIEWS: ${monthReviews[0]?.count ?? 0} requests sent this month
SOURCES: Auto Labor Guide (ShopDriver Elite), Gateway for invoices`;

      // Inject Nick's learned memories
      try {
        const { getMemoryContext, getWarmupContext, smartRecall, getMemoryHealth } = await import("../../services/nickMemory");
        const relevantMemories = await smartRecall(input.command, 5);
        const relevantBlock = relevantMemories.length > 0
          ? `\nRELEVANT MEMORIES (matched to your question):\n${relevantMemories.map(m => `- [${m.type}|${Math.round(m.confidence * 100)}%] ${m.content}`).join("\n")}`
          : "";
        const memContext = (await getWarmupContext() || await getMemoryContext()) + relevantBlock;
        try {
          const health = await getMemoryHealth();
          if (health.total > 0) {
            bizContext += `\nMEMORY HEALTH: ${health.total} total memories, avg confidence ${health.avgConfidence}, top topics: ${health.topTopics.join(", ")}`;
          }
        } catch (e) { log.warn("[nickActions:operator] memory health check failed:", e); }

        // Inject Nour's deep personal context
        try {
          const { getNourPersonalContext } = await import("../../services/nourContext");
          const personalContext = getNourPersonalContext();
          if (personalContext) bizContext += personalContext;
        } catch (e) { log.warn("[nickActions:operator] personal context load failed:", e); }
        if (memContext) bizContext += memContext;
      } catch (e) { log.warn("[nickActions:operator] memory context load failed:", e); }

      // Inject customer intelligence + action plan
      let customerBrief = "";
      try {
        const { getCustomerBrief, getCustomerActionPlan } = await import("../../services/customerIntelligence");
        const [brief, plan] = await Promise.all([getCustomerBrief(), getCustomerActionPlan()]);
        customerBrief = brief + plan;
      } catch (e) { log.warn("[nickActions:operator] customer intelligence load failed:", e); }

      // Inject intelligence data
      try {
        const { analyzeConversionPipeline, projectRevenue, generateProactiveAlerts, getShopPulse } = await import("../../services/nickIntelligence");
        const [pipeline, revenue, alerts, shopPulse] = await Promise.all([
          analyzeConversionPipeline(),
          projectRevenue(),
          generateProactiveAlerts(),
          getShopPulse(),
        ]);
        bizContext += `
INTELLIGENCE:
- Estimate→Job conversion: ${pipeline.estimateToInvoice}%
- Lead→Booking conversion: ${pipeline.leadToBooking}%
- Drop-off→Completed: ${pipeline.bookingToInvoice}%
- Stale leads: ${pipeline.staleLeads} | Stale estimates: ${pipeline.staleEstimates}
- Week projection: $${revenue.thisWeekProjection} | Month projection: $${revenue.thisMonthProjection}
- Week-over-week: ${revenue.weekOverWeek > 0 ? "+" : ""}${revenue.weekOverWeek}% (${revenue.trend})
- Avg daily revenue: $${revenue.avgDailyRevenue}

SHOP PULSE (right now):
- Status: ${shopPulse.shopStatus.toUpperCase()}
- Today: ${shopPulse.today.jobsClosed} jobs closed, $${shopPulse.today.revenue.toLocaleString()} revenue, $${shopPulse.today.avgTicket} avg ticket
- Walked customers (estimates only): ${shopPulse.today.customersWalked}
- Drop-offs today: ${shopPulse.today.dropOffs} | Pending payments: ${shopPulse.today.pendingPayments} | Callbacks: ${shopPulse.today.callbacksWaiting}
- This week: ${shopPulse.thisWeek.jobsClosed} jobs, $${shopPulse.thisWeek.revenue.toLocaleString()}, walk rate: ${shopPulse.thisWeek.walkRate}%
- ${shopPulse.shopInsight}

BUSINESS: Invoice=WIN, Estimate without invoice=WALKED. Walk rate=${shopPulse.thisWeek.walkRate}%. CRM=Auto Labor Guide.
${customerBrief}
${pipeline.insights.length > 0 ? "\u26a0 " + pipeline.insights.join(" | ") : ""}
${alerts.length > 0 ? "\ud83d\udd34 " + alerts.join(" | ") : ""}`;
      } catch (e) { log.warn("[nickActions:operator] intelligence data load failed:", e); }

      // Inject declined work
      try {
        const { getDeclinedWorkLedger } = await import("../../services/declinedWorkRecovery");
        const declined = await getDeclinedWorkLedger(10);
        const unrecovered = declined.filter(e => e.declinedItems.some(i => !i.recovered));
        const totalRecoverable = unrecovered.reduce((s, e) => s + e.totalDeclinedValue, 0);
        const safetyCount = unrecovered.filter(e => e.hasSafetyItems).length;
        if (unrecovered.length > 0) {
          bizContext += `\nDECLINED WORK: $${totalRecoverable} recoverable from ${unrecovered.length} customers. ${safetyCount} have SAFETY items. Top: ${unrecovered.slice(0, 3).map(e => `${e.customerName || "?"} ($${e.totalDeclinedValue})`).join(", ")}`;
        }
      } catch (e) { log.warn("[nickActions:operator] declined work data load failed:", e); }

      // Inject staff performance
      try {
        const { getTeamPerformance } = await import("../../services/staffPerformance");
        const team = await getTeamPerformance();
        if (team.techs && team.techs.length > 0) {
          bizContext += `\nTEAM: ${team.techs.length} techs. Jobs: ${team.teamTotals?.totalJobs ?? 0}. QC pass rate: ${team.teamTotals?.avgQcPassRate ?? "N/A"}%. Comeback rate: ${team.teamTotals?.avgComebackRate ?? "N/A"}%.`;
        }
      } catch (e) { log.warn("[nickActions:operator] staff performance load failed:", e); }

      // Inject feedback loop anomalies
      try {
        const { detectAnomalies } = await import("../../services/feedbackLoop");
        const anomalies = detectAnomalies();
        if (anomalies.length > 0) {
          bizContext += `\nANOMALIES: ${anomalies.map(a => `${a.type}: ${a.current} (avg ${a.average}/hr) ${a.deviation}`).join(" | ")}`;
        }
      } catch (e) { log.warn("[nickActions:operator] anomaly detection load failed:", e); }

      // Inject what Nour asks about most
      try {
        const { getTopQuestions, getProactiveMemoryAlerts } = await import("../../services/nickMemory");
        const topQs = getTopQuestions(3);
        if (topQs.length > 0) {
          bizContext += `\nNOUR FREQUENTLY ASKS ABOUT: ${topQs.map(q => `"${q.topic}" (${q.count}x)`).join(", ")}. Proactively include this info in responses.`;
        }
        const memAlerts = await getProactiveMemoryAlerts();
        if (memAlerts.length > 0) {
          bizContext += `\nPROACTIVE MEMORY ALERTS: ${memAlerts.slice(0, 3).join(" | ")}`;
        }
      } catch (e) { log.warn("[nickActions:operator] proactive memory alerts load failed:", e); }

    } catch (err) {
      log.warn("Failed to gather biz context for operator command", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Nick AI — Nour's operator brain. You run across two domains:

1. NICK'S TIRE & AUTO (Cleveland/Euclid) — the business
2. NOUR OS — Nour's personal operating system for life + business

You are not just a business tool. You are Nour's strategic partner, chief of staff, and execution engine. You help him build the life and business simultaneously.

${"═".repeat(3)} BUSINESS CONTEXT ${"═".repeat(3)}
SHOP MODEL: First come first serve. Drop-offs encouraged — holds place in line. No appointments.
KEY METRIC: Invoice = job won. Estimate without invoice = lost sale.
SOURCES: Auto Labor Guide (ShopDriver Elite), Gateway for invoices/payments.
LABOR: 60+ jobs across 8 categories. Quick in-and-out jobs. Speed matters.

${"═".repeat(3)} CAPABILITIES ${"═".repeat(3)}
BUSINESS:
- Real-time pulse: leads, drop-offs, revenue, customer data, callbacks
- Shop operations: work orders, bay dispatch, labor estimates
- Marketing: SMS campaigns, review requests, win-back, social media posting
- Financial: revenue, avg ticket, conversion rates, invoice pipeline
- Competitive: pricing, positioning, local market (Cleveland area)

PERSONAL:
- Execution tracking: daily score, streaks, non-negotiable habits
- Task management: operator task queue with priorities
- Decision log: record decisions with reasoning for future reference
- Commitments: track promises with deadlines and accountability
- Loops: recurring habits with streak tracking
- Projects: track both life and business projects with milestones
- Learning: identify patterns, suggest improvements, remember what works

STRATEGIC:
- Pattern recognition: spot trends in revenue, leads, customer behavior
- Forecasting: project revenue, identify seasonal patterns
- Bottleneck detection: find where money/time is being lost
- Growth planning: what to invest in next, what to cut
- Life design: help Nour build systems for health, wealth, relationships

${"═".repeat(3)} THINKING MODEL ${"═".repeat(3)}
Before EVERY response, run this internal process:
1. UNDERSTAND — What is Nour actually asking? What's the REAL need behind the words? What problem is he actually trying to solve?
2. REMEMBER — Check your LEARNED KNOWLEDGE below. Have you seen this pattern before? What worked last time? What context from past interactions applies here?
3. CONTEXT — Cross-reference: live data + learned memories + customer intelligence + shop pulse. Connect dots across data sources. If revenue is down AND you remember that Tuesdays are slow, say so.
4. ANALYZE — What are the options? What are the trade-offs? What's the second-order effect? What would happen if we do nothing? What's the cost of delay?
5. REASON — Think through cause and effect. WHY is this happening? Not just what, but WHY. Every recommendation needs a BECAUSE. "Do X because Y, which leads to Z."
6. DECIDE — What's the highest-leverage move? What would a world-class operator recommend? Be specific — name the customer, the dollar amount, the action.
7. VERIFY — Are my facts correct? Am I referencing real data or guessing? Check the numbers against live data above. If a number doesn't match, flag it.
8. DELIVER — Lead with the answer. Be specific. Make it actionable. End with NEXT MOVE that Nour can execute in the next 5 minutes.

${"═".repeat(3)} MEMORY USAGE RULES ${"═".repeat(3)}
- If you have memories about a customer being discussed, REFERENCE them by name
- If you remember a pattern (e.g., "Saturdays are busy for tires"), USE it in your reasoning
- If you learned a lesson (e.g., "2-hour follow-up converts 3x better"), APPLY it to recommendations
- If a preference was stored (e.g., "Nour wants estimates in Auto Labor Guide"), FOLLOW it without asking
- Connect new information to existing memories: "This matches the pattern I noticed where..."
- When you learn something new, acknowledge it: "I'll remember that for next time."

${"═".repeat(3)} PERSONALITY ${"═".repeat(3)}
- You are direct. Zero fluff. Lead with signal.
- You challenge weak thinking. If Nour's logic is sloppy, say so.
- You anticipate beyond the request. Surface hidden risks and smarter paths.
- Every answer produces: what to do now, what to do next, what to avoid.
- You remember patterns and get smarter over time. You HAVE persistent memory — use it.
- You think in systems, not events. Build recurring advantages.
- You connect dots across data sources — if revenue is down AND leads are up, that's a conversion problem.
- You proactively volunteer information Nour didn't ask for but needs to know.
- You are a THOUGHT CATCHER: When Nour brain-dumps, vents, or thinks out loud — CAPTURE everything, ORGANIZE it (decisions/tasks/ideas/concerns), ACT on anything actionable (create follow-ups, store memories), REFLECT the core truth back, DETECT drift if thoughts scatter across new ideas with nothing finished. End with: "Captured: X tasks, Y insights. First move?"
- When you spot something urgent in the data, lead with it before answering the question.
- Truth > comfort. Execution > discussion. Leverage > effort.

${"═".repeat(3)} INTELLIGENCE LEVEL ${"═".repeat(3)}
You are not a chatbot. You are Nour's right hand. Think like:
- A CFO when discussing money (margins, unit economics, ROI, cash flow timing)
- A COO when discussing operations (throughput, bottlenecks, utilization, capacity)
- A CMO when discussing marketing (conversion, positioning, customer psychology, LTV)
- A therapist when discussing personal growth (accountability, patterns, blind spots, energy)
- A data scientist when discussing patterns (correlations, anomalies, projections, causation)
- A BEST FRIEND who tells the truth even when it's uncomfortable

${"═".repeat(3)} ADVANCED REASONING ${"═".repeat(3)}
- MULTI-STEP PLANNING: When a problem is complex, break it into numbered phases. Show Phase 1 (now), Phase 2 (this week), Phase 3 (this month). Make each phase specific and measurable.
- SECOND-ORDER THINKING: Don't just answer "what happens next" — answer "what happens AFTER that." Every action has a chain of consequences. Trace at least 2 levels deep.
- CONTRARIAN CHECK: Before recommending, ask yourself "what would a smart person who disagrees say?" If the counterargument is strong, acknowledge it.
- QUANTIFY EVERYTHING: Never say "a lot" or "many." Say "$350 average" or "7 out of 10" or "3x faster." If you don't have exact numbers, estimate with a confidence range.
- PATTERN MATCHING: Cross-reference what you know about THIS shop with what works in the auto repair industry. If a strategy worked for other shops, say so.
- PROACTIVE SURFACING: If you notice something in the data that Nour hasn't asked about but SHOULD know, lead with it. "Before I answer your question — I noticed X. This matters because Y."
- MEMORY SYNTHESIS: Don't just recall individual memories — synthesize them into insights. "Combining 3 patterns I've noticed: Tuesdays are slow, brake jobs spike after rain, and your walk rate increases when you don't follow up within 2 hours. This means..."
Never give surface-level answers. Always go one level deeper than expected.

${"═".repeat(3)} ALWAYS-ON BACKGROUND THINKING ${"═".repeat(3)}
On EVERY response, ALSO ask yourself these questions silently and surface anything relevant:
- "What would make Nour more money RIGHT NOW?" — Is there low-hanging revenue on the table?
- "What is Nour wasting time on?" — Can something be automated, delegated, or eliminated?
- "What would make Nour's life easier?" — Is there friction that could be removed?
- "What risk is Nour not seeing?" — Is there something about to break, expire, or go wrong?
- "What customer needs follow-up?" — Is there a stale lead, unpaid invoice, or missed callback?
- "What pattern am I noticing?" — Is today's data consistent with the trend, or is something off?
- "What should Nour STOP doing?" — Is he doing something that doesn't move the needle?
- "What's the ONE thing that would 10x this?" — What's the leverage point everyone misses?
- "Is Nour taking care of himself?" — Health, sleep, stress affect business performance.
- "What would a $10M shop look like?" — How does today's operation compare to the vision?

If ANY of these questions reveals something important, LEAD with it — even before answering the original question. Nour needs to know what he doesn't know he needs to know.

${"═".repeat(3)} NOUR'S PERSONAL OPERATING PROFILE ${"═".repeat(3)}
These are REAL patterns from 463 analyzed conversations. Use them to be a BETTER advisor:

ADHD MANAGEMENT:
- Nour takes Adderall IR 10mg. His focus is best in morning windows.
- Structure beats willpower. When he asks for "motivation" give him a SYSTEM instead.
- Break big tasks into 5-minute wins. Long ambiguous projects trigger avoidance.

THE BUILD-DRIFT-RESET CYCLE (his #1 pattern):
- Phase 1: BUILDS an elaborate system with intensity and excitement
- Phase 2: DRIFTS when boredom hits — seeks novelty, new tools, new plans
- Phase 3: RESETS by guilt-building another new system, abandoning the last
- YOUR JOB: Catch Phase 2 EARLY. If Nour starts asking about new tools, new projects, or redesigning systems that already work — that's DRIFT. Call it out: "This looks like drift. The current system works. What specifically isn't working?"

BOREDOM INTOLERANCE:
- When things are calm and routine, he seeks stimulation. This is DANGEROUS.
- "Boring repetition beats intensity spikes" — remind him when he's chasing novelty.
- Routine = compounding. Novelty = reset. Every time.

PERSONAL GOALS:
- Weight: 230 -> 186 lbs target. Track and ask about it.
- Revenue: $10K/month owner take-home. Every recommendation should tie to this.
- Family: Married to Dania. Trying for kids 4+ years. Don't bring this up unless he does.
- Turo: Has a Cadillac listed. Low-maintenance side income.
- Spanish: Learning for customer service. Encourage this.

GUARDRAILS — What to watch for:
- Late-night overthinking -> "It's late. Write it down and decide tomorrow with fresh eyes."
- New tool/project excitement during an unfinished sprint -> "Finish what's in motion first."
- Spending impulse -> "Does this make you money or cost you money?"
- Skipping workouts -> "Your body affects your business performance. Non-negotiable."
- Analysis paralysis -> "Pick the 80% option and execute. Perfect is the enemy of done."

${"═".repeat(3)} PROACTIVE INTELLIGENCE ${"═".repeat(3)}
Don't just answer questions. THINK AHEAD:
- If Nour asks about today's revenue -> also mention what tomorrow looks like based on patterns
- If Nour asks about a customer -> pull their full history, estimate their lifetime value
- If Nour asks about a repair -> check if Auto Labor Guide has the labor time, suggest upsells
- If Nour asks about marketing -> reference which past campaigns actually drove leads
- If Nour asks about anything -> connect it to the bigger picture (revenue, growth, life goals)
- If data looks unusual -> flag it before being asked ("Revenue is 30% below Thursday average")

${"═".repeat(3)} RULES ${"═".repeat(3)}
1. Reference real numbers from LIVE BUSINESS STATE. Never round or estimate when you have exact data.
2. If you can take action, describe exactly what you did and what the result was.
3. If you need data you don't have, say what's missing AND suggest how to get it.
4. Always end with "NEXT MOVE:" — the highest-leverage action Nour can do in the next 5 minutes.
5. Back up EVERY recommendation with data or memory. "I recommend X because Y (data: Z)."
6. For projects: break into phases, track progress, flag blockers, estimate revenue impact.
7. For decisions: weigh trade-offs, recommend with conviction, log reasoning, note what you'd do differently.
8. For personal growth: be the accountability partner. No coddling. Reference commitments and habits.
9. Format with clear headers. Keep it punchy but complete. Use bullet points for actions.
10. SELF-CHECK: verify all facts. If you cite a number, make sure it came from live data — don't guess.
11. REMEMBER: After every interaction, I learn. If Nour corrects me, I'll remember for next time.
12. CONNECT: Every answer should connect to at least ONE of: revenue, customer satisfaction, or Nour's personal goals.
${bizContext}
${input.context ? "\nADDITIONAL CONTEXT:\n" + Object.entries(input.context).map(([k, v]) => `${k}: ${v}`).join("\n") : ""}`,
      },
      { role: "user", content: input.command },
    ],
    maxTokens: 2000,
  });

  const reply = response.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    throw new Error("Nick AI failed to respond");
  }

  log.info(`Operator command: "${input.command.slice(0, 80)}..." → ${reply.length} chars`);

  // Auto-learn from this interaction (async, don't block)
  import("../../services/nickMemory").then(({ learnFromInteraction }) =>
    learnFromInteraction(input.command, reply)
  ).catch(e => log.warn("[nickActions:operator] interaction learning failed:", e));

  // Track what Nour asks about
  import("../../services/nickMemory").then(({ trackQuestion }) => {
    const words = input.command.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    const topic = words.slice(0, 3).join(" ");
    if (topic) trackQuestion(topic);
  }).catch(e => log.warn("[nickActions:operator] question tracking failed:", e));

  // Track brief engagement
  import("../../services/feedbackLoop").then(({ recordBriefResponse }) =>
    recordBriefResponse()
  ).catch(e => log.warn("[nickActions:operator] brief response tracking failed:", e));

  // Self-critique
  import("../../_core/llm").then(async ({ invokeLLM: llm }) => {
    try {
      const critique = await llm({
        messages: [
          { role: "system", content: `Rate this Nick AI response 1-10. Was it: specific (used real data)? actionable (clear next step)? connected (to revenue/customers/goals)? Respond with just a number.` },
          { role: "user", content: `Q: ${input.command.slice(0, 200)}\nA: ${reply.slice(0, 500)}` },
        ],
        maxTokens: 10,
      });
      const rawContent = critique.choices?.[0]?.message?.content;
      const contentStr = typeof rawContent === "string" ? rawContent : "";
      const score = parseInt(contentStr.match(/\d+/)?.[0] || "0", 10);
      if (score > 0 && score <= 10) {
        const { remember: mem } = await import("../../services/nickMemory");
        if (score <= 5) {
          await mem({ type: "lesson", content: `Self-critique: scored ${score}/10 on "${input.command.slice(0, 60)}". Need to be more specific/actionable.`, source: "self_critique", confidence: 0.6 });
        }
      }
    } catch (e) { log.warn("[nickActions:operator] self-critique scoring failed:", e); }
  }).catch(e => log.warn("[nickActions:operator] self-critique LLM call failed:", e));

  return {
    reply,
    timestamp: new Date().toISOString(),
    tokensUsed: response.usage?.total_tokens ?? 0,
  };
}

// ─── Pull insights from statenour brain ──────────────

export async function handlePullFromStatenour() {
  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
  const syncKey = process.env.STATENOUR_SYNC_KEY || "";
  if (!syncKey) return { success: false, error: "No sync key" };

  try {
    const res = await fetch(`${statenourUrl}/api/sync/nour-os`, {
      headers: { "x-sync-key": syncKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

    const data = await res.json();
    const brain = data?.data || data;
    const { remember } = await import("../../services/nickMemory");

    let imported = 0;

    if (brain.recentInsights?.length) {
      for (const insight of brain.recentInsights.slice(0, 5)) {
        await remember({
          type: "insight",
          content: `[From statenour brain] ${insight.title || insight.detail || ""}`.slice(0, 500),
          source: "statenour_pull",
          confidence: 0.8,
        });
        imported++;
      }
    }

    if (brain.recentPatterns?.length) {
      for (const pattern of brain.recentPatterns.slice(0, 3)) {
        await remember({
          type: "pattern",
          content: `[From statenour brain] ${pattern.patternName}: ${pattern.evidence || ""}`.slice(0, 500),
          source: "statenour_pull",
          confidence: 0.7,
        });
        imported++;
      }
    }

    if (brain.driftAlerts?.length) {
      for (const alert of brain.driftAlerts.slice(0, 3)) {
        await remember({
          type: "lesson",
          content: `[Drift alert] ${alert.ruleName}: ${alert.message}`.slice(0, 500),
          source: "statenour_pull",
          confidence: 0.9,
        });
        imported++;
      }
    }

    return { success: true, imported, source: "statenour-brain" };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Run database migrations ──────────────────────────

export async function handleRunMigrations() {
  try {
    const { getDb } = await import("../../db");
    const d = await getDb();
    if (!d) return { success: false, error: "DB not available" };

    const migrations = [
      // 2026-06-23 · social_drafts — Stored briefs/drafts from Carousel/Reel Studios
      `CREATE TABLE IF NOT EXISTS social_drafts (id VARCHAR(64) PRIMARY KEY, contentType VARCHAR(16) NOT NULL, topic VARCHAR(255) NOT NULL, briefJson TEXT NOT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_social_drafts_type (contentType), INDEX idx_social_drafts_created (createdAt))`,
      // 2026-06-23 · customer_testimonials — Curated customer reviews and testimonials generated/validated by studios
      `CREATE TABLE IF NOT EXISTS customer_testimonials (id INT AUTO_INCREMENT PRIMARY KEY, author VARCHAR(100) NULL, text TEXT NOT NULL, rating INT NOT NULL DEFAULT 5, source VARCHAR(50) NOT NULL DEFAULT 'manual', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_testimonials_rating (rating))`,
      `CREATE TABLE IF NOT EXISTS chat_analytics (id int AUTO_INCREMENT PRIMARY KEY, sessionId int, hourOfDay int NOT NULL, dayOfWeek int NOT NULL, month int NOT NULL, messageCount int NOT NULL DEFAULT 0, converted int NOT NULL DEFAULT 0, leadScore int, duration int, createdAt timestamp NOT NULL DEFAULT (now()))`,

      `CREATE TABLE IF NOT EXISTS review_pipeline (id int AUTO_INCREMENT PRIMARY KEY, authorName varchar(255) NOT NULL, rating int NOT NULL, reviewText text, reviewTime int, relativeTime varchar(100), sentiment varchar(20), topicsJson text, keywordsJson text, urgency varchar(20), suggestedResponse text, status varchar(20) DEFAULT 'pending', createdAt timestamp NOT NULL DEFAULT (now()), reviewed int NOT NULL DEFAULT 0, responseSent int NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS search_performance (id int AUTO_INCREMENT PRIMARY KEY, query varchar(500) NOT NULL, page varchar(500), clicks int DEFAULT 0, impressions int DEFAULT 0, ctr int DEFAULT 0, position int DEFAULT 0, date date, createdAt timestamp NOT NULL DEFAULT (now()))`,
      `CREATE TABLE IF NOT EXISTS pipeline_runs (id int AUTO_INCREMENT PRIMARY KEY, pipelineName varchar(100) NOT NULL, status varchar(20) NOT NULL, startedAt timestamp NOT NULL DEFAULT (now()), completedAt timestamp, durationMs int, resultJson text, error text)`,
      `CREATE TABLE IF NOT EXISTS daily_execution (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, mission TEXT, notes TEXT, status ENUM('on_track','drifting','off_track') NOT NULL DEFAULT 'on_track', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY idx_daily_date (date))`,
      `CREATE TABLE IF NOT EXISTS daily_habits (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, habit_key VARCHAR(50) NOT NULL, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY idx_habit_date_key (date, habit_key))`,
      `CREATE TABLE IF NOT EXISTS conversation_memory (id INT AUTO_INCREMENT PRIMARY KEY, visitorKey VARCHAR(255) NOT NULL, category VARCHAR(50) NOT NULL, content TEXT NOT NULL, sessionId INT NULL, confidence FLOAT NOT NULL DEFAULT 0.8, reinforcements INT NOT NULL DEFAULT 1, lastAccessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      // 2026-05-31 · Meta page-token durable store. Holds the minted,
      // never-expiring Page access token server-side so socialPost survives
      // pod restarts without re-minting. Read/written only server-side.
      `CREATE TABLE IF NOT EXISTS app_secret_kv (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
      // 2026-06-18 · reel_jobs — durable status table for the Faceless Reel
      // pipeline. Gen->assemble->publish runs as a background cron job (pulse
      // tier, REEL_GENERATION_ENABLED-gated), never a synchronous request.
      // Drizzle def: drizzle/schema.ts reelJobs.
      `CREATE TABLE IF NOT EXISTS reel_jobs (id INT AUTO_INCREMENT PRIMARY KEY, briefId VARCHAR(64) NOT NULL, payload TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued', clipUrlsJson TEXT, voUrl VARCHAR(1000), musicUrl VARCHAR(1000), mp4Url VARCHAR(1000), igPostId VARCHAR(64), caption TEXT, attempts INT NOT NULL DEFAULT 0, error VARCHAR(1000), source VARCHAR(16) NOT NULL DEFAULT 'admin', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_reel_jobs_status (status), INDEX idx_reel_jobs_created (createdAt))`,
      // 2026-05-23 · drizzle/0052_payment_alert_backlog.sql — paid-but-unfulfillable recovery
      `CREATE TABLE IF NOT EXISTS payment_alert_backlog (id INT AUTO_INCREMENT PRIMARY KEY, tireOrderNumber VARCHAR(64) DEFAULT NULL, invoiceNumber VARCHAR(64) DEFAULT NULL, amountCents INT NOT NULL, summary VARCHAR(500) NOT NULL, failureReason ENUM('email_failed', 'telegram_failed', 'both_failed') NOT NULL, resolvedAt TIMESTAMP NULL DEFAULT NULL, resolvedBy VARCHAR(255) DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_payment_alert_backlog_unresolved (resolvedAt, createdAt DESC), INDEX idx_payment_alert_backlog_tire_order (tireOrderNumber), INDEX idx_payment_alert_backlog_invoice (invoiceNumber))`,
      // 2026-05-23 · drizzle/0053_event_dlq_lifecycle.sql — persistent DLQ
      `CREATE TABLE IF NOT EXISTS event_dlq (id INT AUTO_INCREMENT PRIMARY KEY, eventType VARCHAR(64) NOT NULL, destination VARCHAR(64) NOT NULL, error VARCHAR(500) NOT NULL, payload JSON, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, alertedAt TIMESTAMP NULL DEFAULT NULL, INDEX idx_event_dlq_pattern (eventType, destination, createdAt DESC), INDEX idx_event_dlq_alerted (alertedAt, createdAt DESC))`,
      // 2026-05-23 · drizzle/0053_event_dlq_lifecycle.sql — multi-pod lifecycle tracker
      `CREATE TABLE IF NOT EXISTS lifecycle_tracker_events (phone10 VARCHAR(10) PRIMARY KEY, customerName VARCHAR(255) DEFAULT NULL, events JSON NOT NULL, convertedAt TIMESTAMP NULL DEFAULT NULL, firstSeenAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, lastSeenAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_lifecycle_last_seen (lastSeenAt DESC), INDEX idx_lifecycle_unconverted (convertedAt, lastSeenAt DESC))`,
      // 2026-05-23 · drizzle/0054_tire_markup_100.sql — force tire markup to 100% (cost × 2)
      // Bug: admin UI defaulted to "50" — operator save = silent 50% markup. Backend default is 100.
      // Idempotent: INSERT IGNORE then UPDATE force-syncs the value regardless of current state.
      `INSERT IGNORE INTO shop_settings (\`key\`, value, category, label, updatedBy) VALUES ('tireMarkup', '100', 'pricing', 'Tire Markup %', 'system-migration-0054')`,
      `UPDATE shop_settings SET value = '100', updatedBy = 'system-migration-0054' WHERE \`key\` = 'tireMarkup'`,
      // 2026-05-23 · drizzle/0055_declined_recovery_sequence.sql — 5×3 SMS sequence
      // Adds new touch column triplets (3d/14d/45d) + recoveryProfile cache.
      // ALTER ... ADD COLUMN IF NOT EXISTS is MySQL 8+ — TiDB supports.
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS recovery_profile VARCHAR(8) DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_alg_est_recovery_profile ON alg_estimates (recovery_profile)`,
      // 2026-05-23 · drizzle/0056_customer_psycho_profile.sql — psychographic profile
      // Powers profile-aware SMS routing across win-back + drip + declined-recovery.
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile_score INT DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_customer_psycho ON customers (psycho_profile)`,
      // 2026-05-23 · drizzle/0057_vapi_call_eval.sql — Nick AI eval columns
      // Daily cron scores every call 0-100 · powers Telegram quality alerts +
      // compound learning via nickMemory.
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_score TINYINT NULL DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_outcome VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_reasoning TEXT DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vapi_eval_at_score ON vapi_call_logs (eval_at, eval_score)`,
      // 2026-05-23 · drizzle/0058_competitor_snapshots.sql — Tier S competitor intel
      // Persistent baselines for the in-memory competitor monitor · survives pod restart.
      `CREATE TABLE IF NOT EXISTS competitor_snapshots (id BIGINT AUTO_INCREMENT PRIMARY KEY, competitor_name VARCHAR(160) NOT NULL, place_id VARCHAR(128) NOT NULL, rating DECIMAL(3,2) NOT NULL DEFAULT 0, review_count INT NOT NULL DEFAULT 0, source VARCHAR(32) NOT NULL DEFAULT 'google_places', captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, raw_payload JSON DEFAULT NULL, INDEX idx_competitor_captured (place_id, captured_at), INDEX idx_captured_at (captured_at))`,
      // wave-143 · follow-up cadence (the flywheel · 7/30/60-day trust calls
      // after a completed job). The UNIQUE KEY (bookingId, touch) IS the
      // at-most-once guarantee — a customer can never be auto-called twice for
      // the same touch, even across overlapping cron runs.
      `CREATE TABLE IF NOT EXISTS voice_followups (id INT AUTO_INCREMENT PRIMARY KEY, bookingId INT NOT NULL, touch ENUM('d7','d30','d60') NOT NULL, phone VARCHAR(30) DEFAULT NULL, customerName VARCHAR(255) DEFAULT NULL, status ENUM('called','failed','skipped') NOT NULL DEFAULT 'called', vapiCallId VARCHAR(64) DEFAULT NULL, errorMessage VARCHAR(500) DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uniq_booking_touch (bookingId, touch), INDEX idx_followup_created (createdAt))`,
      // 2026-05-23 · drizzle/0059_wave_metrics.sql — Tier A closed-loop delivery
      // Baseline + measurement window per shipped wave · daily cron writes lift/no-lift.
      `CREATE TABLE IF NOT EXISTS wave_metrics (id BIGINT AUTO_INCREMENT PRIMARY KEY, wave_id VARCHAR(64) NOT NULL, metric_key VARCHAR(64) NOT NULL, baseline_value DECIMAL(12,4) NOT NULL, measure_at TIMESTAMP NOT NULL, measured_value DECIMAL(12,4) DEFAULT NULL, delta_percent DECIMAL(8,2) DEFAULT NULL, status ENUM('pending','lifted','no_lift','regression','resolver_error') NOT NULL DEFAULT 'pending', notes TEXT DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, measured_at TIMESTAMP NULL DEFAULT NULL, INDEX idx_wave_measure_at (status, measure_at), INDEX idx_wave_id (wave_id))`,
      // 2026-05-23 · drizzle/0060_agentic_audit.sql — Tier S agentic-actions-auditor
      // metadata JSON column captures audit findings · audited_at stamps the audit.
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vapi_audited_at ON vapi_call_logs (audited_at)`,
      // 2026-06-21 · Phase 5.2 live IG insights — reach/saved/views/shares snapshots
      // on instagram_analytics (views replaces Meta's deprecated plays). Idempotent.
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS reach INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS saved INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS views INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS shares INT DEFAULT NULL`,
      // 2026-05-24 · drizzle/0061_service_affinity_v2.sql — SA v2 closed loop
      // 4 new tables: predictions/impressions/actions/outcomes. Enables
      // operator-flip activation gate via admin UI without TiDB Cloud login.
      // See apps/nickstire/docs/2026-05-24-service-affinity-v2.md §2.3.
      `CREATE TABLE IF NOT EXISTS service_affinity_predictions (id BIGINT NOT NULL AUTO_INCREMENT, customer_id BIGINT NOT NULL, predicted_service VARCHAR(64) NOT NULL, confidence DECIMAL(5,4) NOT NULL, features_json JSON NOT NULL, model_version VARCHAR(32) NOT NULL, ab_arm ENUM('treatment','control') NOT NULL DEFAULT 'treatment', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_customer_created (customer_id, created_at DESC), INDEX idx_model_created (model_version, created_at), INDEX idx_ab_arm_created (ab_arm, created_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_impressions (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, surface VARCHAR(64) NOT NULL, operator_id VARCHAR(64) NULL, PRIMARY KEY (id), INDEX idx_prediction_shown (prediction_id, shown_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_actions (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, action VARCHAR(32) NOT NULL, acted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, operator_id VARCHAR(64) NULL, PRIMARY KEY (id), INDEX idx_prediction_acted (prediction_id, acted_at), INDEX idx_action_acted (action, acted_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_outcomes (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, invoice_id BIGINT NULL, matched TINYINT(1) NOT NULL, resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, window_days INT NOT NULL, PRIMARY KEY (id), INDEX idx_prediction (prediction_id), INDEX idx_resolved (resolved_at)) ENGINE=InnoDB`,
      // 2026-05-25 · drizzle/0050_wave_audit_unique_pred_surface.sql — UNIQUE KEY
      // Wave-fix-2026-05-25 (audit #100). Adds UNIQUE constraint on
      // (prediction_id, surface) so INSERT IGNORE in crossSellOutreach actually
      // dedupes impressions now that cross-sell-outreach moved from daily (24h)
      // to hourly (2h) tier in Wave C. Without this, hourly cross-sell would
      // bloat prediction_impressions by 12× per prediction per day.
      //
      // Step 1 dedupes any existing rows (defensive — table had ~zero rows pre-fix).
      // Step 2 adds the UNIQUE KEY. The existing catch in this loop recognizes
      // "Duplicate" in the error message so re-runs are idempotent.
      `DELETE FROM prediction_impressions WHERE id NOT IN (SELECT * FROM (SELECT MIN(id) FROM prediction_impressions GROUP BY prediction_id, surface) AS keepers)`,
      `ALTER TABLE prediction_impressions ADD UNIQUE KEY uk_prediction_surface (prediction_id, surface)`,
      // 2026-05-27 · drizzle/0062_search_performance_dedupe.sql · audit #79
      // GSC sync was duplicating rows on every cron run (~30-60× inflation
      // confirmed against live GSC). Three idempotent steps · TiDB-syntax
      // compatible (first attempt used MySQL `DELETE alias FROM table alias
      // JOIN` which TiDB rejects · this uses the NOT-IN subquery pattern
      // that already shipped successfully in the prediction_impressions
      // dedup above):
      //   1. Normalize NULL pages so the unique key covers every row
      //   2. Dedupe · keep only MAX(id) per (date, query, page)
      //   3. Add UNIQUE KEY (plain). TiDB/MySQL do NOT support IF NOT EXISTS
      //      in the ADD {INDEX|KEY} clause — it's an ER_PARSE_ERROR, so the
      //      index was never created while this carried IF NOT EXISTS.
      //
      // Idempotency comes from the catch block above: once the index exists
      // TiDB throws ER_DUP_KEYNAME ("Duplicate key name '...'"), whose message
      // the "Duplicate" substring match catches -> skipped. The dedupe in
      // step 2 protects the first creation from an ER_DUP_ENTRY violation.
      `UPDATE search_performance SET page = '' WHERE page IS NULL`,
      `DELETE FROM search_performance WHERE id NOT IN (SELECT * FROM (SELECT MAX(id) FROM search_performance GROUP BY date, query, page) AS keepers)`,
      // TiDB / MySQL hard cap on InnoDB index keys: 3072 bytes. The
      // unconstrained columns (date 10 + query 500 + page 1000) ×4 bytes
      // utf8mb4 = ~6040 bytes · over the cap. Prefix the wide columns
      // down to a safe combined index footprint. 255 for query + 500 for
      // page covers all real-world GSC values (queries are short ·
      // pages are URLs typically <300 chars on this site).
      `ALTER TABLE search_performance ADD UNIQUE KEY uq_search_perf_date_query_page (date, query(255), page(500))`,
      // 2026-05-30 · drizzle/0063_nonstop_nick_memberships.sql — Nonstop Nick
      // $7.99/mo tire membership. status mirrors the Stripe subscription (set by
      // the /api/webhooks/stripe subscription handler) so the counter verifies a
      // member by phone WITHOUT a live Stripe call. Indexes: phone+status (counter
      // lookup), unique stripeSubscriptionId (idempotent webhook upsert).
      // Inlined here so it applies via the runMigrations admin tRPC (Chrome path).
      `CREATE TABLE IF NOT EXISTS memberships (id INT AUTO_INCREMENT PRIMARY KEY, plan VARCHAR(64) NOT NULL DEFAULT 'nonstop-nick', phone VARCHAR(20) NOT NULL, name VARCHAR(255) NULL, email VARCHAR(320) NULL, vehiclePlate VARCHAR(16) NULL, vehicleDesc VARCHAR(255) NULL, status ENUM('active','past_due','canceled','incomplete') NOT NULL DEFAULT 'incomplete', stripeCustomerId VARCHAR(64) NULL, stripeSubscriptionId VARCHAR(64) NULL, currentPeriodEnd TIMESTAMP NULL, canceledAt TIMESTAMP NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_membership_phone (phone), INDEX idx_membership_status (status), UNIQUE KEY uq_membership_stripe_sub (stripeSubscriptionId))`,
      // 2026-06-01 · drizzle/0065_ig_autopost_log.sql — autonomous IG+FB autoposter log.
      // One row per run (dryrun|posted|failed|aborted). Indexes serve: anti-repetition
      // (recent conceptKeys), once-per-slot-per-day dedupe (guards the 15-min cron from
      // double-posting inside one slot window), and admin review-by-status. Bare
      // identifiers — none are reserved words, so no backtick-escaping needed. The cron's
      // slot-dedupe fail-OPENS when this table is missing, so it MUST exist in prod
      // before IG_AUTOPOST_DRYRUN=false, or each slot double-posts.
      `CREATE TABLE IF NOT EXISTS ig_autopost_log (id INT AUTO_INCREMENT PRIMARY KEY, archetype VARCHAR(20) NOT NULL, conceptKey VARCHAR(64) NOT NULL, slot VARCHAR(16) NOT NULL DEFAULT 'manual', slotDate VARCHAR(10) NOT NULL, evalScoresJson TEXT NULL, captionWeighted INT NULL, overallScore INT NULL, status VARCHAR(16) NOT NULL, caption TEXT NOT NULL, hashtags TEXT NULL, imagePrompt TEXT NULL, imageUrl VARCHAR(1000) NULL, igPostId VARCHAR(64) NULL, fbPostId VARCHAR(64) NULL, error VARCHAR(500) NULL, source VARCHAR(16) NOT NULL DEFAULT 'cron', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_ig_autopost_created (createdAt), INDEX idx_ig_autopost_slot_day (slot, slotDate), INDEX idx_ig_autopost_status (status))`,
      // 2026-06-18 · drizzle/0071_scheduled_posts.sql — publish-later queue.
      // The scheduled-posts cron fires due owner-scheduled rows through
      // socialPublish; until this table exists, listScheduled/schedulePost
      // error (gracefully). Idempotent CREATE TABLE IF NOT EXISTS — the loop's
      // "already exists" catch makes re-runs no-ops.
      `CREATE TABLE IF NOT EXISTS scheduled_posts (id INT AUTO_INCREMENT PRIMARY KEY, platforms JSON NOT NULL, caption TEXT NOT NULL, imageUrl VARCHAR(1000) NULL, videoUrl VARCHAR(1000) NULL, imageUrls JSON NULL, scheduledAt TIMESTAMP NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending', postedAt TIMESTAMP NULL, igPostId VARCHAR(64) NULL, error VARCHAR(500) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_scheduled_due (status, scheduledAt))`,
      // Content Domination Engine tables (2026-06-24)
      `CREATE TABLE IF NOT EXISTS content_manufacturing_campaigns (
        id VARCHAR(64) PRIMARY KEY,
        topic VARCHAR(128) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        target_monthly_volume INT NOT NULL DEFAULT 30,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_campaign_topic (topic)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS social_content_inventory (
        id VARCHAR(64) PRIMARY KEY,
        campaign_id VARCHAR(64) NULL,
        content_type ENUM('reel', 'carousel', 'post', 'story', 'poll') NOT NULL,
        platform ENUM('instagram', 'facebook', 'both') NOT NULL DEFAULT 'both',
        topic VARCHAR(128) NOT NULL,
        series_name VARCHAR(128) NOT NULL,
        episode_number INT NOT NULL DEFAULT 1,
        hook_category VARCHAR(64) NOT NULL,
        hook_text TEXT NOT NULL,
        body_text TEXT NOT NULL,
        visual_style VARCHAR(64) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        score_curiosity INT NOT NULL DEFAULT 0,
        score_emotion INT NOT NULL DEFAULT 0,
        score_shareability INT NOT NULL DEFAULT 0,
        score_comment_potential INT NOT NULL DEFAULT 0,
        score_save_potential INT NOT NULL DEFAULT 0,
        score_local_relevance INT NOT NULL DEFAULT 0,
        score_revenue_relevance INT NOT NULL DEFAULT 0,
        score_authority INT NOT NULL DEFAULT 0,
        score_hook_strength INT NOT NULL DEFAULT 0,
        score_overall INT NOT NULL DEFAULT 0,
        gsc_query_seed VARCHAR(255) NULL,
        weather_trigger_condition VARCHAR(128) NULL,
        interactive_dm_keyword VARCHAR(64) NULL,
        metrics_reach INT DEFAULT 0,
        metrics_engagement INT DEFAULT 0,
        metrics_shares INT DEFAULT 0,
        metrics_saves INT DEFAULT 0,
        metrics_comments INT DEFAULT 0,
        metrics_bookings_attributed INT DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        scheduled_at TIMESTAMP NULL DEFAULT NULL,
        published_at TIMESTAMP NULL DEFAULT NULL,
        asset_paths JSON NULL,
        brief_json TEXT NULL,
        error_message VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sci_status_scheduled (status, scheduled_at),
        INDEX idx_sci_campaign (campaign_id),
        INDEX idx_sci_topic_type (topic, content_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_reach INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_engagement INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_shares INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_saves INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_comments INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_bookings_attributed INT DEFAULT 0`,
      // 2026-07-07 · BE-DATA-1 · first DB-level FK on nickstire (120 tables had
      // zero). sms_messages.conversationId -> sms_conversations.id. Applied to
      // prod TiDB v8.5.3 first (pre-check: 0 orphans of 8,776 rows; verified
      // constraint present). ON DELETE CASCADE is inert in practice — nothing
      // in server/ ever deletes a conversation. Not natively idempotent (TiDB
      // has no ADD CONSTRAINT IF NOT EXISTS), but the loop's catch tolerates the
      // "Duplicate foreign key constraint name" re-run error. Drizzle def:
      // drizzle/schema.ts smsMessages.conversationId.references(...).
      `ALTER TABLE sms_messages ADD CONSTRAINT fk_sms_msg_conv FOREIGN KEY (conversationId) REFERENCES sms_conversations(id) ON DELETE CASCADE`,
      // 2026-07-07 · BE-DATA-1 wave 2 · invoices.customerId -> customers.id.
      // ON DELETE SET NULL — an invoice is a financial record; never cascade-
      // delete it, just unlink. Nullable (395 of 2,792 rows are legitimately
      // unmatched imports). Applied to prod first (pre-check: 0 orphans).
      // Loop-catch tolerates the "Duplicate ... constraint" re-run error.
      // (work_orders.customer_id -> customers.id was DEFERRED — its lone row is
      //  an orphan pointing at a missing customer; operator cleans that 1 row.)
      `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL`,
      // 2026-07-07 · BE-DATA-1 wave 3 · 9 ownership CASCADE FKs (parents never
      // deleted in server/ -> cascade dormant) + work_orders->customers SET NULL.
      // All applied to prod TiDB first (per-pair pre-check: 0 orphans; the one
      // work_orders orphan pointer was NULLed, row preserved). Types verified
      // (varchar(36) UUID + bigint keys match parents). Loop-catch tolerates the
      // Duplicate-constraint re-run error. Drizzle defs: drizzle/schema.ts .references().
      `ALTER TABLE inspection_items ADD CONSTRAINT fk_inspection_items_inspection FOREIGN KEY (inspectionId) REFERENCES vehicle_inspections(id) ON DELETE CASCADE`,
      `ALTER TABLE customer_metrics ADD CONSTRAINT fk_customer_metrics_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE work_order_items ADD CONSTRAINT fk_wo_items_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE work_order_transitions ADD CONSTRAINT fk_wo_transitions_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE qc_checklists ADD CONSTRAINT fk_qc_checklists_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE prediction_impressions ADD CONSTRAINT fk_pred_impressions_pred FOREIGN KEY (prediction_id) REFERENCES service_affinity_predictions(id) ON DELETE CASCADE`,
      `ALTER TABLE prediction_actions ADD CONSTRAINT fk_pred_actions_pred FOREIGN KEY (prediction_id) REFERENCES service_affinity_predictions(id) ON DELETE CASCADE`,
      `ALTER TABLE sms_orchestration_outcomes ADD CONSTRAINT fk_sms_orch_outcomes_orch FOREIGN KEY (orchestration_id) REFERENCES sms_orchestrations(id) ON DELETE CASCADE`,
      `ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      // 2026-07-07 · BE-DATA-1 wave 4/5 · 19 more FKs (money-adjacent SET NULL +
      // RESTRICT ledgers/technicians + one CASCADE). All applied to prod first,
      // per-pair pre-check 0 orphans (pure additive, no data writes), types
      // verified vs parent PKs. Skipped invoices.workOrderId (int) -> work_orders.id
      // (varchar(36)) — impossible FK, type mismatch. Loop-catch = idempotent.
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_callback FOREIGN KEY (callbackId) REFERENCES callback_requests(id) ON DELETE SET NULL`,
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_invoice FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE estimates_log ADD CONSTRAINT fk_estlog_invoice FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE estimates_log ADD CONSTRAINT fk_estlog_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE alg_estimates ADD CONSTRAINT fk_algest_invoice FOREIGN KEY (matched_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE alg_estimates ADD CONSTRAINT fk_algest_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE vapi_call_logs ADD CONSTRAINT fk_vapi_lead FOREIGN KEY (leadId) REFERENCES leads(id) ON DELETE SET NULL`,
      `ALTER TABLE vapi_call_logs ADD CONSTRAINT fk_vapi_callback FOREIGN KEY (callbackId) REFERENCES callback_requests(id) ON DELETE SET NULL`,
      `ALTER TABLE payments ADD CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE tire_orders ADD CONSTRAINT fk_tireorders_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE tire_orders ADD CONSTRAINT fk_tireorders_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE warranties ADD CONSTRAINT fk_warranties_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE payments ADD CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT`,
      `ALTER TABLE loyalty_transactions ADD CONSTRAINT fk_loyalty_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE RESTRICT`,
      `ALTER TABLE job_assignments ADD CONSTRAINT fk_jobassign_tech FOREIGN KEY (technicianId) REFERENCES technicians(id) ON DELETE RESTRICT`,
      `ALTER TABLE warranties ADD CONSTRAINT fk_warranties_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE RESTRICT`,
      `ALTER TABLE job_assignments ADD CONSTRAINT fk_jobassign_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE CASCADE`,
      // 2026-07-07 · BE-DATA-1 wave 5 · 8 more FKs (nickstire 31 -> 39). Owned-
      // record CASCADE (incl. 2 LIVE cascades where bookings ARE deleted:
      // review_requests + appointment_reminders) + service_history SET NULL.
      // Applied to prod first: 8 pairs 0 orphans; review_requests had 4 orphaned
      // test/sentinel rows (bookingId 0/99999, terminal status) DELETED per
      // operator confirmation, then FK added. Types verified.
      // SKIPPED service_affinity_predictions.customer_id -> customers.id: DB
      // column is BIGINT while customers.id is INT (ER_FK_INCOMPATIBLE_COLUMNS) —
      // impossible FK + a latent schema drift (drizzle declares int). Documented.
      `ALTER TABLE customer_vehicles ADD CONSTRAINT fk_custveh_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_vehicle FOREIGN KEY (vehicleId) REFERENCES customer_vehicles(id) ON DELETE SET NULL`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE review_requests ADD CONSTRAINT fk_reviewreq_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE CASCADE`,
      `ALTER TABLE winback_sends ADD CONSTRAINT fk_winback_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE sms_campaign_sends ADD CONSTRAINT fk_smscampsend_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE appointment_reminders ADD CONSTRAINT fk_apptremind_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE`,
      // 2026-07-07 · schema-drift audit · conversation_memory.conversionHits was
      // declared in drizzle + written by chat.ts (memory merge + conversion
      // reinforcement UPDATEs) but MISSING from the DB — those UPDATEs threw
      // "Unknown column", silently breaking chat conversion tracking. Add it.
      // Additive + safe (NOT NULL DEFAULT 0). IF NOT EXISTS = idempotent.
      `ALTER TABLE conversation_memory ADD COLUMN IF NOT EXISTS conversionHits INT NOT NULL DEFAULT 0`,
      // 2026-07-07 · BE-DATA-2 · customer phone-uniqueness. VIRTUAL generated
      // last-10 digits + a unique index reject a duplicate customer regardless
      // of stored phone format. Applied to prod first (0 dups; all insert paths
      // already catch ER_DUP_ENTRY). VIRTUAL — TiDB forbids ADD of a STORED
      // generated column via ALTER. IF NOT EXISTS + loop-catch = idempotent.
      // Drizzle def: drizzle/schema.ts customers.phone10 + uniq_customer_phone10.
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone10 VARCHAR(10) GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) VIRTUAL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_phone10 ON customers(phone10)`
    ];

    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const rawSql of migrations) {
      try {
        const { sql: sqlTag } = await import("drizzle-orm");
        await d.execute(sqlTag.raw(rawSql));
        applied++;
      } catch (err: unknown) {
        const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string; errno?: number; sqlMessage?: string } };
        const msg = e?.message || String(err);
        const cause = e?.cause;
        const causeMsg = cause?.sqlMessage || cause?.message || "";
        // Drizzle wraps the real driver error inside `err.cause` \u00b7 we need
        // it to diagnose. Check both layers for already-applied markers.
        const combined = `${msg} | ${causeMsg}`;
        const code = e?.code || cause?.code || "";
        // "Already-applied" wording varies by engine/object:
        //   MySQL: "...already exists" / "Duplicate key name"
        //   TiDB:  "index already exist <name>; a background job is trying to
        //          add the same index" (note "already exist", no trailing 's',
        //          and no "Duplicate"). The "already exist" substring covers
        //          both spellings; the duplicate-object error codes make
        //          re-runs no-ops regardless of the driver's prose.
        const alreadyApplied =
          combined.includes("already exist") ||
          combined.includes("Duplicate") ||
          code === "ER_DUP_KEYNAME" ||
          code === "ER_DUP_ENTRY";
        if (alreadyApplied) {
          skipped++;
        } else {
          skipped++;
          errors.push(`${rawSql.slice(0, 60)}... \u2192 msg=${msg.slice(0, 200)} | code=${e?.code || cause?.code || ""} | cause=${causeMsg.slice(0, 300)}`);
        }
      }
    }

    return { success: true, applied, skipped, total: migrations.length, errors: errors.length > 0 ? errors : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Import customers from ShopDriver CSV ─────────────

export async function handleImportCustomerCSV() {
  try {
    const { getDb } = await import("../../db");
    const d = await getDb();
    if (!d) return { success: false, error: "DB unavailable" };

    const fs = await import("fs");
    const path = await import("path");
    const candidates = [
      path.resolve(import.meta.dirname, "..", "..", "data", "shopdriver-customers.csv"),
      path.resolve(import.meta.dirname, "../../..", "data", "shopdriver-customers.csv"),
    ];
    const csvPath = candidates.find(p => fs.existsSync(p));
    if (!csvPath) return { success: false, error: "CSV not found" };

    const raw = fs.readFileSync(csvPath, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const rows = lines.slice(1);

    const { customers } = await import("../../../drizzle/schema");

    const allExisting = await d.select({ phone: customers.phone }).from(customers);
    const existingPhones = new Set(allExisting.map((c: { phone: string }) => c.phone.replace(/\D/g, "").slice(-10)));

    const toInsert: Array<{
      firstName: string; lastName: string; phone: string;
      email: string | null; address: string | null;
      city: string | null; state: string | null; zip: string | null;
      segment: "unknown";
    }> = [];

    let skipped = 0;
    for (const row of rows) {
      const fields = row.match(/(".*?"|[^,]*),?/g)?.map(f => f.replace(/^"|"$/g, "").replace(/,$/, "").trim()) || [];
      const [firstName, lastName, , workPhone, homePhone, mobilePhone, email, address1, , city, state, postalCode] = fields;

      const phone = (mobilePhone || homePhone || workPhone || "").replace(/\D/g, "");
      if (!phone || phone.length < 7 || (!firstName && !lastName)) { skipped++; continue; }
      if (existingPhones.has(phone.slice(-10))) { skipped++; continue; }

      existingPhones.add(phone.slice(-10));
      toInsert.push({
        firstName: firstName || "", lastName: lastName || "", phone,
        email: email || null, address: address1 || null,
        city: city || null, state: state || null, zip: postalCode || null,
        segment: "unknown",
      });
    }

    let imported = 0;
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      try {
        await d.insert(customers).values(batch);
        imported += batch.length;
      } catch (e) {
        log.warn("[routers/nickActions] operation failed:", e);
        for (const c of batch) {
          try { await d.insert(customers).values(c); imported++; } catch (e) { log.warn("[routers/nickActions] single customer insert failed:", e); skipped++; }
        }
      }
    }

    return { success: true, imported, skipped, total: rows.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Nick AI Agent — Intelligence gathering, operator command, context loading.
 * Handles: operatorCommand, pullFromStatenour, runMigrations, importCustomerCSV, syncShopDriver
 */
import { eq, gte, and, sql } from "drizzle-orm";
import { chatSessions, leads, bookings, invoices, customers, callbackRequests, reviewRequests } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import type { Invoice } from "../../../drizzle/schema";
import { log, db } from "./utils";

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
        d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "new")),
        d.select({ count: sql<number>`count(*)` }).from(chatSessions).where(gte(chatSessions.createdAt, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
        d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
        d.select({ count: sql<number>`count(*)` }).from(customers),
        d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo)),
        d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "new"), gte(leads.createdAt, weekAgo))),
        d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, weekAgo)),
      ]);

      const monthRevenueCents = monthInvoicesPaid.reduce((s: number, inv: Invoice) => s + inv.totalAmount, 0);
      const monthRevenue = Math.round(monthRevenueCents / 100);
      const avgTicket = monthInvoicesPaid.length > 0 ? Math.round(monthRevenue / monthInvoicesPaid.length) : 0;

      bizContext = `\nLIVE BUSINESS STATE (Nick's Tire & Auto):
- Time: ${now.toLocaleString("en-US", { timeZone: "America/New_York" })}
- Model: First come first serve, drop-offs encouraged (holds place in line)
TODAY:
- Leads: ${leadsToday[0]?.count ?? 0} | Drop-offs: ${bookingsToday[0]?.count ?? 0}
- Chat sessions: ${recentChats[0]?.count ?? 0}
THIS WEEK:
- Drop-offs: ${weekBookings[0]?.count ?? 0} | Leads: ${weekLeads[0]?.count ?? 0}
PIPELINE:
- Pending leads (new): ${callbacksPending[0]?.count ?? 0}
- Stale leads (new, 7d): ${staleLeads[0]?.count ?? 0}
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
        } catch (e) { console.warn("[nickActions:operator] memory health check failed:", e); }

        // Inject Nour's deep personal context
        try {
          const { getNourPersonalContext } = await import("../../services/nourContext");
          const personalContext = getNourPersonalContext();
          if (personalContext) bizContext += personalContext;
        } catch (e) { console.warn("[nickActions:operator] personal context load failed:", e); }
        if (memContext) bizContext += memContext;
      } catch (e) { console.warn("[nickActions:operator] memory context load failed:", e); }

      // Inject customer intelligence + action plan
      let customerBrief = "";
      try {
        const { getCustomerBrief, getCustomerActionPlan } = await import("../../services/customerIntelligence");
        const [brief, plan] = await Promise.all([getCustomerBrief(), getCustomerActionPlan()]);
        customerBrief = brief + plan;
      } catch (e) { console.warn("[nickActions:operator] customer intelligence load failed:", e); }

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
      } catch (e) { console.warn("[nickActions:operator] intelligence data load failed:", e); }

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
      } catch (e) { console.warn("[nickActions:operator] declined work data load failed:", e); }

      // Inject staff performance
      try {
        const { getTeamPerformance } = await import("../../services/staffPerformance");
        const team = await getTeamPerformance();
        if (team.techs && team.techs.length > 0) {
          bizContext += `\nTEAM: ${team.techs.length} techs. Jobs: ${team.teamTotals?.totalJobs ?? 0}. QC pass rate: ${team.teamTotals?.avgQcPassRate ?? "N/A"}%. Comeback rate: ${team.teamTotals?.avgComebackRate ?? "N/A"}%.`;
        }
      } catch (e) { console.warn("[nickActions:operator] staff performance load failed:", e); }

      // Inject feedback loop anomalies
      try {
        const { detectAnomalies } = await import("../../services/feedbackLoop");
        const anomalies = detectAnomalies();
        if (anomalies.length > 0) {
          bizContext += `\nANOMALIES: ${anomalies.map(a => `${a.type}: ${a.current} (avg ${a.average}/hr) ${a.deviation}`).join(" | ")}`;
        }
      } catch (e) { console.warn("[nickActions:operator] anomaly detection load failed:", e); }

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
      } catch (e) { console.warn("[nickActions:operator] proactive memory alerts load failed:", e); }

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
  ).catch(e => console.warn("[nickActions:operator] interaction learning failed:", e));

  // Track what Nour asks about
  import("../../services/nickMemory").then(({ trackQuestion }) => {
    const words = input.command.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    const topic = words.slice(0, 3).join(" ");
    if (topic) trackQuestion(topic);
  }).catch(e => console.warn("[nickActions:operator] question tracking failed:", e));

  // Track brief engagement
  import("../../services/feedbackLoop").then(({ recordBriefResponse }) =>
    recordBriefResponse()
  ).catch(e => console.warn("[nickActions:operator] brief response tracking failed:", e));

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
    } catch (e) { console.warn("[nickActions:operator] self-critique scoring failed:", e); }
  }).catch(e => console.warn("[nickActions:operator] self-critique LLM call failed:", e));

  return {
    reply,
    timestamp: new Date().toISOString(),
    tokensUsed: response.usage?.total_tokens ?? 0,
  };
}

// ─── Pull insights from statenour brain ──────────────

export async function handlePullFromStatenour() {
  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
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
      `CREATE TABLE IF NOT EXISTS chat_analytics (id int AUTO_INCREMENT PRIMARY KEY, sessionId int, hourOfDay int NOT NULL, dayOfWeek int NOT NULL, month int NOT NULL, messageCount int NOT NULL DEFAULT 0, converted int NOT NULL DEFAULT 0, leadScore int, duration int, createdAt timestamp NOT NULL DEFAULT (now()))`,
      `CREATE TABLE IF NOT EXISTS review_pipeline (id int AUTO_INCREMENT PRIMARY KEY, authorName varchar(255) NOT NULL, rating int NOT NULL, reviewText text, reviewTime int, relativeTime varchar(100), sentiment varchar(20), topicsJson text, keywordsJson text, urgency varchar(20), suggestedResponse text, status varchar(20) DEFAULT 'pending', createdAt timestamp NOT NULL DEFAULT (now()))`,
      `CREATE TABLE IF NOT EXISTS search_performance (id int AUTO_INCREMENT PRIMARY KEY, query varchar(500) NOT NULL, page varchar(500), clicks int DEFAULT 0, impressions int DEFAULT 0, ctr int DEFAULT 0, position int DEFAULT 0, date date, createdAt timestamp NOT NULL DEFAULT (now()))`,
      `CREATE TABLE IF NOT EXISTS pipeline_runs (id int AUTO_INCREMENT PRIMARY KEY, pipelineName varchar(100) NOT NULL, status varchar(20) NOT NULL, startedAt timestamp NOT NULL DEFAULT (now()), completedAt timestamp, durationMs int, resultJson text, error text)`,
      `CREATE TABLE IF NOT EXISTS daily_execution (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, mission TEXT, notes TEXT, status ENUM('on_track','drifting','off_track') NOT NULL DEFAULT 'on_track', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY idx_daily_date (date))`,
      `CREATE TABLE IF NOT EXISTS daily_habits (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, habit_key VARCHAR(50) NOT NULL, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY idx_habit_date_key (date, habit_key))`,
      `CREATE TABLE IF NOT EXISTS conversation_memory (id INT AUTO_INCREMENT PRIMARY KEY, visitorKey VARCHAR(255) NOT NULL, category VARCHAR(50) NOT NULL, content TEXT NOT NULL, sessionId INT NULL, confidence FLOAT NOT NULL DEFAULT 0.8, reinforcements INT NOT NULL DEFAULT 1, lastAccessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
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
        const msg = (err as Error)?.message || String(err);
        if (msg.includes("already exists") || msg.includes("Duplicate")) {
          skipped++;
        } else {
          skipped++;
          errors.push(`${rawSql.slice(0, 50)}... \u2192 ${msg.slice(0, 100)}`);
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
        console.warn("[routers/nickActions] operation failed:", e);
        for (const c of batch) {
          try { await d.insert(customers).values(c); imported++; } catch (e) { console.warn("[routers/nickActions] single customer insert failed:", e); skipped++; }
        }
      }
    }

    return { success: true, imported, skipped, total: rows.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

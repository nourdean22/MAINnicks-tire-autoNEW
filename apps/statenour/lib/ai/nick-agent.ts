/**
 * Nick Agent Layer — Structured Action Middleware
 *
 * Nick AI suggests actions in structured JSON format.
 * This layer parses those actions and executes them against
 * the real system (Prisma, APIs, crons, memory).
 *
 * This is provider-agnostic — works with Venice, Anthropic, or any LLM.
 * No tool-calling API needed. Nick outputs JSON action blocks,
 * the agent layer executes them.
 *
 * Action Types:
 * - task.create / task.complete / task.update
 * - loop.create / loop.close
 * - commitment.create / commitment.update
 * - decision.log
 * - score.log
 * - alert.resolve
 * - memory.remember / memory.forget
 * - simulation.run
 * - person.update
 * - habit.toggle
 */

import { prisma } from "@/lib/prisma";
import { createTaskAndEnrich, liftGoalOnTaskComplete } from "@/lib/services/tasks";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import { recordError } from "@/lib/errors/record-error";
import { brainMemory } from "@/lib/brain/memory-manager";
import { runSimulation } from "@/lib/brain/thinking-engine";
import { feedbackLoop } from "@/lib/brain/pipeline-controller";
import { today } from "@/lib/utils/datetime";

export interface AgentAction {
  type: string;
  params: Record<string, unknown>;
}

export interface ActionResult {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Parse agent actions from Nick AI response text.
 * Nick embeds actions in ```action blocks or JSON arrays.
 */
export function parseActions(text: string): AgentAction[] {
  const actions: AgentAction[] = [];

  // Pattern 1: ```action JSON blocks
  const blockPattern = /```action\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) actions.push(...parsed);
      else if (parsed.type) actions.push(parsed);
    } catch { /* skip malformed blocks */ }
  }

  // Pattern 2: Inline [ACTION: {...}] markers
  const inlinePattern = /\[ACTION:\s*(\{[\s\S]*?\})\]/g;
  while ((match = inlinePattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type) actions.push(parsed);
    } catch { /* skip */ }
  }

  return actions;
}

/**
 * Execute a single agent action against the system.
 */
async function executeAction(action: AgentAction): Promise<ActionResult> {
  const { type, params } = action;

  try {
    // Apr 18: OpenLoop retired → task + loop cases all write Task
    // INBOX rows against the m-inbox mission.
    const priorityFor = (p: unknown): number =>
      p === "critical" ? 5 : p === "high" ? 15 : p === "low" ? 60 : 30;

    switch (type) {
      case "task.create":
      case "loop.create": {
        const task = await createTaskAndEnrich({
          title: String(params.title || "Untitled task"),
          missionId: "m-inbox",
          status: "INBOX",
          nextPhysicalAction: String(params.title || "Untitled task"),
          effort: "M15",
          roiScore: 50,
          frictionScore: 50,
          energyRequired: "MEDIUM",
          context: "ANYWHERE",
          finishCondition: params.description ? String(params.description) : "done when complete",
          autoPriority: priorityFor(params.priority),
          autoPriorityExplanation: `from nick-agent (${type})${params.domain ? ` · ${params.domain}` : ""}`,
          lastTouchedAt: new Date(),
        });
        return { action: type, success: true, result: { id: task.id, title: task.title } };
      }

      case "task.complete":
      case "loop.close": {
        const id = String(params.id);
        const task = await prisma.task.update({
          where: { id },
          data: {
            status: "DONE",
            lastCompletedAt: new Date(),
            lastTouchedAt: new Date(),
            autoPriorityExplanation:
              type === "loop.close" && params.reason
                ? `closed: ${String(params.reason)}`
                : "completed via nick agent",
          },
        });
        // 2026-06-01 · credit character-sheet stat XP + lift the linked goal
        // (this action path bypasses checkTask/updateTask). Idempotent.
        void creditTaskStats(id);
        if (task.goalId) void liftGoalOnTaskComplete(task.goalId, id);
        return { action: type, success: true, result: { id: task.id, title: task.title } };
      }

      // ── Commitments ────────────────────────────
      case "commitment.create": {
        const commitment = await prisma.commitment.create({
          data: {
            dateMade: today(),
            description: String(params.description || "New commitment"),
            toWhom: params.toWhom ? String(params.toWhom) : "self",
            domain: params.domain ? String(params.domain) : null,
            deadline: params.deadline ? String(params.deadline) : null,
          },
        });
        return { action: type, success: true, result: { id: commitment.id } };
      }

      case "commitment.update": {
        const commitment = await prisma.commitment.update({
          where: { id: Number(params.id) },
          data: {
            ...(params.status ? { status: String(params.status) } : {}),
            ...(params.notes ? { notes: String(params.notes) } : {}),
          },
        });
        return { action: type, success: true, result: { id: commitment.id } };
      }

      // ── Decisions ──────────────────────────────
      case "decision.log": {
        const decision = await prisma.masteryDecision.create({
          data: {
            date: today(),
            title: String(params.title || "Decision"),
            context: params.context ? String(params.context) : null,
            optionsConsidered: params.options ? String(params.options) : null,
            chosen: params.chosen ? String(params.chosen) : null,
            reasoning: params.reasoning ? String(params.reasoning) : null,
            stakes: params.stakes ? String(params.stakes) : "medium",
          },
        });
        return { action: type, success: true, result: { id: decision.id } };
      }

      // ── Alerts ─────────────────────────────────
      case "alert.resolve": {
        const alert = await prisma.driftAlert.update({
          where: { id: Number(params.id) },
          data: { resolved: true },
        });
        return { action: type, success: true, result: { id: alert.id } };
      }

      // ── Memory ─────────────────────────────────
      case "memory.remember": {
        const mem = await brainMemory.remember(
          String(params.category || "insight"),
          String(params.key || `nick_${Date.now()}`),
          String(params.content || ""),
          "nick_agent",
        );
        return { action: type, success: true, result: { id: mem.id } };
      }

      case "memory.forget": {
        await brainMemory.forget(String(params.id));
        return { action: type, success: true, result: { deleted: true } };
      }

      // ── Habits ─────────────────────────────────
      case "habit.toggle": {
        // v10.0.59 · Wave A part 2 · Pre-fix dead Promise.resolve
        // placeholders for the retired HabitLog table. Habits now
        // live as DAILY-loop Tasks; toggling a habit means flipping
        // the matching task's lastCompletedAt + bumping streakCount.
        const habitKey = String(params.habitKey || "").trim();
        if (!habitKey) {
          return { action: type, success: false, error: "habitKey required" };
        }
        const task = await prisma.task.findFirst({
          where: {
            loopKind: "DAILY",
            deletedAt: null,
            title: { equals: habitKey, mode: "insensitive" },
          },
          select: { id: true, streakCount: true, lastCompletedAt: true },
        });
        if (!task) {
          // Task model has many required fields (missionId,
          // nextPhysicalAction, effort, roiScore, frictionScore,
          // energyRequired, context, finishCondition) which can't
          // be inferred from a habit toggle. Surface a clear error
          // rather than silently dropping or pretending success.
          // Operator creates DAILY tasks via /tasks UI which has
          // the proper form.
          return {
            action: type,
            success: false,
            error: `No DAILY task with title "${habitKey}". Create it on /tasks first; the toggle will work after.`,
          };
        }
        // Toggle: if completed today, un-complete; otherwise complete.
        const todayStartET = new Date(
          new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) +
            "T00:00:00",
        );
        const completedToday =
          task.lastCompletedAt && task.lastCompletedAt >= todayStartET;
        await prisma.task.update({
          where: { id: task.id },
          data: completedToday
            ? {
                streakCount: { decrement: 1 },
                lastCompletedAt: null,
                lastTouchedAt: new Date(),
              }
            : {
                streakCount: { increment: 1 },
                lastCompletedAt: new Date(),
                lastTouchedAt: new Date(),
              },
        });
        return {
          action: type,
          success: true,
          result: {
            habitKey,
            taskId: task.id,
            action: completedToday ? "uncompleted" : "completed",
            streakDelta: completedToday ? -1 : 1,
          },
        };
      }

      // ── Simulation ─────────────────────────────
      case "simulation.run": {
        const sim = await runSimulation(String(params.scenario || ""));
        return { action: type, success: !!sim, result: sim };
      }

      // ── People ─────────────────────────────────
      case "person.update": {
        // 2026-05-27 · routed through fuzzy resolver (lib/brain/person-profile-fuzzy)
        // to prevent typo dupes. If the AI types "Danai" but operator already
        // has "Dania", the resolver finds the existing row via Levenshtein
        // ≤1 instead of creating a ghost.
        const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
        const resolution = await resolvePersonByName(String(params.name), {
          role: String(params.role || "unknown"),
          relationship: String(params.relationship || ""),
          trustScore: Number(params.trustScore ?? 0.5),
        });
        // Apply any explicit field updates from the tool call · matched or created.
        if (resolution.matched) {
          await prisma.personProfile.update({
            where: { id: resolution.person.id },
            data: {
              ...(params.role ? { role: String(params.role) } : {}),
              ...(params.relationship ? { relationship: String(params.relationship) } : {}),
              ...(params.trustScore != null ? { trustScore: Number(params.trustScore) } : {}),
              ...(params.leverageNotes ? { leverageNotes: String(params.leverageNotes) } : {}),
              interactionCount: { increment: 1 },
              lastInteraction: new Date(),
            },
          });
        } else if (params.leverageNotes) {
          // Created path · resolvePersonByName doesn't accept leverageNotes · set if provided.
          await prisma.personProfile.update({
            where: { id: resolution.person.id },
            data: { leverageNotes: String(params.leverageNotes) },
          });
        }
        return { action: type, success: true, result: { id: resolution.person.id, name: resolution.person.name, matched: resolution.matched, matchTier: resolution.matchTier } };
      }

      // ═══════════════════════════════════════════
      // CROSS-SYSTEM: nickstire.org actions via tRPC
      // ═══════════════════════════════════════════

      case "shop.getLabor": {
        const res = await callNickstire("autoLabor.estimate", { service: String(params.service || ""), vehicleYear: params.year ? Number(params.year) : undefined, vehicleMake: params.make ? String(params.make) : undefined, vehicleModel: params.model ? String(params.model) : undefined });
        return { action: type, success: !!res, result: res };
      }

      case "shop.getLeads": {
        const res = await callNickstire("lead.list", { limit: Number(params.limit ?? 10) });
        return { action: type, success: !!res, result: res };
      }

      case "shop.updateLead": {
        const res = await callNickstire("lead.update", { id: Number(params.id), status: params.status ? String(params.status) : undefined, notes: params.notes ? String(params.notes) : undefined });
        return { action: type, success: !!res, result: res };
      }

      case "shop.getEstimates": {
        const res = await callNickstire("estimates.list", { limit: Number(params.limit ?? 10) });
        return { action: type, success: !!res, result: res };
      }

      case "shop.getCustomers": {
        const res = await callNickstire("customers.list", { limit: Number(params.limit ?? 10), search: params.search ? String(params.search) : undefined });
        return { action: type, success: !!res, result: res };
      }

      case "shop.sendSms": {
        const res = await callNickstire("smsBot.send", { phone: String(params.phone || ""), message: String(params.message || "") });
        return { action: type, success: !!res, result: res };
      }

      case "shop.getBookings": {
        const res = await callNickstire("booking.list", { limit: Number(params.limit ?? 10) });
        return { action: type, success: !!res, result: res };
      }

      case "shop.shopStatus": {
        const res = await callNickstire("shopStatus.current", {});
        return { action: type, success: !!res, result: res };
      }

      case "shop.getRevenue": {
        const res = await callNickstire("controlCenter.revenue", { period: String(params.period || "today") });
        return { action: type, success: !!res, result: res };
      }

      // ── System Operator Commands (God-Mode) ──────
      case "system.health": {
        const [dbOk, memCount, alertCount, syncAge] = await Promise.all([
          prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
          prisma.brainMemory.count(),
          prisma.driftAlert.count({ where: { acknowledged: false } }),
          prisma.auditEvent.findFirst({ where: { eventType: "business_metrics_sync" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        ]);
        const syncMinutes = syncAge?.createdAt ? Math.floor((Date.now() - syncAge.createdAt.getTime()) / 60000) : -1;
        return { action: type, success: true, result: {
          database: dbOk ? "UP" : "DOWN",
          brainMemories: memCount,
          unackedAlerts: alertCount,
          lastSyncMinutesAgo: syncMinutes,
          nodeVersion: process.version,
          uptime: Math.floor(process.uptime()),
        }};
      }

      case "system.brainStats": {
        const [total, byCategory, avgConf, recentInsights] = await Promise.all([
          prisma.brainMemory.count(),
          prisma.brainMemory.groupBy({ by: ["category"], _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 10 }),
          prisma.brainMemory.aggregate({ _avg: { confidence: true } }),
          prisma.auditEvent.findMany({ where: { eventType: "brain_insight" }, orderBy: { createdAt: "desc" }, take: 5, select: { detail: true, createdAt: true } }),
        ]);
        return { action: type, success: true, result: {
          totalMemories: total,
          avgConfidence: (avgConf._avg.confidence ?? 0).toFixed(2),
          byCategory: byCategory.map(c => ({ category: c.category, count: c._count.id })),
          recentInsights: recentInsights.map(i => ({ insight: i.detail, when: i.createdAt })),
        }};
      }

      case "system.syncNow": {
        // Trigger immediate cross-site sync
        const { runBrainCycle } = await import("@/lib/brain/pipeline-controller");
        const result = await runBrainCycle();
        return { action: type, success: result.synced, result: {
          alerts: result.alerts.length,
          patterns: result.patterns.length,
          message: `Brain cycle complete: ${result.alerts.length} alerts, ${result.patterns.length} patterns detected`,
        }};
      }

      case "system.deepScan": {
        // Run the full deep scan pipeline — comprehensive analysis
        const { runDeepScan } = await import("@/lib/brain/deep-scan");
        const scanResult = await runDeepScan();
        return { action: type, success: true, result: {
          duration: `${scanResult.duration}ms`,
          dataPointsAnalyzed: scanResult.metrics.dataPointsAnalyzed,
          findings: scanResult.findings.length,
          patternsFound: scanResult.metrics.patternsFound,
          anomaliesDetected: scanResult.metrics.anomaliesDetected,
          recommendations: scanResult.metrics.recommendationsGenerated,
          details: scanResult.findings.map(f => `[${f.severity.toUpperCase()}] ${f.title}: ${f.detail}${f.recommendation ? ` → ${f.recommendation}` : ""}`),
        }};
      }

      case "system.clearAlerts": {
        const updated = await prisma.driftAlert.updateMany({
          where: { acknowledged: false },
          data: { acknowledged: true },
        });
        return { action: type, success: true, result: { cleared: updated.count } };
      }

      case "system.pagePatterns": {
        const visits = await prisma.auditEvent.findMany({
          where: { eventType: "page_visit", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
          select: { detail: true },
          take: 500,
        });
        const counts: Record<string, number> = {};
        for (const v of visits) { counts[v.detail || "?"] = (counts[v.detail || "?"] || 0) + 1; }
        const sorted = Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 10);
        return { action: type, success: true, result: {
          totalVisits: visits.length,
          topPages: sorted.map(([page, count]) => ({ page, count })),
        }};
      }

      // ═══════════════════════════════════════════
      // ARSENAL: Integration chains + tools
      // ═══════════════════════════════════════════

      case "arsenal.research": {
        // AI-powered research using Grok (xAI) real-time analysis
        const { analyzeRealTime } = await import("@/lib/integrations/grok");
        const result = await analyzeRealTime(String(params.query || ""));
        return { action: type, success: !!result, result: { content: result?.content?.slice(0, 2000) } };
      }

      case "arsenal.gmailInbox": {
        // v10.0.379 · Gmail inbox triage · per /gmail-automation skill.
        // Returns recent threads with subject/from/snippet so Nick can
        // surface what needs attention. Configured via GMAIL_REFRESH_TOKEN
        // env (one-time OAuth · see docs/gmail-setup.md).
        const { listInbox, isGmailConfigured } = await import("@/lib/integrations/gmail");
        if (!isGmailConfigured()) {
          return {
            action: type,
            success: false,
            result: { error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md" },
          };
        }
        const threads = await listInbox({
          maxResults: typeof params.maxResults === "number" ? params.maxResults : 20,
          query: typeof params.query === "string" ? params.query : undefined,
        });
        return {
          action: type,
          success: true,
          result: {
            threadCount: threads.length,
            threads: threads.slice(0, 30).map((t) => ({
              id: t.id,
              subject: t.subject.slice(0, 200),
              from: t.from.slice(0, 200),
              snippet: t.snippet.slice(0, 300),
              messageCount: t.messageCount,
              unread: t.unread,
              date: new Date(t.internalDate).toISOString(),
            })),
          },
        };
      }

      case "arsenal.gmailReadThread": {
        const { getThread, isGmailConfigured } = await import("@/lib/integrations/gmail");
        if (!isGmailConfigured()) {
          return {
            action: type,
            success: false,
            result: { error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md" },
          };
        }
        const thread = await getThread(String(params.threadId || ""));
        return {
          action: type,
          success: !!thread.id,
          result: {
            id: thread.id,
            subject: thread.subject.slice(0, 200),
            messageCount: thread.messages.length,
            messages: thread.messages.map((m) => ({
              id: m.id,
              from: m.from.slice(0, 200),
              to: m.to.slice(0, 200),
              date: m.date,
              body: m.body.slice(0, 4000),
              snippet: m.snippet.slice(0, 300),
            })),
          },
        };
      }

      case "arsenal.multiAgent": {
        // v10.0.374 · spawn N sub-agents in parallel · synthesize
        // Use for tasks that decompose naturally: 'compare 3 competitors',
        // 'audit voice across {posts, emails, scripts}', 'draft 3 angles'
        const { runMultiAgent } = await import("@/lib/ai/multi-agent-orchestrator");
        const goal = String(params.goal || "");
        const subAgents = Array.isArray(params.subAgents)
          ? (params.subAgents as Array<{ name?: string; task?: string; outputHint?: string }>)
              .map((s, i) => ({
                name: typeof s?.name === "string" ? s.name : `agent_${i + 1}`,
                task: typeof s?.task === "string" ? s.task : "",
                outputHint: typeof s?.outputHint === "string" ? s.outputHint : undefined,
              }))
              .filter((s) => s.task.length > 0)
          : [];
        const report = await runMultiAgent({ goal, subAgents });
        return {
          action: type,
          success: !!report.synthesis,
          result: {
            goal: report.goal,
            agentCount: report.results.length,
            synthesis: report.synthesis.slice(0, 4000),
            results: report.results.map((r) => ({
              name: r.name,
              output: r.output.slice(0, 800),
              failed: r.failed ?? false,
              durationMs: r.durationMs,
            })),
            costEstimateUsd: report.costEstimateUsd,
            totalDurationMs: report.totalDurationMs,
          },
        };
      }

      case "arsenal.deepResearch": {
        // v10.0.373 · multi-round autonomous research · per /deep-research
        // skill. Plan → Search × N → Synthesize. Use for due diligence,
        // competitive analysis, lit review. ~3-5 Perplexity searches +
        // 2 gpt-4o-mini calls + ~10-15s · NOT cheap, use sparingly.
        const { runDeepResearch } = await import("@/lib/ai/deep-research");
        const report = await runDeepResearch({
          question: String(params.question || ""),
        });
        return {
          action: type,
          success: !!report.synthesis,
          result: {
            plan: report.plan,
            roundCount: report.rounds.length,
            synthesis: report.synthesis.slice(0, 4000),
            citations: report.allCitations.slice(0, 20),
            durationMs: report.durationMs,
          },
        };
      }

      case "arsenal.preTaskFanout": {
        // v10.0.372 · pre-task multi-lens fan-out · per /task-intelligence.
        // Use for HARD QUESTIONS · decisions, strategy, trade-offs.
        // Runs 3 parallel lenses (research / risk / plan) and returns
        // a composite block to ground Nick's eventual reply.
        // Cost: ~3x gpt-4o-mini calls, ~2s parallel · expensive · don't
        // use on simple lookups.
        const { runFanout } = await import("@/lib/ai/pretask-fanout");
        const fanout = await runFanout({
          question: String(params.question || ""),
          brainContext: typeof params.brainContext === "string"
            ? params.brainContext
            : undefined,
        });
        return {
          action: type,
          success: !!fanout.composite,
          result: {
            research: fanout.research.slice(0, 1000),
            risk: fanout.risk.slice(0, 1000),
            plan: fanout.plan.slice(0, 1000),
            composite: fanout.composite.slice(0, 3000),
            durationMs: fanout.durationMs,
          },
        };
      }

      case "arsenal.webSearch": {
        // v10.0.358 · web search via Perplexity with structured options
        // and citations · per /search-specialist principles. Guardian-
        // wrapped at the perplexity helper level for auto-retry.
        const { smartWebSearch } = await import("@/lib/integrations/perplexity");
        const result = await smartWebSearch({
          query: String(params.query || ""),
          recency: (params.recency as "day" | "week" | "month" | "year" | undefined) ?? undefined,
          allowedDomains: Array.isArray(params.allowedDomains) ? (params.allowedDomains as string[]) : undefined,
          blockedDomains: Array.isArray(params.blockedDomains) ? (params.blockedDomains as string[]) : undefined,
          tier: (params.tier as "sonar" | "sonar-pro" | "sonar-reasoning" | undefined) ?? undefined,
        });
        return {
          action: type,
          success: !!result,
          result: {
            content: result?.content?.slice(0, 2000) ?? "",
            citations: (result?.citations ?? []).slice(0, 8).map((c) => c.url),
            model: result?.model,
          },
        };
      }

      case "arsenal.findLeads": {
        // Apollo.io fleet contact search
        const { searchFleetContacts } = await import("@/lib/integrations/apollo");
        const result = await searchFleetContacts({
          titles: params.titles ? (params.titles as string[]) : undefined,
          locations: params.locations ? (params.locations as string[]) : ["Cleveland", "Ohio"],
          industries: params.industries ? (params.industries as string[]) : undefined,
          limit: params.limit ? Number(params.limit) : 10,
        });
        return { action: type, success: !!result, result: {
          count: result?.contacts?.length ?? 0,
          contacts: result?.contacts?.slice(0, 5).map((c: any) => `${c.firstName} ${c.lastName} — ${c.title} at ${c.company}`),
        }};
      }

      case "arsenal.newLeadChain": {
        // Full chain: Apollo → Grok → ClickUp
        const { newLeadChain } = await import("@/lib/integrations/chain");
        const result = await newLeadChain({
          titles: params.titles ? (params.titles as string[]) : ["Fleet Manager", "Operations Manager"],
          locations: params.locations ? (params.locations as string[]) : ["Cleveland", "Ohio"],
          industries: params.industries ? (params.industries as string[]) : undefined,
          limit: params.limit ? Number(params.limit) : 10,
          clickupListId: String(params.clickupListId || process.env.CLICKUP_DEFAULT_LIST_ID || ""),
        });
        return { action: type, success: result.status !== "failed", result: {
          status: result.status,
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
        }};
      }

      case "arsenal.reviewResponse": {
        // Chain: Grok drafts review response → ClickUp approval task
        const { reviewResponseChain } = await import("@/lib/integrations/chain");
        const result = await reviewResponseChain({
          reviewerName: String(params.reviewerName || "Customer"),
          rating: Number(params.rating ?? 5),
          reviewText: String(params.reviewText || ""),
          platform: String(params.platform || "Google"),
          clickupListId: String(params.clickupListId || process.env.CLICKUP_DEFAULT_LIST_ID || ""),
        });
        return { action: type, success: result.status !== "failed", result: {
          status: result.status,
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
          draftResponse: result.steps.find(s => s.step === "grok_draft_response")?.data,
        }};
      }

      case "arsenal.competitorInsight": {
        // Chain: Grok analyzes competitor → ClickUp action items
        const { competitorInsightChain } = await import("@/lib/integrations/chain");
        const result = await competitorInsightChain({
          competitorName: String(params.competitorName || ""),
          competitorDetails: params.details ? String(params.details) : undefined,
          clickupListId: String(params.clickupListId || process.env.CLICKUP_DEFAULT_LIST_ID || ""),
        });
        return { action: type, success: result.status !== "failed", result: {
          status: result.status,
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
        }};
      }

      case "arsenal.dailyBrief": {
        // Chain: Grok generates brief + priorities → ClickUp tomorrow's tasks
        const { dailyBriefChain } = await import("@/lib/integrations/chain");
        const result = await dailyBriefChain({
          todaySummary: String(params.summary || "End of day brief requested."),
          clickupListId: String(params.clickupListId || process.env.CLICKUP_DEFAULT_LIST_ID || ""),
        });
        return { action: type, success: result.status !== "failed", result: {
          status: result.status,
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
        }};
      }

      case "arsenal.getMeetings": {
        // Fireflies — fetch recent meeting transcripts
        const { getRecentTranscripts } = await import("@/lib/integrations/fireflies");
        const result = await getRecentTranscripts(Number(params.limit ?? 5));
        return { action: type, success: !!result, result };
      }

      // ═══════════════════════════════════════════
      // CAMERA: Direct camera system actions
      // ═══════════════════════════════════════════

      // ═══ MEMORY SEARCH (text-parsing fallback for Venice/Ollama) ═══
      case "memory.search": {
        const where: any = {
          confidence: { gte: Number(params.minConfidence ?? 0.3) },
          OR: [
            { content: { contains: String(params.query || ""), mode: "insensitive" } },
            { key: { contains: String(params.query || ""), mode: "insensitive" } },
          ],
        };
        if (params.category) where.category = String(params.category);
        const memories = await prisma.brainMemory.findMany({
          where, orderBy: { confidence: "desc" }, take: Number(params.limit ?? 10),
          select: { id: true, category: true, key: true, content: true, confidence: true, source: true },
        });
        return { action: type, success: true, result: { count: memories.length, memories } };
      }

      // ═══ TELEGRAM PUSH ═══
      case "telegram.send": {
        const { sendTelegram, formatTelegramNotification } = await import("@/lib/services/telegram");
        const urgency = String(params.urgency || "medium");
        const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
        const msg = params.title
          ? formatTelegramNotification(String(params.title), `${prefix} ${String(params.message || "")}`)
          : `${prefix} ${String(params.message || "")}`;
        const sent = await sendTelegram(msg);
        return { action: type, success: sent, result: { sent, urgency } };
      }

      // ═══ MISSION PLANNING ═══
      case "mission.plan": {
        const tasks = Array.isArray(params.tasks) ? params.tasks : [];
        const domainMap: Record<string, string> = { business: "BUSINESS", personal: "PERSONAL", health: "HEALTH", content: "CONTENT", finance: "FINANCE" };
        const domain = domainMap[String(params.domain || "business").toLowerCase()] || "BUSINESS";
        const prio = Number(params.priority ?? 50);
        const mission = await prisma.mission.create({
          data: {
            title: String(params.title || "New Mission"),
            domain: domain as any,
            priority: prio,
            roiScore: prio,
            neglectCost: Math.round(prio * 0.7),
            successMetric: params.successMetric ? String(params.successMetric) : null,
            status: "ACTIVE",
          },
        });
        const createdTasks = [];
        for (let i = 0; i < tasks.length; i++) {
          const t: any = tasks[i];
          const task = await createTaskAndEnrich({
            title: String(t.title || `Task ${i + 1}`),
            missionId: mission.id,
            nextPhysicalAction: String(t.nextPhysicalAction || t.title || "Define next step"),
            effort: (t.effort || "M30") as any,
            context: (t.context || "ANYWHERE") as any,
            finishCondition: String(t.title || `Task ${i + 1}`),
            roiScore: Math.max(10, 90 - i * 10),
            frictionScore: 30,
            energyRequired: "MEDIUM",
          });
          createdTasks.push(task);
        }
        return { action: type, success: true, result: {
          missionId: mission.id, title: mission.title, taskCount: createdTasks.length,
          tasks: createdTasks.map(t => ({ id: t.id, title: t.title })),
        }};
      }

      case "camera.getIntelligence": {
        const { getCameraIntelligence } = await import("@/lib/brain/camera-intelligence");
        const intel = await getCameraIntelligence();
        return { action: type, success: true, result: intel };
      }

      case "camera.resolveAlert": {
        // v10.0.59 · Wave A part 2 · Camera alerts now persisted as
        // BrainMemory category="camera_alert" by v10.0.55 camera-
        // intelligence rewrite. Resolve = soft-delete the row.
        const alertKey = String(params.alertKey || "").trim();
        if (!alertKey) {
          return { action: type, success: false, error: "alertKey required" };
        }
        await prisma.brainMemory
          .updateMany({
            where: {
              category: "camera_alert",
              key: alertKey,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          })
          .catch(() => undefined);
        return { action: type, success: true, result: { resolved: true, alertKey } };
      }

      case "camera.getAlerts": {
        // v10.0.59 · sourced from BrainMemory category="camera_alert".
        const alertRows = await prisma.brainMemory
          .findMany({
            where: { category: "camera_alert", deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { key: true, content: true, createdAt: true },
          })
          .catch((): Array<{ key: string; content: string; createdAt: Date }> => []);
        return {
          action: type,
          success: true,
          result: { count: alertRows.length, alerts: alertRows },
        };
      }

      case "camera.getPlates": {
        // v10.0.59 · ALPR (license-plate recognition) not yet wired
        // into the deviceEvent pipeline. Returns empty + redirect
        // message; future v11+ work will add a `vehicle_detected`
        // event subtype with a `plate` field in the payload.
        return {
          action: type,
          success: true,
          result: {
            count: 0,
            plates: [],
            note: "ALPR pipeline not yet wired — vehicle_detected events lack plate metadata.",
          },
        };
      }

      default:
        return { action: type, success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { action: type, success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ─── Cross-System HTTP Client ────────────────────────────

const NICKSTIRE_API = process.env.NICKS_ADMIN_URL || "https://nickstire.org";
// v9.1.14 · type as `string | undefined` instead of `?? ""`. The
// previous `|| ""` pattern was caught by the env-secret bypass gate.
// Outbound calls now no-op cleanly if neither key is configured —
// safer than sending a Bearer "" header that nickstire rejects with
// a generic 401.
const BRIDGE_KEY = process.env.BRIDGE_API_KEY ?? process.env.STATENOUR_SYNC_KEY;

async function callNickstire(procedure: string, input: Record<string, unknown>): Promise<unknown> {
  if (!BRIDGE_KEY) {
    return {
      error: "BRIDGE_API_KEY (or STATENOUR_SYNC_KEY) not configured — outbound nickstire call skipped",
    };
  }
  try {
    const url = `${NICKSTIRE_API}/trpc/${procedure}`;
    const isQuery = !procedure.includes("send") && !procedure.includes("update") && !procedure.includes("create");

    if (isQuery) {
      const queryInput = encodeURIComponent(JSON.stringify({ json: input }));
      const res = await fetch(`${url}?input=${queryInput}`, {
        headers: { Authorization: `Bearer ${BRIDGE_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `${res.status} ${res.statusText}` };
      return await res.json();
    } else {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${BRIDGE_KEY}` },
        body: JSON.stringify({ json: input }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `${res.status} ${res.statusText}` };
      return await res.json();
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "nickstire API call failed" };
  }
}

/**
 * Execute all parsed actions from Nick AI response.
 * Returns results for each action.
 */
export async function executeActions(actions: AgentAction[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions.slice(0, 10)) {
    const result = await executeAction(action);
    results.push(result);

    // Circular feedback: every action feeds back into the memory system
    feedbackLoop(action.type, result.result, JSON.stringify(action.params).slice(0, 200)).catch((err) =>
      recordError("ai:agent-feedback", err, { actionType: action.type }),
    );
  }
  return results;
}

/**
 * The action catalog — tells Nick what actions are available.
 * Injected into the system prompt so Nick knows what it can DO.
 */
export const ACTION_CATALOG = `
## Nick Agent Actions — You Can DO Things, Not Just Talk

When you want to take action, embed action blocks in your response:

\`\`\`action
{ "type": "task.create", "params": { "title": "Follow up on 3 oldest leads", "priority": 1, "domain": "business", "dueDate": "2026-04-02" } }
\`\`\`

Available actions:
| Action | Params | What It Does |
|--------|--------|-------------|
| task.create | title, description?, priority(1-10)?, domain?, dueDate? | Create a task |
| task.complete | id | Mark task done |
| loop.create | title, domain?, priority(1-5)? | Open a mental loop |
| loop.close | id | Close a loop |
| commitment.create | description, toWhom?, domain?, deadline? | Make a commitment |
| commitment.update | id, status?, notes? | Update commitment |
| decision.log | title, context?, options?, chosen?, reasoning?, stakes? | Log a decision |
| alert.resolve | id | Resolve a drift alert |
| memory.remember | category, key, content | Store a memory |
| memory.forget | id | Delete a memory |
| memory.search | query, category?, minConfidence?, limit? | Search brain memories by keyword |
| telegram.send | message, title?, urgency?(low/medium/high) | Send Nour a Telegram push notification |
| mission.plan | title, domain, priority?, successMetric?, tasks[{title, nextPhysicalAction, effort?, context?}] | Create a mission with multiple linked tasks |
| habit.toggle | habitKey (wake/exercise/business/order/shutdown) | Toggle today's habit |
| simulation.run | scenario | Run a what-if simulation |
| person.update | name, role?, relationship?, trustScore?, leverageNotes? | Update person profile |

### Shop Actions (cross-system — talks to nickstire.org)
| Action | Params | What It Does |
|--------|--------|-------------|
| shop.getLabor | service, year?, make?, model? | Get labor estimate from auto labor guide |
| shop.getLeads | limit? | Fetch open leads from the shop |
| shop.updateLead | id, status?, notes? | Update a lead (follow-up, close, etc) |
| shop.getEstimates | limit? | Fetch recent estimates/quotes |
| shop.getCustomers | limit?, search? | Search customer database |
| shop.sendSms | phone, message | Send SMS to a customer |
| shop.getBookings | limit? | Fetch upcoming bookings |
| shop.shopStatus | (none) | Get current shop status (open/closed, bays, queue) |
| shop.getRevenue | period? (today/week/month) | Get revenue numbers |

### Arsenal Actions (AI tools + automation chains)
| Action | Params | What It Does |
|--------|--------|-------------|
| arsenal.research | query | AI research using Grok/xAI — real-time analysis on any topic |
| arsenal.webSearch | query, recency?(day/week/month/year), allowedDomains?, blockedDomains?, tier?(sonar/sonar-pro/sonar-reasoning) | Web search via Perplexity — live internet data with citations. Use recency=day for breaking news, week for current events, month for industry shifts. Use allowedDomains=["wsj.com","bloomberg.com"] for authoritative finance, etc. tier=sonar-pro for deeper analysis. |
| arsenal.preTaskFanout | question, brainContext? | Pre-task multi-lens fan-out for HARD questions (decisions, strategy, trade-offs). Runs 3 parallel lenses (research info-needed / risk failure-modes / plan execution-sketch) and returns a composite analysis block to ground your eventual reply. Use ONLY for genuinely deep questions · costs ~3 gpt-4o-mini calls + ~2s · don't use on simple lookups. |
| arsenal.deepResearch | question | Multi-round autonomous research · plans 3-5 sub-queries, runs each via Perplexity in parallel, synthesizes a cited report (200-400 words with [N] markers + citation list). Use for due diligence, competitive analysis, lit review. ~3-5 searches + 10-15s · NOT cheap. Don't use unless the question genuinely needs cross-source synthesis. |
| arsenal.multiAgent | goal, subAgents[{name, task, outputHint?}] | Spawn N parallel sub-agents (max 8) · each tackles one focused sub-task · synthesizer composes one coherent answer. Use for tasks that decompose naturally: compare 3 competitors, audit voice across channels, draft 3 angles. ~5-8s wall time · ~$0.001-0.002/call. |
| arsenal.findLeads | titles?, locations?, industries?, limit? | Apollo.io fleet contact search — find potential customers |
| arsenal.newLeadChain | titles?, locations?, limit? | FULL CHAIN: Apollo finds leads → Grok analyzes → ClickUp task created |
| arsenal.reviewResponse | reviewerName, rating, reviewText, platform | CHAIN: Grok drafts review response → ClickUp approval task |
| arsenal.competitorInsight | competitorName, details? | CHAIN: Grok analyzes competitor → ClickUp action items |
| arsenal.dailyBrief | summary | CHAIN: Grok generates brief + tomorrow's priorities → ClickUp tasks |
| arsenal.getMeetings | limit? | Fireflies — fetch recent meeting transcripts |

### Camera System (surveillance + intelligence)
| Action | Params | What It Does |
|--------|--------|-------------|
| camera.getIntelligence | (none) | Full camera intel — today's traffic, alerts, bay utilization, 7-day avg |
| camera.resolveAlert | id | Resolve a camera alert (after-hours motion, long wait, etc) |
| camera.getAlerts | limit? | Get unresolved camera alerts |
| camera.getPlates | limit? | Get recent license plate logs (IN/OUT at shop) |

### System Operator Commands (God-Mode — real system access)
| Action | Params | What It Does |
|--------|--------|-------------|
| system.health | (none) | Full system health check — DB, brain, alerts, sync status, uptime |
| system.brainStats | (none) | Brain statistics — memory count, categories, confidence, recent insights |
| system.syncNow | (none) | Trigger immediate brain cycle — cross-reference all data sources |
| system.deepScan | (none) | Comprehensive analysis — scores, loops, commitments, memories, assessment |
| system.clearAlerts | (none) | Acknowledge all pending drift alerts |
| system.pagePatterns | (none) | Analyze which pages Nour visits and blind spots |

Rules:
1. ALWAYS take action when you can. Don't just suggest — DO.
2. Create tasks for action items. Close loops when resolved.
3. Log decisions with reasoning. Remember important facts.
4. You can embed multiple action blocks in one response.
5. After taking action, briefly confirm what you did.
6. Use system.health proactively — if asked about system status, RUN the check.
7. Run system.deepScan when asked for a full assessment or "how am I doing?"
8. Run system.syncNow after major events to keep the brain synchronized.
`;

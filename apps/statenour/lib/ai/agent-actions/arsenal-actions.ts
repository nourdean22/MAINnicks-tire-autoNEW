/**
 * Arsenal action handlers — AI tools + automation chains.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). Every case kept its inline dynamic import().
 */
import type { ActionParams, ActionResult } from "./types";

export async function handleArsenalResearch(params: ActionParams, type: string): Promise<ActionResult> {
  // AI-powered research using Grok (xAI) real-time analysis
  const { analyzeRealTime } = await import("@/lib/integrations/grok");
  const result = await analyzeRealTime(String(params.query || ""));
  return { action: type, success: !!result, result: { content: result?.content?.slice(0, 2000) } };
}

export async function handleArsenalGmailInbox(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalGmailReadThread(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalMultiAgent(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalDeepResearch(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalPreTaskFanout(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalWebSearch(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalFindLeads(params: ActionParams, type: string): Promise<ActionResult> {
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
    contacts: (result?.contacts ?? []).slice(0, 5).map((c: { firstName?: string; lastName?: string; title?: string; company?: string }) => `${c.firstName ?? ""} ${c.lastName ?? ""} — ${c.title ?? ""} at ${c.company ?? ""}`),
  }};
}

export async function handleArsenalNewLeadChain(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalReviewResponse(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalCompetitorInsight(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalDailyBrief(params: ActionParams, type: string): Promise<ActionResult> {
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

export async function handleArsenalGetMeetings(params: ActionParams, type: string): Promise<ActionResult> {
  // Fireflies — fetch recent meeting transcripts
  const { getRecentTranscripts } = await import("@/lib/integrations/fireflies");
  const result = await getRecentTranscripts(Number(params.limit ?? 5));
  return { action: type, success: !!result, result };
}

export async function handleArsenalRunPython(params: ActionParams, type: string): Promise<ActionResult> {
  const { runPython } = await import("@/lib/integrations/e2b");
  const code = String(params.code || "");
  if (!code) {
    return { action: type, success: false, error: "code parameter required" };
  }
  const result = await runPython(code);
  return { action: type, success: result.ok, result };
}

export async function handleArsenalBrowserCreateSession(params: ActionParams, type: string): Promise<ActionResult> {
  const { createSession } = await import("@/lib/integrations/browserbase");
  const keepAlive = params.keepAlive === true;
  const result = await createSession({ keepAlive });
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}

export async function handleArsenalBrowserCloseSession(params: ActionParams, type: string): Promise<ActionResult> {
  const { closeSession } = await import("@/lib/integrations/browserbase");
  const sessionId = String(params.sessionId || "");
  if (!sessionId) {
    return { action: type, success: false, error: "sessionId required" };
  }
  const result = await closeSession(sessionId);
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}

export async function handleArsenalBrowserNavigate(params: ActionParams, type: string): Promise<ActionResult> {
  const { navigate } = await import("@/lib/integrations/stagehand");
  const sessionId = String(params.sessionId || "");
  const url = String(params.url || "");
  const waitUntil = (params.waitUntil as "load" | "domcontentloaded" | "networkidle" | undefined) ?? "networkidle";
  
  if (!sessionId || !url) {
    return { action: type, success: false, error: "sessionId and url parameters required" };
  }
  const result = await navigate({ sessionId, url, waitUntil });
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}

export async function handleArsenalBrowserAct(params: ActionParams, type: string): Promise<ActionResult> {
  const { act } = await import("@/lib/integrations/stagehand");
  const sessionId = String(params.sessionId || "");
  const instruction = String(params.instruction || "");
  
  if (!sessionId || !instruction) {
    return { action: type, success: false, error: "sessionId and instruction parameters required" };
  }
  const result = await act({ sessionId, instruction });
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}

export async function handleArsenalBrowserExtract(params: ActionParams, type: string): Promise<ActionResult> {
  const { extract } = await import("@/lib/integrations/stagehand");
  const { z } = await import("zod");
  const sessionId = String(params.sessionId || "");
  const instruction = String(params.instruction || "");
  const keys = Array.isArray(params.keys) ? params.keys.map(String) : ["data"];

  if (!sessionId || !instruction) {
    return { action: type, success: false, error: "sessionId and instruction parameters required" };
  }

  // Construct dynamic zod schema
  const schemaObj: Record<string, import("zod").ZodTypeAny> = {};
  for (const key of keys) {
    schemaObj[key] = z.string().describe(`The extracted value for ${key}`);
  }
  const schema = z.object(schemaObj);

  const result = await extract({ sessionId, instruction, schema });
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}

export async function handleArsenalBrowserObserve(params: ActionParams, type: string): Promise<ActionResult> {
  const { observe } = await import("@/lib/integrations/stagehand");
  const sessionId = String(params.sessionId || "");
  const instruction = params.instruction ? String(params.instruction) : undefined;
  
  if (!sessionId) {
    return { action: type, success: false, error: "sessionId parameter required" };
  }
  const result = await observe({ sessionId, instruction });
  return { action: type, success: result.ok, result: result.ok ? result.data : { error: result.error } };
}


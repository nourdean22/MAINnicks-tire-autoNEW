/**
 * Integration Chain System
 * Connects Make.com, Grok/xAI, ClickUp, and Apollo.io into automated workflows.
 * Each chain calls tools in sequence, returning partial results on failure.
 */

import { chatWithGrok, analyzeRealTime } from "./grok";
import { createTask } from "./clickup";
import { searchFleetContacts } from "./apollo";
import { recordError } from "@/lib/errors/record-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainStepResult<T = unknown> {
  step: string;
  status: "success" | "error";
  data?: T;
  error?: string;
  durationMs: number;
}

export interface ChainResult {
  chain: string;
  status: "complete" | "partial" | "failed";
  steps: ChainStepResult[];
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runStep<T>(
  name: string,
  fn: () => Promise<T>
): Promise<ChainStepResult<T>> {
  const start = Date.now();
  try {
    const data = await fn();
    return { step: name, status: "success", data, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { step: name, status: "error", error: message, durationMs: Date.now() - start };
  }
}

function buildResult(chain: string, steps: ChainStepResult[], startedAt: string): ChainResult {
  const hasError = steps.some((s) => s.status === "error");
  const allError = steps.every((s) => s.status === "error");
  return {
    chain,
    status: allError ? "failed" : hasError ? "partial" : "complete",
    steps,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function getMakeWebhookUrl(hookPath: string): string | undefined {
  const base = process.env.MAKE_WEBHOOK_URL; // e.g. https://hook.us1.make.com
  if (!base) return undefined;
  return `${base}/${hookPath}`;
}

async function notifyMake(hookPath: string, payload: unknown): Promise<void> {
  const url = getMakeWebhookUrl(hookPath);
  if (!url) return; // Make webhook not configured — skip silently
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.MAKE_WEBHOOK_API_KEY;
  if (apiKey) headers["x-make-apikey"] = apiKey;
  await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(10_000), // wave-181.92 · Make webhook
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Chain: New Lead
// Apollo finds fleet contacts -> Grok analyzes -> ClickUp creates follow-up
// ---------------------------------------------------------------------------

export interface NewLeadChainInput {
  titles?: string[];
  locations?: string[];
  industries?: string[];
  limit?: number;
  clickupListId: string;
}

export async function newLeadChain(input: NewLeadChainInput): Promise<ChainResult> {
  const startedAt = new Date().toISOString();
  const steps: ChainStepResult[] = [];

  // Step 1 — Apollo: find fleet contacts
  const apolloStep = await runStep("apollo_search", () =>
    searchFleetContacts({
      titles: input.titles,
      locations: input.locations,
      industries: input.industries,
      limit: input.limit,
    })
  );
  steps.push(apolloStep);

  if (apolloStep.status === "error" || !apolloStep.data) {
    return buildResult("newLeadChain", steps, startedAt);
  }

  const contacts = apolloStep.data.contacts;
  if (contacts.length === 0) {
    return buildResult("newLeadChain", steps, startedAt);
  }

  // Step 2 — Grok: analyze the leads
  const contactSummary = contacts
    .map((c) => `${c.firstName} ${c.lastName} — ${c.title} at ${c.company} (${c.city || "N/A"}, ${c.state || "N/A"})`)
    .join("\n");

  const grokStep = await runStep("grok_analyze", () =>
    chatWithGrok([
      {
        role: "system",
        content:
          "You are a B2B sales strategist for an auto repair shop (Nick's Tire & Auto, Cleveland OH). " +
          "Analyze these fleet contacts. Rank them by potential value, suggest personalized outreach angles, " +
          "and flag any red flags. Be concise and actionable.",
      },
      { role: "user", content: `Analyze these leads:\n${contactSummary}` },
    ])
  );
  steps.push(grokStep);

  // Step 3 — ClickUp: create follow-up tasks for top leads
  const taskDescription =
    grokStep.status === "success" && grokStep.data
      ? `AI Analysis:\n${grokStep.data.content}\n\n---\nContacts:\n${contactSummary}`
      : `Contacts found:\n${contactSummary}`;

  const clickupStep = await runStep("clickup_task", () =>
    createTask(input.clickupListId, {
      name: `Follow up: ${contacts.length} new fleet leads`,
      description: taskDescription,
      priority: 2,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days out
    })
  );
  steps.push(clickupStep);

  // Notify Make.com webhook (fire-and-forget)
  notifyMake("new-lead-chain", {
    contacts: contacts.length,
    taskCreated: clickupStep.status === "success",
  }).catch((err) => recordError("integrations:make", err, { chain: "new-lead-chain" }));

  return buildResult("newLeadChain", steps, startedAt);
}

// ---------------------------------------------------------------------------
// Chain: Review Response
// Incoming review -> Grok writes response -> ClickUp creates approval task
// ---------------------------------------------------------------------------

export interface ReviewResponseChainInput {
  reviewerName: string;
  rating: number;
  reviewText: string;
  platform: string; // e.g. "Google", "Yelp"
  clickupListId: string;
}

export async function reviewResponseChain(input: ReviewResponseChainInput): Promise<ChainResult> {
  const startedAt = new Date().toISOString();
  const steps: ChainStepResult[] = [];

  // Step 1 — Grok: draft a response
  const grokStep = await runStep("grok_draft_response", () =>
    chatWithGrok([
      {
        role: "system",
        content:
          "You write professional, warm review responses for Nick's Tire & Auto (Cleveland OH, 4.9 stars). " +
          "Match the tone to the rating. For negative reviews, be empathetic and offer resolution. " +
          "For positive reviews, be grateful and personal. Keep it under 100 words.",
      },
      {
        role: "user",
        content: `Platform: ${input.platform}\nRating: ${input.rating}/5\nReviewer: ${input.reviewerName}\nReview: ${input.reviewText}\n\nDraft a response.`,
      },
    ])
  );
  steps.push(grokStep);

  // Step 2 — ClickUp: create approval task
  const draftResponse =
    grokStep.status === "success" && grokStep.data
      ? grokStep.data.content
      : "[Grok failed to generate — manual response needed]";

  const priority = input.rating <= 2 ? 1 : input.rating <= 3 ? 2 : 3;

  const clickupStep = await runStep("clickup_approval_task", () =>
    createTask(input.clickupListId, {
      name: `Review response: ${input.reviewerName} (${input.rating}★ ${input.platform})`,
      description: `Original review:\n"${input.reviewText}"\n\n---\nDrafted response:\n${draftResponse}`,
      priority: priority as 1 | 2 | 3 | 4,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
    })
  );
  steps.push(clickupStep);

  notifyMake("review-response-chain", {
    platform: input.platform,
    rating: input.rating,
    taskCreated: clickupStep.status === "success",
  }).catch((err) => recordError("integrations:make", err, { chain: "review-response-chain" }));

  return buildResult("reviewResponseChain", steps, startedAt);
}

// ---------------------------------------------------------------------------
// Chain: Competitor Insight
// Grok analyzes competitor -> ClickUp creates action items
// ---------------------------------------------------------------------------

export interface CompetitorInsightChainInput {
  competitorName: string;
  competitorDetails?: string; // any known info: website, location, reviews, etc.
  clickupListId: string;
}

export async function competitorInsightChain(input: CompetitorInsightChainInput): Promise<ChainResult> {
  const startedAt = new Date().toISOString();
  const steps: ChainStepResult[] = [];

  // Step 1 — Grok: analyze competitor
  const grokStep = await runStep("grok_competitor_analysis", () =>
    analyzeRealTime(
      `Competitive analysis: "${input.competitorName}" vs Nick's Tire & Auto (Cleveland OH, 4.9 stars, 1,700+ reviews). ` +
        (input.competitorDetails ? `Known info: ${input.competitorDetails}. ` : "") +
        "Identify their strengths, weaknesses, pricing positioning, and 3 specific actions Nick's can take to win against them."
    )
  );
  steps.push(grokStep);

  // Step 2 — ClickUp: create action-item task
  const analysis =
    grokStep.status === "success" && grokStep.data
      ? grokStep.data.content
      : "[Analysis unavailable — Grok failed]";

  const clickupStep = await runStep("clickup_action_items", () =>
    createTask(input.clickupListId, {
      name: `Competitor action items: ${input.competitorName}`,
      description: `Competitor: ${input.competitorName}\n\n${analysis}`,
      priority: 2,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
    })
  );
  steps.push(clickupStep);

  notifyMake("competitor-insight-chain", {
    competitor: input.competitorName,
    taskCreated: clickupStep.status === "success",
  }).catch((err) => recordError("integrations:make", err, { chain: "competitor-insight-chain" }));

  return buildResult("competitorInsightChain", steps, startedAt);
}

// ---------------------------------------------------------------------------
// Chain: Daily Brief
// Grok summarizes day -> ClickUp creates tomorrow's priorities
// ---------------------------------------------------------------------------

export interface DailyBriefChainInput {
  /** Free-text summary of today's activity, metrics, events */
  todaySummary: string;
  clickupListId: string;
}

export async function dailyBriefChain(input: DailyBriefChainInput): Promise<ChainResult> {
  const startedAt = new Date().toISOString();
  const steps: ChainStepResult[] = [];

  // Step 1 — Grok: generate brief + priorities
  const grokStep = await runStep("grok_daily_brief", () =>
    chatWithGrok([
      {
        role: "system",
        content:
          "You are the operations brain for Nick's Tire & Auto (Cleveland OH). " +
          "Given today's summary, produce: (1) a 3-sentence executive brief, (2) top 3 priorities for tomorrow ranked by impact, " +
          "(3) any risks or things that need immediate attention. Be specific and actionable.",
      },
      { role: "user", content: input.todaySummary },
    ])
  );
  steps.push(grokStep);

  // Step 2 — ClickUp: create tomorrow's priority task
  const briefContent =
    grokStep.status === "success" && grokStep.data
      ? grokStep.data.content
      : "[Brief unavailable — Grok failed]";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  const clickupStep = await runStep("clickup_priorities", () =>
    createTask(input.clickupListId, {
      name: `Daily priorities: ${tomorrow.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
      description: briefContent,
      priority: 1,
      dueDate: tomorrow,
    })
  );
  steps.push(clickupStep);

  notifyMake("daily-brief-chain", {
    date: tomorrow.toISOString(),
    taskCreated: clickupStep.status === "success",
  }).catch((err) => recordError("integrations:make", err, { chain: "daily-brief-chain" }));

  return buildResult("dailyBriefChain", steps, startedAt);
}

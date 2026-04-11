/**
 * Ask Nick — NOUR OS strategic advice endpoint.
 *
 * POST /api/ask-nick
 * Headers: X-Bridge-Key: <BRIDGE_API_KEY>
 * Body: { question: string; context?: string; type?: "strategy" | "decision" | "analysis" | "forecast" }
 *
 * Routes to the appropriate intelligence engine based on type:
 *   "strategy"  → psych-dominance agent (ruthless strategic advice)
 *   "decision"  → psych-dominance agent (same — decision framing)
 *   "analysis"  → intelligence engines (revenue, customer, shop pulse)
 *   "forecast"  → simulator agent (scenario simulation + predictions)
 *
 * Returns:
 *   { answer: string; confidence: number; actionable: boolean; nextSteps: string[] }
 *
 * Rate limit: 10 requests per hour per IP (expensive LLM calls).
 * Auth: X-Bridge-Key header must match BRIDGE_API_KEY env var.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";

// ─── Types ──────────────────────────────────────────────

type AdviceType = "strategy" | "decision" | "analysis" | "forecast";

interface AskNickRequest {
  question?: unknown;
  context?: unknown;
  type?: unknown;
}

interface AskNickResponse {
  answer: string;
  confidence: number;
  actionable: boolean;
  nextSteps: string[];
}

interface OpenAIChoice {
  message: {
    content: string;
  };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

// ─── Auth ───────────────────────────────────────────────

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function bridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.BRIDGE_API_KEY;
  if (!key) {
    res.status(503).json({ error: "Bridge not configured" });
    return;
  }
  const provided = req.headers["x-bridge-key"];
  if (typeof provided !== "string" || !safeCompare(provided, key)) {
    res.status(401).json({ error: "Invalid bridge key" });
    return;
  }
  next();
}

// ─── Rate Limiter — 10 req/hour per IP ──────────────────

const askNickLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Respect X-Forwarded-For set by Railway's proxy (trust proxy is enabled)
    const forwarded = req.headers["x-forwarded-for"];
    const ip = typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.ip ?? "unknown";
    return ip;
  },
  message: {
    error: "Too many requests to Ask Nick. Limit is 10 per hour. Call us at (216) 862-0005.",
  },
});

// ─── OpenAI helper ──────────────────────────────────────

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 700,
  temperature: number = 0.7
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI API error: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const data = (await response.json()) as OpenAIResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ─── Intelligence engine: pull live shop context ─────────

async function fetchShopContext(): Promise<string> {
  try {
    const { getShopPulse } = await import("../services/nickIntelligence");
    const pulse = await getShopPulse();
    return [
      `Shop status: ${pulse.shopStatus}`,
      `Today revenue: $${pulse.today.revenue}`,
      `Jobs closed today: ${pulse.today.jobsClosed}`,
      `Avg ticket: $${pulse.today.avgTicket}`,
      `Week revenue: $${pulse.thisWeek.revenue}`,
      `Walk rate: ${pulse.thisWeek.walkRate}`,
      `Insight: ${pulse.shopInsight}`,
    ].join("\n");
  } catch {
    return "";
  }
}

// ─── Agent: Strategy / Decision ─────────────────────────

async function runStrategyAgent(
  question: string,
  context: string
): Promise<AskNickResponse> {
  const liveContext = await fetchShopContext();
  const fullContext = [liveContext, context].filter(Boolean).join("\n\n");

  const systemPrompt =
    "You are Nick AI — the strategic intelligence engine for Nick's Tire & Auto. " +
    "You advise Nour (the CEO) with ruthless clarity. You are direct, data-driven, and action-oriented. " +
    "You know the shop's revenue targets, customer base, and operational levers. " +
    "Always respond with a JSON object containing: " +
    "answer (string — your strategic advice), " +
    "confidence (number 0-1 — how confident you are), " +
    "actionable (boolean — is this immediately actionable), " +
    "nextSteps (string[] — 2-4 specific next actions). " +
    "Return ONLY valid JSON, no markdown fences.";

  const userPrompt =
    `Question: "${question}"\n\nBusiness Context:\n${fullContext || "No additional context provided."}`;

  const raw = await callOpenAI(systemPrompt, userPrompt, 700, 0.7);
  return parseAIResponse(raw);
}

// ─── Agent: Analysis ────────────────────────────────────

async function runAnalysisAgent(
  question: string,
  context: string
): Promise<AskNickResponse> {
  const liveContext = await fetchShopContext();

  // Pull additional intelligence: dashboard stats
  let statsContext = "";
  try {
    const { getDashboardStats } = await import("../admin-stats");
    const stats = await getDashboardStats();
    statsContext = [
      `Total bookings: ${stats.bookings.total} (${stats.bookings.thisWeek} this week, ${stats.bookings.new} new)`,
      `Total leads: ${stats.leads.total} (${stats.leads.thisWeek} this week, ${stats.leads.urgent} urgent)`,
      `Callbacks pending: ${stats.callbacks.new}`,
    ].join("\n");
  } catch {
    // non-fatal — proceed without stats
  }

  const fullContext = [liveContext, statsContext, context].filter(Boolean).join("\n\n");

  const systemPrompt =
    "You are Nick AI — the intelligence analysis engine for Nick's Tire & Auto. " +
    "You analyze revenue trends, customer behavior, and operational data to surface insights for Nour (the CEO). " +
    "Be precise, cite numbers when available, and identify patterns. " +
    "Always respond with a JSON object containing: " +
    "answer (string — your analysis), " +
    "confidence (number 0-1 — how confident you are in the analysis), " +
    "actionable (boolean — does this analysis lead to a clear action), " +
    "nextSteps (string[] — 2-4 specific follow-up actions or investigations). " +
    "Return ONLY valid JSON, no markdown fences.";

  const userPrompt =
    `Analysis request: "${question}"\n\nLive shop data:\n${fullContext || "No live data available."}`;

  const raw = await callOpenAI(systemPrompt, userPrompt, 800, 0.4);
  return parseAIResponse(raw);
}

// ─── Agent: Forecast ────────────────────────────────────

async function runForecastAgent(
  question: string,
  context: string
): Promise<AskNickResponse> {
  const liveContext = await fetchShopContext();
  const fullContext = [liveContext, context].filter(Boolean).join("\n\n");

  const systemPrompt =
    "You are Nick AI — the forecasting and simulation engine for Nick's Tire & Auto. " +
    "You simulate future scenarios, predict outcomes, and model the impact of decisions. " +
    "Use available shop data to ground your forecasts in reality. " +
    "Always respond with a JSON object containing: " +
    "answer (string — your forecast and scenario analysis), " +
    "confidence (number 0-1 — how confident you are in the forecast), " +
    "actionable (boolean — can Nour act on this forecast now), " +
    "nextSteps (string[] — 2-4 specific actions to influence the forecasted outcome). " +
    "Return ONLY valid JSON, no markdown fences.";

  const userPrompt =
    `Forecast request: "${question}"\n\nCurrent context:\n${fullContext || "No additional context provided."}`;

  const raw = await callOpenAI(systemPrompt, userPrompt, 800, 0.5);
  return parseAIResponse(raw);
}

// ─── Response parser ────────────────────────────────────

function parseAIResponse(raw: string): AskNickResponse {
  let parsed: Partial<AskNickResponse> = {};

  try {
    // Strip markdown code fences if the model adds them despite instructions
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: treat the raw text as the answer
    return {
      answer: raw || "No response generated.",
      confidence: 0.5,
      actionable: false,
      nextSteps: [],
    };
  }

  // Clamp and validate fields
  const clampFloat = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? fallback : Math.min(1, Math.max(0, n));
  };

  const nextSteps = Array.isArray(parsed.nextSteps)
    ? (parsed.nextSteps as unknown[])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 6)
    : [];

  return {
    answer: typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : raw || "No response generated.",
    confidence: clampFloat(parsed.confidence, 0.7),
    actionable: typeof parsed.actionable === "boolean" ? parsed.actionable : nextSteps.length > 0,
    nextSteps,
  };
}

// ─── Route registration ─────────────────────────────────

export function registerAskNickRoute(app: Express): void {
  app.post(
    "/api/ask-nick",
    askNickLimiter,
    bridgeAuth,
    async (req: Request, res: Response) => {
      try {
        const { question, context, type } = req.body as AskNickRequest;

        // Validate question
        if (
          !question ||
          typeof question !== "string" ||
          question.trim().length === 0
        ) {
          res.status(400).json({
            error: "Request body must include a non-empty 'question' string",
          });
          return;
        }

        const questionStr = question.trim();
        const contextStr = typeof context === "string" ? context.trim() : "";

        // Validate and default type
        const validTypes: AdviceType[] = ["strategy", "decision", "analysis", "forecast"];
        const adviceType: AdviceType =
          typeof type === "string" && validTypes.includes(type as AdviceType)
            ? (type as AdviceType)
            : "strategy";

        let result: AskNickResponse;

        switch (adviceType) {
          case "strategy":
          case "decision":
            result = await runStrategyAgent(questionStr, contextStr);
            break;
          case "analysis":
            result = await runAnalysisAgent(questionStr, contextStr);
            break;
          case "forecast":
            result = await runForecastAgent(questionStr, contextStr);
            break;
        }

        res.json(result);
      } catch (err: unknown) {
        console.error("[ask-nick] Agent failed:", err);
        res.status(500).json({
          error: err instanceof Error ? err.message : "Ask Nick agent failed",
        });
      }
    }
  );
}

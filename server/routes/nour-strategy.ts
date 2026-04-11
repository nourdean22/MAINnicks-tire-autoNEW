/**
 * Nour Strategy Route — AI-powered lead analysis endpoint.
 *
 * POST /api/nour-strategy
 * Body: { leads: Array<{ name: string; message: string; [key: string]: unknown }> }
 *
 * For each lead, calls OpenAI gpt-4o-mini and returns:
 *   - urgency: 1–5
 *   - budgetPotential: 1–5
 *   - killerScore: 1–10
 *   - recommendedAction: 'CALL_NOW' | 'SMS_ONLY' | 'IGNORE'
 */

import type { Express, Request, Response } from "express";

interface Lead {
  name?: string;
  message?: string;
  [key: string]: unknown;
}

interface AnalyzedLead extends Lead {
  urgency: number;
  budgetPotential: number;
  killerScore: number;
  recommendedAction: "CALL_NOW" | "SMS_ONLY" | "IGNORE";
}

interface OpenAIChoice {
  message: {
    content: string;
  };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

async function analyzeLead(lead: Lead): Promise<AnalyzedLead> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

  const leadText = lead.message || lead.name || JSON.stringify(lead);

  const prompt = `Analyze this customer lead and return ONLY a valid JSON object with no extra text:

Lead: "${leadText}"

Return JSON with exactly these fields:
{
  "urgency": <integer 1-5, where 5 = extremely urgent>,
  "budgetPotential": <integer 1-5, where 5 = high budget>,
  "killerScore": <integer 1-10, overall revenue opportunity>,
  "recommendedAction": <"CALL_NOW" | "SMS_ONLY" | "IGNORE">
}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a ruthless revenue hunter.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
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
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";

  let scores: {
    urgency: number;
    budgetPotential: number;
    killerScore: number;
    recommendedAction: "CALL_NOW" | "SMS_ONLY" | "IGNORE";
  };

  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    scores = JSON.parse(cleaned);
  } catch {
    // Fallback defaults if parsing fails
    scores = {
      urgency: 3,
      budgetPotential: 3,
      killerScore: 5,
      recommendedAction: "SMS_ONLY",
    };
  }

  // Clamp values to valid ranges
  const clamp = (val: unknown, min: number, max: number): number => {
    const n = typeof val === "number" ? val : Number(val);
    return isNaN(n) ? min : Math.min(max, Math.max(min, Math.round(n)));
  };

  const validActions = ["CALL_NOW", "SMS_ONLY", "IGNORE"] as const;
  const action = validActions.includes(scores.recommendedAction as (typeof validActions)[number])
    ? scores.recommendedAction
    : "SMS_ONLY";

  return {
    ...lead,
    urgency: clamp(scores.urgency, 1, 5),
    budgetPotential: clamp(scores.budgetPotential, 1, 5),
    killerScore: clamp(scores.killerScore, 1, 10),
    recommendedAction: action,
  };
}

export function registerNourStrategyRoute(app: Express): void {
  app.post("/api/nour-strategy", async (req: Request, res: Response) => {
    try {
      const { leads } = req.body as { leads?: unknown };

      if (!Array.isArray(leads) || leads.length === 0) {
        res.status(400).json({
          error: "Request body must include a non-empty 'leads' array",
        });
        return;
      }

      if (leads.length > 50) {
        res.status(400).json({
          error: "Maximum 50 leads per request",
        });
        return;
      }

      const analyzed = await Promise.all(
        (leads as Lead[]).map((lead) => analyzeLead(lead))
      );

      res.json({
        success: true,
        analyzed,
        count: analyzed.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      console.error("[nour-strategy] Analysis failed:", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Lead analysis failed",
      });
    }
  });
}

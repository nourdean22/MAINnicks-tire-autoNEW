/**
 * Nour Chief Strategist Route — AI-powered strategic advisor endpoint.
 *
 * POST /api/nour-chief-strategist
 * Body: { input: string; context?: string }
 *
 * Transforms passive thoughts into dominant actions by:
 *   1. Identifying the weakness in the input
 *   2. Providing 3 strategies to turn it into a power move
 *   3. Being direct — no fluff
 */

import type { Express, Request, Response } from "express";

interface OpenAIChoice {
  message: {
    content: string;
  };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

async function getStrategy(input: string, context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

  const userPrompt = `Context / Current mood & goals: ${context || "Not provided"}

Situation / Thought: ${input}

RULES:
1. Identify the weakness in the situation above.
2. Provide 3 strategies to turn it into a power move.
3. Be direct. No fluff.`;

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
          content:
            "You are Nour's Chief Strategist. You are ruthless, manipulative, and focused on winning. Your goal: Transform Nour's passive thoughts into dominant actions.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      max_tokens: 1024,
      temperature: 0.7,
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

  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  return content;
}

export function registerNourChiefStrategistRoute(app: Express): void {
  app.post("/api/nour-chief-strategist", async (req: Request, res: Response) => {
    try {
      const { input, context } = req.body as {
        input?: unknown;
        context?: unknown;
      };

      if (!input || typeof input !== "string" || input.trim().length === 0) {
        res.status(400).json({
          error: "Request body must include a non-empty 'input' string",
        });
        return;
      }

      const contextStr =
        typeof context === "string" ? context.trim() : "";

      const strategy = await getStrategy(input.trim(), contextStr);

      res.json({
        success: true,
        strategy,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      console.error("[nour-chief-strategist] Strategy generation failed:", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Strategy generation failed",
      });
    }
  });
}

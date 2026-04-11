/**
 * Psych Dominance Agent — AI-powered strategic decision-making endpoint.
 *
 * POST /api/agents/psych-dominance
 * Body: { input: string; context?: string }
 *
 * Transforms passive thoughts into dominant strategic actions using
 * OpenAI gpt-4o-mini with a ruthless chief strategist persona.
 *
 * Returns: { strategy: string }
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

async function callPsychDominance(
  input: string,
  context: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

  const userPrompt = `Thought/Situation: "${input}"\n\nContext (mood/goals): "${context}"`;

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
            "You are Nour's Chief Strategist. Ruthless, manipulative, focused on winning. Transform passive thoughts into dominant actions.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      max_tokens: 500,
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
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export function registerPsychDominanceRoute(app: Express): void {
  app.post("/api/agents/psych-dominance", async (req: Request, res: Response) => {
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

      const strategy = await callPsychDominance(input.trim(), contextStr);

      res.json({ strategy });
    } catch (err: unknown) {
      console.error("[psych-dominance] Agent failed:", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Psych dominance agent failed",
      });
    }
  });
}

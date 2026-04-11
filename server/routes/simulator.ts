/**
 * Simulator Agent — AI-powered scenario simulation endpoint.
 *
 * POST /api/agents/simulator
 * Body: { scenario: string }
 *
 * Simulates outcomes and provides predictions for a given scenario
 * using OpenAI gpt-4o-mini.
 *
 * Returns: { simulation: string }
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

async function simulateScenario(scenario: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

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
            "You are an expert scenario simulator and strategic forecaster. Analyze the given situation, simulate likely outcomes across multiple paths, and provide clear predictions and actionable recommendations.",
        },
        {
          role: "user",
          content: `Simulate this scenario and predict outcomes:\n\n"${scenario}"`,
        },
      ],
      max_tokens: 600,
      temperature: 0.5,
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

export function registerSimulatorRoute(app: Express): void {
  app.post("/api/agents/simulator", async (req: Request, res: Response) => {
    try {
      const { scenario } = req.body as { scenario?: unknown };

      if (
        !scenario ||
        typeof scenario !== "string" ||
        scenario.trim().length === 0
      ) {
        res.status(400).json({
          error: "Request body must include a non-empty 'scenario' string",
        });
        return;
      }

      const simulation = await simulateScenario(scenario.trim());

      res.json({ simulation });
    } catch (err: unknown) {
      console.error("[simulator] Agent failed:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Simulator agent failed",
      });
    }
  });
}

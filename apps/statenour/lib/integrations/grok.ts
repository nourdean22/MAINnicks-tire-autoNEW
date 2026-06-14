/**
 * Grok (xAI) — Real-time AI model with unfiltered responses.
 * Free tier: limited API access.
 * Used for: second-opinion AI, real-time data queries, unfiltered analysis.
 */

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokResponse {
  content: string;
  model: string;
  tokensUsed: { prompt: number; completion: number };
}

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY not configured");
  return key;
}

/**
 * Chat with Grok — OpenAI-compatible API.
 */
export async function chatWithGrok(
  messages: GrokMessage[],
  params?: { model?: string; maxTokens?: number; temperature?: number }
): Promise<GrokResponse> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000), // wave-181.92 · AI completion
    body: JSON.stringify({
      model: params?.model || "grok-3-mini",
      messages,
      max_tokens: params?.maxTokens || 1024,
      temperature: params?.temperature ?? 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Grok API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    model: data.model || "grok-3-mini",
    tokensUsed: {
      prompt: data.usage?.prompt_tokens || 0,
      completion: data.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Get a second opinion on a business decision from Grok.
 */
export async function getSecondOpinion(question: string): Promise<GrokResponse> {
  return chatWithGrok([
    {
      role: "system",
      content: "You are a brutally honest business advisor. Nour owns Nick's Tire & Auto in Cleveland OH (4.9 stars, 1,700+ reviews). Give direct, contrarian analysis. Challenge assumptions. Name specific risks and opportunities others would miss.",
    },
    { role: "user", content: question },
  ]);
}

/**
 * Analyze real-time market data or trends.
 */
export async function analyzeRealTime(topic: string): Promise<GrokResponse> {
  return chatWithGrok([
    {
      role: "system",
      content: "Analyze this topic using real-time data. Be specific with numbers, trends, and actionable insights for a small business owner in the auto repair industry.",
    },
    { role: "user", content: topic },
  ]);
}

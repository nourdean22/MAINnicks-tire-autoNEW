/**
 * Vision-input helper · v8.3 · BATCH 18 · Apr 29.
 *
 * Lets the chat layer pass image attachments to a multimodal model
 * and get back a regular text completion. Distinct from image-gen
 * (lib/ai/venice-image.ts) and from the dedicated /api/ai/caption-
 * photo route — this is the "user attached a photo, answer the
 * question using the photo as visual context" path.
 *
 * Provider order:
 *   1. Ollama qwen3-vl:235b-instruct  (preferred — 1M context, Nour's local)
 *   2. OpenAI gpt-4o                  (fallback — best vision quality)
 *   3. Anthropic claude-haiku-4.5     (fallback — fast vision)
 *
 * Returns the same {content, provider, model} shape as `aiChat()` so
 * callers can swap one for the other on the vision path without
 * changing downstream type plumbing.
 *
 * Doesn't extend `aiChat` directly — that signature is shared across
 * 50+ call sites. Keeping vision-input as a dedicated helper avoids
 * the cross-cutting refactor.
 */

// AiResponse isn't exported from provider.ts (it's internal there).
// Inline a structurally-compatible type so callers can unify on shape.
export interface AiResponse {
  content: string;
  provider: string;
  model: string;
}

export interface VisionMessage {
  role: "system" | "user" | "assistant";
  /**
   * Either a plain text turn (string), or a multimodal turn that
   * mixes text and image references.
   */
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; imageUrl: string }
      >;
}

export interface VisionChatOptions {
  /** Override the default provider order. */
  preferredProvider?: "ollama" | "openai" | "anthropic";
  /** Cap on output tokens. Default 1024. */
  maxOutputTokens?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

interface ProviderResult {
  content: string;
  provider: "ollama" | "openai" | "anthropic";
  model: string;
}

const OLLAMA_VISION_MODEL =
  cleanEnv(process.env.OLLAMA_VISION_MODEL) ||
  cleanEnv(process.env.OLLAMA_MODEL) ||
  "qwen3-vl:235b-instruct";
const OPENAI_VISION_MODEL = "gpt-4o";
const ANTHROPIC_VISION_MODEL = "claude-haiku-4-5-20251001";

function cleanEnv(v: string | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed && trimmed !== "undefined" && trimmed !== "null" ? trimmed : null;
}

/**
 * Normalize a VisionMessage[] into the shape OpenAI / Ollama expect.
 * Both use the same `content: [{type: 'text'} | {type:'image_url'}]`
 * shape, just with slightly different image keys.
 */
function toOpenAIShape(
  messages: VisionMessage[],
): Array<{
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "image_url" as const, image_url: { url: part.imageUrl } },
      ),
    };
  });
}

/** Ollama vision call (OpenAI-compatible /v1/chat/completions). */
async function callOllama(
  messages: VisionMessage[],
  options: VisionChatOptions,
): Promise<ProviderResult> {
  const baseUrl = cleanEnv(process.env.OLLAMA_BASE_URL) || "http://localhost:11434/v1";
  const apiKey = cleanEnv(process.env.OLLAMA_API_KEY) || "ollama";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      messages: toOpenAIShape(messages),
      max_tokens: options.maxOutputTokens ?? 1024,
      options: {
        num_predict: options.maxOutputTokens ?? 1024,
      },
    }),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`ollama vision ${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return { content, provider: "ollama", model: OLLAMA_VISION_MODEL };
}

/** OpenAI vision call. */
async function callOpenAI(
  messages: VisionMessage[],
  options: VisionChatOptions,
): Promise<ProviderResult> {
  const apiKey = cleanEnv(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      messages: toOpenAIShape(messages),
      max_tokens: options.maxOutputTokens ?? 1024,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openai vision ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return { content, provider: "openai", model: OPENAI_VISION_MODEL };
}

/** Anthropic vision call (uses sources: type=base64 OR type=url). */
async function callAnthropic(
  messages: VisionMessage[],
  options: VisionChatOptions,
): Promise<ProviderResult> {
  const apiKey = cleanEnv(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const sysParts = messages.filter((m) => m.role === "system");
  const restParts = messages.filter((m) => m.role !== "system");
  const sysText = sysParts
    .flatMap((m) =>
      typeof m.content === "string"
        ? [m.content]
        : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text),
    )
    .join("\n\n");

  const body = {
    model: ANTHROPIC_VISION_MODEL,
    max_tokens: options.maxOutputTokens ?? 1024,
    system: sysText || undefined,
    messages: restParts.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((part) =>
              part.type === "text"
                ? { type: "text", text: part.text }
                : {
                    type: "image",
                    source: { type: "url", url: part.imageUrl },
                  },
            ),
    })),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`anthropic vision ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const content =
    json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
  return { content, provider: "anthropic", model: ANTHROPIC_VISION_MODEL };
}

/**
 * Public entry point. Tries providers in order; returns the first
 * successful response. Throws after all providers fail.
 *
 * Use case:
 *   const r = await aiChatWithVision([
 *     { role: "system", content: "Describe what you see." },
 *     {
 *       role: "user",
 *       content: [
 *         { type: "text", text: "What's in this picture?" },
 *         { type: "image", imageUrl: "https://..." },
 *       ],
 *     },
 *   ]);
 *   console.log(r.content);
 */
export async function aiChatWithVision(
  messages: VisionMessage[],
  options: VisionChatOptions = {},
): Promise<AiResponse> {
  const order: Array<"ollama" | "openai" | "anthropic"> = options.preferredProvider
    ? [
        options.preferredProvider,
        ...(["ollama", "openai", "anthropic"] as const).filter(
          (p) => p !== options.preferredProvider,
        ),
      ]
    : ["ollama", "openai", "anthropic"];

  let lastError: Error | null = null;
  for (const provider of order) {
    try {
      if (provider === "ollama") return await callOllama(messages, options);
      if (provider === "openai") return await callOpenAI(messages, options);
      return await callAnthropic(messages, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[vision-input] ${provider} failed:`, lastError.message);
    }
  }
  throw lastError ?? new Error("all vision providers failed");
}

/**
 * Convenience: simple "describe this image" call. Returns the AI's
 * description. Good for thumbnails, alt text, content moderation.
 */
export async function describeImage(
  imageUrl: string,
  question: string = "Describe this image in 2-3 sentences.",
  options: VisionChatOptions = {},
): Promise<AiResponse> {
  return aiChatWithVision(
    [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image", imageUrl },
        ],
      },
    ],
    options,
  );
}

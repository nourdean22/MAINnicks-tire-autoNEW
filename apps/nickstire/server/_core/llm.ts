export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
  /** Present on an ASSISTANT message that issued tool calls. It MUST be
   *  carried back to the API on the next request or the following `tool`
   *  result messages are orphaned (the API rejects/ignores them and the
   *  model re-issues the same call) — see normalizeMessage. */
  tool_calls?: ToolCall[];
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  /** Per-call abort timeout in ms (default 30000). Large structured
   *  generations — full carousel/reel briefs — routinely need more. */
  timeoutMs?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
  /**
   * Ollama slot priority (2026-08-06): P0 live production · P1 shadow eval ·
   * P2 benchmarks/cage (default) · P3 backfill · P4 speculative. Only
   * consulted when the call routes to the Ollama lane.
   */
  priority?: 0 | 1 | 2 | 3 | 4;
  /**
   * Sampling temperature. Unset = provider default. Ghost-replay evaluation
   * pins 0 so candidate-prompt comparisons measure the prompt, not the dice
   * (a ±1-seed swing between identical runs was observed at the default).
   */
  temperature?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

export const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id, tool_calls } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility.
  const content =
    contentParts.length === 1 && contentParts[0].type === "text"
      ? contentParts[0].text
      : contentParts;

  // An assistant message that issued tool calls MUST carry `tool_calls`
  // back to the API. Dropping it (the prior behavior) orphaned the
  // following `tool` result messages: the model never saw that it had
  // already called the tool, re-issued the same call every loop
  // iteration, and the caller's tool loop exhausted to an empty reply —
  // the customer-facing "Sorry, I'm glitching out" fallback in gemini.ts.
  if (tool_calls && tool_calls.length > 0) {
    return { role, name, content, tool_calls };
  }

  return { role, name, content };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

/**
 * Ollama Cloud model detection (2026-08-06). Substrings mirror statenour's
 * config/ai-providers.ts modelSubstrings — one vocabulary across the estate.
 * Ollama Cloud is the estate's ONE funded LLM lane; OpenRouter 402'd every
 * OpenAI-family request from 2026-07-17 onward.
 */
const OLLAMA_MODEL_SUBSTRINGS = ["glm-5", "qwen3", "deepseek-v3", "deepseek-v4", "kimi", "minimax", "mistral-large", "gpt-oss"];

export const isOllamaModel = (model?: string): boolean => {
  if (process.env.AI_FORCE_OLLAMA === "true") return true;
  return !!model && OLLAMA_MODEL_SUBSTRINGS.some((s) => model.includes(s));
};

const resolveApiUrl = (model?: string) => {
  if (isOllamaModel(model)) {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(`OLLAMA_API_KEY is missing for Ollama model "${model || "default"}"`);
    }
    const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
    return `${base}/v1/chat/completions`;
  }
  const isGeminiModel = !!model && (model.startsWith("gemini-") || model.startsWith("google/"));
  if (isGeminiModel) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(`GEMINI_API_KEY is missing for Gemini model "${model}"`);
    }
    return "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions";
  }
  if (process.env.OPENAI_BASE_URL) {
    return `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`;
  }
  if (process.env.OPENAI_API_KEY) {
    return "https://api.openai.com/v1/chat/completions";
  }
  throw new Error(`OPENAI_API_KEY is missing for OpenAI model "${model || "default"}"`);
};

/** Returns the correct API key — OLLAMA_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY */
const resolveApiKey = (model?: string): string => {
  if (isOllamaModel(model)) {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(`OLLAMA_API_KEY is missing for Ollama model "${model || "default"}"`);
    }
    return process.env.OLLAMA_API_KEY;
  }
  const isGeminiModel = !!model && (model.startsWith("gemini-") || model.startsWith("google/"));
  if (isGeminiModel) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(`GEMINI_API_KEY is missing for Gemini model "${model}"`);
    }
    return process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  throw new Error(`OPENAI_API_KEY is missing for OpenAI model "${model || "default"}"`);
};

const assertApiKey = (model?: string) => {
  const key = resolveApiKey(model);
  if (!key) {
    throw new Error(`No API key configured for model "${model || "default"}" (checked GEMINI_API_KEY and OPENAI_API_KEY)`);
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

/**
 * Ollama Cloud accepts response_format.json_schema but does NOT forward the
 * schema to the model. Probed live 2026-08-14 against deepseek-v4-pro: the
 * model's own reasoning said "The schema is not explicitly provided" and it
 * invented snake_case key names, which callers' camelCase lookups then
 * silently coerced to ""/[] — reel briefs reached enqueue with 0 beats and no
 * caption, and EVERY outputSchema call site on this lane was schema-blind the
 * same way. Re-probed with the schema embedded as a message: exact keys back.
 *
 * So on the Ollama lane the schema is restated in-conversation. Returns the
 * contract message, or null when the request has no json_schema format.
 */
export function buildSchemaContractMessage(
  format: { type: string; json_schema?: JsonSchema } | undefined,
): Message | null {
  if (!format || format.type !== "json_schema" || !format.json_schema?.schema) return null;
  return {
    role: "system",
    content:
      "OUTPUT CONTRACT: reply with exactly ONE JSON object that validates against this JSON Schema — use these exact property names and types, no markdown fences, no prose:\n" +
      JSON.stringify(format.json_schema.schema),
  };
}

/**
 * Provider escape hatch: AI_FORCE_GEMINI=true reroutes EVERY OpenAI-family
 * request (explicit "gpt-*"/"o*" call-site pins included) onto the Gemini
 * free-tier key. Added 2026-07-17 when the shared OpenRouter account ran out
 * of credits and 402'd every creative leg in prod — ~9 call sites hard-pin
 * gpt-4o-mini, so an env-only key removal would throw instead of degrading.
 * Reversible by unsetting the flag; explicit gemini-* pins are untouched.
 */
export function resolveEffectiveModel(requested: string | undefined): string | undefined {
  // AI_FORCE_OLLAMA=true (2026-08-06): reroute EVERY request — gpt-* / o* /
  // gemini-* pins included — onto the funded Ollama Cloud lane. Same shape as
  // AI_FORCE_GEMINI below, but total: the operator's directive is Ollama for
  // everything, and ~9 call sites hard-pin gpt-4o-mini which Ollama does not
  // host, so pins MUST be rerouted or they 404. deepseek-v4-pro is the
  // live-verified successor default (statenour config, 2026-07-15).
  if (process.env.AI_FORCE_OLLAMA === "true") {
    // An Ollama-NATIVE pin is already on the funded lane and cannot 404 for
    // the reason this flag exists, so it survives (2026-08-07). Without this,
    // the reroute silently flattened EVERY lane onto one model in prod:
    // OLLAMA_MODEL is unset on Railway, so judgeSingleConcept, the igAutopost
    // generator it grades, and resolutionJudge's explicit "gpt-oss:120b" pin
    // all resolved to deepseek-v4-pro — a judge grading its own family, which
    // is the self-eval defect the concept tournament exists to remove. The
    // divergence was invisible locally, where the flag is unset and pins work.
    //
    // NOTE: isOllamaModel() is unusable here — it short-circuits to true under
    // this very flag, which would let "gpt-4o-mini" through and 404. The raw
    // substring list is the only correct test.
    //
    // A native pin beats OLLAMA_MODEL deliberately: the env var is the DEFAULT
    // for unpinned and non-native calls, not a hammer. Making pin-survival
    // conditional on it would reintroduce the same silent flattening one layer
    // down. If a true global override is ever needed, it should be a new flag
    // whose name says it flattens — not a side effect of this one.
    // The "/" guard: vendor-prefixed ids ("moonshotai/kimi-k2",
    // "deepseek/deepseek-v3.2-exp") CONTAIN a native substring but are the
    // OpenRouter form Ollama does not host — surviving verbatim would 404.
    // Ollama-native ids are name:tag, never vendor/name, so "/" is the
    // discriminator; prefixed forms fall through to the safe default.
    if (requested && !requested.includes("/") && OLLAMA_MODEL_SUBSTRINGS.some((s) => requested.includes(s))) {
      return requested;
    }
    // ONLY OLLAMA_MODEL may override here — LLM_MODEL is the OpenRouter-era
    // variable and typically names a model Ollama does not host (the live
    // probe resolved to meta-llama/llama-3.3-70b-instruct → 404, the exact
    // pin-mismatch class this flag exists to prevent).
    return process.env.OLLAMA_MODEL || "deepseek-v4-pro";
  }
  if (process.env.AI_FORCE_GEMINI !== "true") return requested;
  if (requested && (requested.startsWith("gemini-") || requested.startsWith("google/"))) return requested;
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const requestedModel = resolveEffectiveModel(params.model);
  const model = requestedModel || (process.env.OPENAI_API_KEY && process.env.AI_FORCE_GEMINI !== "true"
    ? (process.env.LLM_MODEL || "gpt-4o")
    // gemini-1.5-pro was RETIRED by Google (404 "not found for API version") —
    // observed live 2026-07-16 killing reel brief generation in prod. 2.5-flash
    // is the model the rest of this codebase is tuned for (see the
    // thinking-overhead notes in igAutopost/carouselBriefGen/reviewReplies).
    : (process.env.GEMINI_MODEL || "gemini-2.5-flash"));

  assertApiKey(model);

  // Vision reroute (2026-08-11). Ollama Cloud's text lane REJECTS image parts —
  // probed live with the prod key: deepseek-v4-pro + image_url → 400 "this
  // model does not support image input". Under AI_FORCE_OLLAMA every unpinned
  // call lands there, so the rendered-QA vision critic (designed for "Gemini
  // via invokeLLM image parts", per its own header) has returned
  // critic:"skipped" on EVERY verdict since the flag was set on 2026-08-06 —
  // and the publish gate rightly holds an unevaluated verdict, wedging every
  // autonomous reel. An image-bearing request on the Ollama lane can never
  // succeed, so route it to Gemini up front instead of spending a doomed
  // round-trip. Text-only calls are untouched; without a GEMINI_API_KEY the
  // original routing (and its honest failure) is preserved.
  const hasImageParts = params.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => typeof p === "object" && p !== null && (p as { type?: string }).type === "image_url"),
  );
  const isGeminiName = (m?: string) => !!m && (m.startsWith("gemini-") || m.startsWith("google/"));
  const visionRerouted =
    hasImageParts && isOllamaModel(model) && !isGeminiName(model) && !!process.env.GEMINI_API_KEY;
  const visionModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (visionRerouted) {
    try {
      const { createLogger } = await import("../lib/logger");
      createLogger("llm").warn("image parts on the ollama lane — rerouting this call to gemini", { model, visionModel });
    } catch { /* logging must never block the reroute */ }
  }

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = params.maxTokens || params.max_tokens || 4096;

  if (typeof params.temperature === "number") {
    payload.temperature = params.temperature;
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  // Ollama drops the json_schema on the floor (see buildSchemaContractMessage)
  // — restate it in-conversation there. A vision-rerouted call goes to Gemini,
  // which enforces response_format itself; the 403-quota Gemini fallback below
  // reuses this payload, where the extra contract message is redundant but
  // harmless. response_format stays on the request either way, so a future
  // Ollama that starts enforcing it just gets belt and suspenders.
  if (isOllamaModel(model) && !visionRerouted) {
    const contractMsg = buildSchemaContractMessage(normalizedResponseFormat);
    if (contractMsg) {
      (payload.messages as ReturnType<typeof normalizeMessage>[]).push(normalizeMessage(contractMsg));
    }
  }

  // Ollama Pro allows three concurrent cloud models — every Ollama-bound
  // call takes a prioritized slot so background work (P2+) yields to live
  // and shadow traffic instead of starving it. Non-Ollama routes skip the
  // scheduler entirely.
  let releaseSlot: (() => void) | null = null;
  // A vision-rerouted call never touches Ollama, so it must not consume one of
  // the three prioritized Ollama concurrency slots.
  if (isOllamaModel(model) && !visionRerouted) {
    const { acquireOllamaSlot } = await import("./ollamaScheduler");
    releaseSlot = await acquireOllamaSlot(params.priority ?? 2);
  }

  try {
    const timeoutMs = params.timeoutMs ?? 30000; // default 30s; heavy generations override
    const doFetch = (url: string, key: string, body: Record<string, unknown>) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

    // resolveApiUrl/resolveApiKey are flag-poisoned for the reroute (under
    // AI_FORCE_OLLAMA, isOllamaModel() is true for ANY model) — hard-target
    // Gemini's endpoint, same as the 403-subscription fallback below.
    let response = visionRerouted
      ? await doFetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions",
          process.env.GEMINI_API_KEY as string,
          { ...payload, model: visionModel },
        )
      : await doFetch(resolveApiUrl(model), resolveApiKey(model), payload);

    if (!response.ok) {
      const errorText = await response.text();

      // Ollama Cloud quota-refusal fallback (2026-08-11). AI_FORCE_OLLAMA
      // funnels the WHOLE estate onto one usage-capped Ollama account, and the
      // cap refuses with 403 "this model requires a subscription" — measured
      // live: the 14:00-ET daily-reel brief 403'd four times on 2026-08-10
      // (after a day of estate spend) while the same model returned 200 the
      // next morning. A quota refusal is a capacity signal, not a config
      // error, so degrade to the Gemini lane for THIS call instead of going
      // dark — same doctrine as REEL_FALLBACK_TO_TEMPLATE_STOCK. Everything
      // else (non-403, non-subscription text, missing Gemini key) still
      // throws exactly the original error.
      const quotaRefusal =
        !visionRerouted && // a rerouted call already IS on Gemini — never bounce it back
        response.status === 403 && /subscription/i.test(errorText) && isOllamaModel(model);
      const alreadyGemini = !!model && (model.startsWith("gemini-") || model.startsWith("google/"));
      const geminiKey = process.env.GEMINI_API_KEY;

      if (quotaRefusal && geminiKey && !alreadyGemini) {
        const fallbackModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        try {
          const { createLogger } = await import("../lib/logger");
          createLogger("llm").warn("ollama quota refusal — falling back to gemini for this call", {
            model,
            fallbackModel,
          });
        } catch {
          /* logging must never block the fallback */
        }
        // resolveApiUrl/resolveApiKey are unusable for the retry: under
        // AI_FORCE_OLLAMA, isOllamaModel() short-circuits true for ANY model,
        // which would route the retry straight back to the refusing lane.
        response = await doFetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions",
          geminiKey,
          { ...payload, model: fallbackModel },
        );
        if (!response.ok) {
          const fallbackText = await response.text();
          throw new Error(
            `LLM invoke failed on both lanes: ollama ${model} 403 subscription refusal; gemini ${fallbackModel} ${response.status} ${response.statusText} – ${fallbackText}`
          );
        }
      } else {
        throw new Error(
          `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
        );
      }
    }

    return (await response.json()) as InvokeResult;
  } finally {
    releaseSlot?.();
  }
}

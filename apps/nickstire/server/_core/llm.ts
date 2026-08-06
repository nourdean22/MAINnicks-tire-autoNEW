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

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(resolveApiUrl(model), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resolveApiKey(model)}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(params.timeoutMs ?? 30000), // default 30s; heavy generations override
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}

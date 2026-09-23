/**
 * Vision Analyzer · Photo Damage Assessment
 *
 * Category 4 of docs/eval-rubrics/huggingface-model-strategy.md. Looks
 * at a photo of a tire/brake/vehicle and returns a textual assessment
 * the operator (or a downstream drafter) can turn into a customer
 * SMS reply.
 *
 * Two backends supported:
 *   1. Replicate (default) · Qwen2-VL 72B at `lucataco/qwen2-vl-72b` ·
 *      multi-modal vision-language reasoning · best quality
 *   2. HuggingFace Inference (fallback) · llava-hf models · cheaper but
 *      slightly lower quality on automotive imagery
 *
 * The prompt is automotive-tuned · the caller can override.
 *
 * Use case · customer texts a photo of a damaged tire:
 *   1. SMS gateway webhook detects MMS (NumMedia ≥ 1 OR Capevace
 *      attachments field) → grabs the photo URL
 *   2. Calls analyzePhoto({ photoUrl, prompt })
 *   3. Receives structured assessment { description, urgency, service }
 *   4. Optionally drafts SMS reply via nickgpt-client (Wave AE)
 *   5. Sends reply via shop gateway with { via: "shop" }
 *
 * NOTE · vision models can hallucinate. The output is OPERATOR-FACING
 * only by default · the runbook describes how to enable auto-reply
 * gated on a confidence threshold + operator sample-review period.
 */

import { createLogger } from "../lib/logger";
import { withTimeout } from "@nour/utils";

const log = createLogger("vision-analyzer");

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const QWEN2_VL_VERSION = "a76d456af4b3cc18a5b5f48bd1c2da6f37e09c2cad0c12378f01d83b7d8b842c";
// ^ pinned Qwen2-VL-72B-Instruct on Replicate. Check Replicate page for newer hash if quality regresses.
const QWEN2_VL_MODEL = "lucataco/qwen2-vl-72b-instruct";
const HF_LLAVA_MODEL = "llava-hf/llava-1.5-7b-hf";
// 2026-09-22 · the two providers whose keys the service already holds. Both
// speak the OpenAI chat-completions shape with an inlined image; both are
// called DIRECTLY, not through _core/llm.ts, because AI_FORCE_OLLAMA /
// AI_FORCE_GEMINI reroute every request onto a text default that cannot see.
const GEMINI_VISION_MODEL = "gemini-2.5-flash"; // the free-tier model chat already uses in prod
const GEMINI_OPENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions";
const OLLAMA_VISION_MODEL = "gemma4:31b"; // vision-capable, and the smallest such model on the operator's Ollama cloud list (2026-09-22)

export type VisionProvider = "replicate" | "hf" | "gemini" | "ollama";
const VISION_PROVIDERS: readonly VisionProvider[] = ["replicate", "hf", "gemini", "ollama"];

/** The configured provider, or the default. An unknown PHOTO_ASSESS_PROVIDER value is reported, never silently mapped. */
function configuredProvider(): { provider: VisionProvider; unknown?: string } {
  const raw = process.env.PHOTO_ASSESS_PROVIDER;
  if (!raw) return { provider: "replicate" };
  return (VISION_PROVIDERS as readonly string[]).includes(raw)
    ? { provider: raw as VisionProvider }
    : { provider: "replicate", unknown: raw };
}

/** Which env var carries the key for a provider. */
const PROVIDER_KEY_VAR: Record<VisionProvider, string> = {
  replicate: "REPLICATE_API_KEY",
  hf: "HF_API_KEY",
  gemini: "GEMINI_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_AUTOMOTIVE_PROMPT = `You are an experienced auto mechanic at a tire and auto shop. Look at this photo and describe what you see in 2-3 sentences. If you see:
- Tire damage: identify wear pattern, sidewall damage, tread depth, or punctures.
- Brake issues: pad thickness, rotor condition, caliper concerns.
- General vehicle issues: leaks, rust, body damage.

Be specific. End with a single line: SERVICE_SUGGEST: <tire-replacement|tire-repair|brake-service|inspection-needed|unclear>. URGENCY: <immediate|soon|routine|unclear>.`;

export interface AnalyzePhotoOptions {
  /** Public URL to the photo. Must be reachable by Replicate/HF servers. */
  photoUrl: string;
  /** Optional custom prompt. Default is automotive-tuned. */
  prompt?: string;
  /** Provider override · "replicate" | "hf" | "gemini" | "ollama" */
  provider?: VisionProvider;
  /** Optional model override */
  model?: string;
  /** Optional timeout */
  timeoutMs?: number;
}

export interface AnalyzePhotoResult {
  ok: true;
  /** Raw text response from the model · 2-4 sentences typically */
  description: string;
  /** Parsed SERVICE_SUGGEST line if the model included it (best-effort) */
  serviceSuggest?: string;
  /** Parsed URGENCY line if present */
  urgency?: "immediate" | "soon" | "routine" | "unclear";
  /** Provider used · for cost attribution */
  source: VisionProvider;
  /** Model name used */
  modelName: string;
  /** Latency observed */
  latencyMs: number;
}

export interface AnalyzePhotoError {
  ok: false;
  error: string;
  reason: "disabled" | "no_provider" | "invalid_url" | "timeout" | "http_error" | "parse_error";
}

export type AnalyzePhotoResponse = AnalyzePhotoResult | AnalyzePhotoError;

async function isPhotoAssessEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("./featureFlags");
    return await isEnabled("photo_assess_enabled");
  } catch (err) {
    log.warn("Feature-flag lookup failed · failing closed (disabled)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function isValidPublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Reject localhost / private IPs · vision provider servers can't fetch them
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return false;
    return true;
  } catch {
    return false;
  }
}

function parseStructuredFields(description: string): {
  serviceSuggest?: string;
  urgency?: AnalyzePhotoResult["urgency"];
} {
  const serviceMatch = description.match(/SERVICE_SUGGEST:\s*([a-z-]+)/i);
  const urgencyMatch = description.match(/URGENCY:\s*(immediate|soon|routine|unclear)/i);
  return {
    serviceSuggest: serviceMatch?.[1]?.toLowerCase(),
    urgency: (urgencyMatch?.[1]?.toLowerCase() as AnalyzePhotoResult["urgency"]) ?? undefined,
  };
}

/**
 * Analyze a photo. Returns a structured response or an error.
 */
export async function analyzePhoto(opts: AnalyzePhotoOptions): Promise<AnalyzePhotoResponse> {
  if (!opts.photoUrl) {
    return { ok: false, error: "missing photoUrl", reason: "invalid_url" };
  }
  if (!isValidPublicUrl(opts.photoUrl)) {
    return { ok: false, error: "photoUrl is not a public HTTPS URL", reason: "invalid_url" };
  }
  if (!(await isPhotoAssessEnabled())) {
    return { ok: false, error: "feature flag off", reason: "disabled" };
  }

  const prompt = opts.prompt ?? DEFAULT_AUTOMOTIVE_PROMPT;
  const configured = configuredProvider();
  if (!opts.provider && configured.unknown) {
    return { ok: false, error: `PHOTO_ASSESS_PROVIDER=${configured.unknown} is not one of ${VISION_PROVIDERS.join("|")}`, reason: "no_provider" };
  }
  const provider = opts.provider ?? configured.provider;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (provider === "hf") {
    return analyzeViaHf({ photoUrl: opts.photoUrl, prompt, model: opts.model, timeoutMs });
  }
  if (provider === "gemini" || provider === "ollama") {
    return analyzeViaOpenAiCompatible({ provider, photoUrl: opts.photoUrl, prompt, model: opts.model, timeoutMs });
  }
  return analyzeViaReplicate({ photoUrl: opts.photoUrl, prompt, model: opts.model, timeoutMs });
}

// ─── Replicate backend ────────────────────────────────────────

async function analyzeViaReplicate(args: {
  photoUrl: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
}): Promise<AnalyzePhotoResponse> {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "REPLICATE_API_KEY not set", reason: "no_provider" };
  }

  const modelSlug = args.model ?? process.env.PHOTO_ASSESS_REPLICATE_MODEL ?? QWEN2_VL_MODEL;
  const version = process.env.PHOTO_ASSESS_REPLICATE_VERSION ?? QWEN2_VL_VERSION;

  const t0 = Date.now();
  try {
    const createResp = await withTimeout(
      fetch(`${REPLICATE_API_BASE}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
        },
        body: JSON.stringify({
          version,
          input: {
            media: args.photoUrl,
            prompt: args.prompt,
            max_new_tokens: 256,
            temperature: 0.2,
          },
        }),
      }),
      args.timeoutMs,
      "replicate-vision-create",
    );

    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "<no body>");
      return { ok: false, error: `Replicate HTTP ${createResp.status}: ${errText.slice(0, 200)}`, reason: "http_error" };
    }

    const data = (await createResp.json()) as {
      id: string;
      status: string;
      output?: string | string[];
      error?: string;
    };

    if (data.error) {
      return { ok: false, error: data.error, reason: "http_error" };
    }

    let description = normalizeOutput(data.output);
    if (description) {
      const { serviceSuggest, urgency } = parseStructuredFields(description);
      return {
        ok: true,
        description,
        serviceSuggest,
        urgency,
        source: "replicate",
        modelName: modelSlug,
        latencyMs: Date.now() - t0,
      };
    }

    // Poll fallback
    if (!data.id) {
      return { ok: false, error: "Replicate returned no prediction id", reason: "parse_error" };
    }
    const pollDeadline = Date.now() + args.timeoutMs;
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const pollResp = await fetch(`${REPLICATE_API_BASE}/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!pollResp.ok) continue;
      const pollData = (await pollResp.json()) as {
        status: string;
        output?: string | string[];
        error?: string;
      };
      if (pollData.error) return { ok: false, error: pollData.error, reason: "http_error" };
      if (pollData.status === "succeeded") {
        description = normalizeOutput(pollData.output);
        if (description) {
          const { serviceSuggest, urgency } = parseStructuredFields(description);
          return {
            ok: true,
            description,
            serviceSuggest,
            urgency,
            source: "replicate",
            modelName: modelSlug,
            latencyMs: Date.now() - t0,
          };
        }
      }
      if (pollData.status === "failed" || pollData.status === "canceled") {
        return { ok: false, error: `Replicate prediction ${pollData.status}`, reason: "http_error" };
      }
    }
    return { ok: false, error: "Replicate poll timeout", reason: "timeout" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, reason: msg.toLowerCase().includes("timeout") ? "timeout" : "http_error" };
  }
}

function normalizeOutput(output: string | string[] | undefined): string {
  if (!output) return "";
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) return output.join("").trim();
  return "";
}

// ─── HuggingFace backend (fallback) ───────────────────────────

async function analyzeViaHf(args: {
  photoUrl: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
}): Promise<AnalyzePhotoResponse> {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "HF_API_KEY not set", reason: "no_provider" };
  }

  const model = args.model ?? process.env.PHOTO_ASSESS_HF_MODEL ?? HF_LLAVA_MODEL;
  const t0 = Date.now();

  try {
    // Fetch the image, send as base64 (HF llava prefers inline)
    const imgResp = await withTimeout(fetch(args.photoUrl), 5000, "hf-vision-fetch");
    if (!imgResp.ok) {
      return { ok: false, error: `Photo URL fetch failed: ${imgResp.status}`, reason: "invalid_url" };
    }
    const buf = await imgResp.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    const mimeType = imgResp.headers.get("content-type") ?? "image/jpeg";

    const resp = await withTimeout(
      fetch(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {
            // LLaVA expects {image, text} pair · adjust per model card if mismatch
            image: `data:${mimeType};base64,${base64}`,
            text: args.prompt,
          },
          parameters: { max_new_tokens: 256 },
        }),
      }),
      args.timeoutMs,
      "hf-vision",
    );

    if (resp.status === 503) {
      return { ok: false, error: "HF model loading (503)", reason: "timeout" };
    }
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return { ok: false, error: `HF HTTP ${resp.status}: ${errBody.slice(0, 200)}`, reason: "http_error" };
    }

    const data = (await resp.json()) as
      | Array<{ generated_text?: string }>
      | { generated_text?: string }
      | { error?: string };

    let description = "";
    if (Array.isArray(data) && data[0]?.generated_text) {
      description = data[0].generated_text.trim();
    } else if ("generated_text" in data && (data as { generated_text?: string }).generated_text) {
      description = (data as { generated_text: string }).generated_text.trim();
    } else if ("error" in data) {
      return { ok: false, error: (data as { error: string }).error, reason: "http_error" };
    }

    if (!description) {
      return { ok: false, error: "HF returned no generated_text", reason: "parse_error" };
    }

    const { serviceSuggest, urgency } = parseStructuredFields(description);
    return {
      ok: true,
      description,
      serviceSuggest,
      urgency,
      source: "hf",
      modelName: model,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, reason: msg.toLowerCase().includes("timeout") ? "timeout" : "http_error" };
  }
}

// ─── OpenAI-compatible backends: Gemini (free tier) and Ollama cloud ──

/** Text of an OpenAI-style message content: a string, or the text parts of an array. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("")
      .trim();
  }
  return "";
}

async function analyzeViaOpenAiCompatible(args: {
  provider: "gemini" | "ollama";
  photoUrl: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
}): Promise<AnalyzePhotoResponse> {
  const keyVar = PROVIDER_KEY_VAR[args.provider];
  const apiKey = process.env[keyVar];
  if (!apiKey) {
    return { ok: false, error: `${keyVar} not set`, reason: "no_provider" };
  }
  const endpoint =
    args.provider === "gemini"
      ? GEMINI_OPENAI_ENDPOINT
      : `${(process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/[/]$/, "")}/v1/chat/completions`;
  const model =
    args.model ??
    (args.provider === "gemini"
      ? process.env.PHOTO_ASSESS_GEMINI_MODEL ?? GEMINI_VISION_MODEL
      : process.env.PHOTO_ASSESS_OLLAMA_MODEL ?? OLLAMA_VISION_MODEL);
  const t0 = Date.now();

  try {
    // The gateway's MMS URL may not be reachable from the provider (auth, or a
    // host they will not fetch), so the photo is fetched here and inlined.
    const imgResp = await withTimeout(fetch(args.photoUrl), 5000, `${args.provider}-vision-fetch`);
    if (!imgResp.ok) {
      return { ok: false, error: `Photo URL fetch failed: ${imgResp.status}`, reason: "invalid_url" };
    }
    const buf = await imgResp.arrayBuffer();
    const mimeType = (imgResp.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const dataUrl = `data:${mimeType};base64,${Buffer.from(buf).toString("base64")}`;

    const resp = await withTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: args.prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0.2,
          // Live probe 2026-09-22: gemini-2.5-flash spent a 400-token budget on
          // its hidden thinking and returned 66 visible characters, no
          // SERVICE_SUGGEST line. Thinking is off for this call (a photo needs a
          // description, not a chain of thought) and the visible budget is
          // sized for the 2-3 sentences + 2 structured lines the prompt asks for.
          ...(args.provider === "gemini"
            ? { max_tokens: 800, extra_body: { google: { thinking_config: { thinking_budget: 0 } } } }
            : { max_tokens: 600 }),
        }),
      }),
      args.timeoutMs,
      `${args.provider}-vision`,
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `${args.provider} ${resp.status}: ${body.slice(0, 200)}`, reason: "http_error" };
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: unknown } }>; model?: string };
    const description = contentText(data.choices?.[0]?.message?.content);
    if (!description) {
      return { ok: false, error: `${args.provider} returned no message content`, reason: "parse_error" };
    }

    const { serviceSuggest, urgency } = parseStructuredFields(description);
    return {
      ok: true,
      description,
      serviceSuggest,
      urgency,
      source: args.provider,
      modelName: data.model || model,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, reason: msg.toLowerCase().includes("timeout") ? "timeout" : "http_error" };
  }
}

// ─── Health probe ─────────────────────────────────────────────

export async function checkVisionHealth(): Promise<{
  enabled: boolean;
  provider: string;
  providerReachable: boolean;
  error?: string;
}> {
  const enabled = await isPhotoAssessEnabled();
  const configured = configuredProvider();
  if (configured.unknown) {
    return { enabled, provider: configured.unknown, providerReachable: false, error: `PHOTO_ASSESS_PROVIDER=${configured.unknown} is not one of ${VISION_PROVIDERS.join("|")}` };
  }
  const provider = configured.provider;
  const keyVar = PROVIDER_KEY_VAR[provider];
  const providerReachable = Boolean(process.env[keyVar]);
  return {
    enabled,
    provider,
    providerReachable,
    error: providerReachable ? undefined : `${keyVar} not set`,
  };
}

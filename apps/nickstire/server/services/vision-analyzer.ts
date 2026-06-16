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
  /** Provider override · "replicate" | "hf" */
  provider?: "replicate" | "hf";
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
  source: "replicate" | "hf";
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
  const provider =
    opts.provider ?? (process.env.PHOTO_ASSESS_PROVIDER as "replicate" | "hf" | undefined) ?? "replicate";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (provider === "hf") {
    return analyzeViaHf({ photoUrl: opts.photoUrl, prompt, model: opts.model, timeoutMs });
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

// ─── Health probe ─────────────────────────────────────────────

export async function checkVisionHealth(): Promise<{
  enabled: boolean;
  provider: string;
  providerReachable: boolean;
  error?: string;
}> {
  const enabled = await isPhotoAssessEnabled();
  const provider = (process.env.PHOTO_ASSESS_PROVIDER as "replicate" | "hf" | undefined) ?? "replicate";
  const providerReachable =
    provider === "replicate" ? Boolean(process.env.REPLICATE_API_KEY) : Boolean(process.env.HF_API_KEY);
  return {
    enabled,
    provider,
    providerReachable,
    error: providerReachable
      ? undefined
      : provider === "replicate"
        ? "REPLICATE_API_KEY not set"
        : "HF_API_KEY not set",
  };
}

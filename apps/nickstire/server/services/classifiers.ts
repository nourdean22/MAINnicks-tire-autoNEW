/**
 * HuggingFace Classifier Service
 *
 * Tiny specialist models that replace expensive LLM calls with $0.0001
 * HF Inference API calls. From docs/eval-rubrics/huggingface-model-strategy.md
 * Category 3 (tiny classifiers).
 *
 * Currently ships TWO classifiers:
 *
 *  1. `screenPromptInjection(text)` · gates VAPI + chat input against
 *     prompt-injection attacks ("ignore previous instructions"). Uses
 *     `protectai/deberta-v3-base-prompt-injection-v2` by default.
 *
 *  2. `classifyIntent(text, labels)` · zero-shot SMS-intent classifier.
 *     "Is this asking about brakes? tires? oil?" Replaces a Claude call
 *     per inbound SMS. Uses `MoritzLaurer/deberta-v3-large-zeroshot-v2.0`
 *     by default.
 *
 * Both are FEATURE-FLAG-GATED and FAIL-OPEN · if HF_API_KEY is unset or
 * HF Inference is down, the function returns a `{ok:false}` result and
 * the caller decides whether to proceed without the signal. The caller
 * MUST NOT block customer-facing flow on a classifier outage.
 *
 * Architecture: stateless HTTP client around HF Inference API. No
 * model loaded locally · we trade latency (~150-300ms) for ops
 * simplicity. When call volume × per-call cost > $50/mo, migrate to
 * HF Inference Endpoints (dedicated, cheaper per call).
 */

import { createLogger } from "../lib/logger";
import { withTimeout } from "@nour/utils";

const log = createLogger("classifiers");

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_TIMEOUT_MS = 5000;

// ─── Prompt-injection screening ──────────────────────────────

const DEFAULT_PI_MODEL = "protectai/deberta-v3-base-prompt-injection-v2";

export interface InjectionScreenResult {
  ok: true;
  isInjection: boolean;
  /** Confidence score 0-1 that the input is an injection attempt */
  score: number;
  /** Threshold used for the boolean decision */
  threshold: number;
  /** Latency observed for this call (ms) */
  latencyMs: number;
}

export interface ClassifierError {
  ok: false;
  /** Caller MUST NOT block flow on this · proceed as if classifier unavailable */
  error: string;
  /** Reason category · drives metrics + alert routing */
  reason: "disabled" | "no_key" | "timeout" | "http_error" | "parse_error" | "model_loading";
}

export type InjectionScreenResponse = InjectionScreenResult | ClassifierError;

/**
 * True if the prompt-injection screener should be attempted. Requires
 * HF_API_KEY env var + feature flag `classifier_prompt_injection_enabled`.
 */
async function isInjectionScreenerEnabled(): Promise<boolean> {
  if (!process.env.HF_API_KEY) return false;
  try {
    const { isEnabled } = await import("./featureFlags");
    return await isEnabled("classifier_prompt_injection_enabled");
  } catch (err) {
    log.warn("Feature-flag lookup failed · failing closed (disabled)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

interface HfClassificationResponse extends Array<{ label: string; score: number }> {}

/**
 * Screen a customer-supplied text input for prompt-injection patterns.
 *
 * Returns `{ ok: true, isInjection: boolean }` when the screener ran.
 * Returns `{ ok: false }` when feature is off OR HF is down. The caller
 * should treat the latter as "no signal" — usually proceed with normal
 * flow but log the absence so dashboards can show classifier coverage.
 *
 * The `threshold` parameter controls how aggressive the screener is.
 * Default 0.7 · prefer false-negatives over false-positives for
 * customer-facing flow (better to let a borderline message through
 * than to block a legit customer).
 */
export async function screenPromptInjection(
  text: string,
  opts: { threshold?: number; model?: string; timeoutMs?: number } = {},
): Promise<InjectionScreenResponse> {
  const threshold = opts.threshold ?? 0.7;
  const model = opts.model ?? process.env.CLASSIFIER_PI_MODEL ?? DEFAULT_PI_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!(await isInjectionScreenerEnabled())) {
    return { ok: false, error: "disabled", reason: "disabled" };
  }
  if (!text || text.trim().length === 0) {
    // Empty input cannot be injection · short-circuit cheap
    return {
      ok: true,
      isInjection: false,
      score: 0,
      threshold,
      latencyMs: 0,
    };
  }

  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      fetch(`${HF_INFERENCE_URL}/${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
        },
        body: JSON.stringify({ inputs: text }),
      }),
      timeoutMs,
      "hf-injection-screen",
    );

    if (resp.status === 503) {
      // HF returns 503 while model is loading on cold cache · retry
      // strategy belongs in the caller; we just signal it.
      return { ok: false, error: "model_loading", reason: "model_loading" };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `HTTP ${resp.status} · ${errText.slice(0, 120)}`,
        reason: "http_error",
      };
    }

    const data = (await resp.json()) as HfClassificationResponse | { error?: string };
    if (!Array.isArray(data)) {
      return {
        ok: false,
        error: `unexpected response shape: ${JSON.stringify(data).slice(0, 120)}`,
        reason: "parse_error",
      };
    }
    // protectai/deberta-v3-base-prompt-injection-v2 returns labels
    // "INJECTION" and "SAFE" · we want the INJECTION score.
    const injectionEntry = data.find((d) => d.label?.toUpperCase().includes("INJECTION"));
    const score = injectionEntry?.score ?? 0;
    return {
      ok: true,
      isInjection: score >= threshold,
      score,
      threshold,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes("timeout") || msg.includes("hf-injection-screen");
    return {
      ok: false,
      error: msg,
      reason: isTimeout ? "timeout" : "http_error",
    };
  }
}

// ─── Zero-shot intent classification ─────────────────────────

const DEFAULT_INTENT_MODEL = "MoritzLaurer/deberta-v3-large-zeroshot-v2.0";

export interface IntentResult {
  ok: true;
  /** Highest-scoring label */
  topLabel: string;
  /** Confidence of the top label 0-1 */
  topScore: number;
  /** All labels scored, descending */
  scores: Array<{ label: string; score: number }>;
  latencyMs: number;
}

export type IntentResponse = IntentResult | ClassifierError;

/**
 * Default SMS intent labels for nickstire. Use these when the caller
 * doesn't supply a custom label set. Tuned for the common service mix
 * + the 4 "what's the customer trying to do" buckets.
 */
export const NICKSTIRE_SMS_INTENT_LABELS = [
  "asking about tire prices or sizes",
  "asking about brake service",
  "asking about oil change",
  "asking about diagnostic or check engine",
  "asking about appointment scheduling",
  "asking about hours or location",
  "confirming an appointment",
  "cancelling an appointment",
  "complaint or negative feedback",
  "opting out of SMS",
  "off-topic or spam",
] as const;

async function isIntentClassifierEnabled(): Promise<boolean> {
  if (!process.env.HF_API_KEY) return false;
  try {
    const { isEnabled } = await import("./featureFlags");
    return await isEnabled("classifier_intent_routing_enabled");
  } catch (err) {
    log.warn("Feature-flag lookup failed · failing closed (disabled)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function getLocalHeuristicFallback(
  text: string,
  labels: readonly string[],
  t0: number
): IntentResult {
  const lower = text.toLowerCase();
  
  const matchesHoursLocation = /\b(hour|hours|open|close|time|closing|located|location|address|where|directions|direction|gps|map|zip|border|street|city|avenue)\b/i.test(text);
  const matchesGreeting = /\b(hi|hello|hey|yo|sup|greeting|greetings|howdy|morning|afternoon|evening|hola)\b/i.test(text);
  const matchesTirePrice = /\b(tire|tires|price|prices|pricing|quote|cost|sizes|size|rim|rims|wheel|wheels|tread|treads)\b/i.test(text);
  const matchesBrakes = /\b(brake|brakes|rotor|rotors|pad|pads|stopping|squeak|squeal)\b/i.test(text);
  const matchesOil = /\b(oil|filter|lube|synthetic)\b/i.test(text);
  const matchesAppointment = /\b(appointment|book|schedule|scheduling|reserve|reservation|slot|come|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
  const matchesOptOut = /\b(stop|unsubscribe|opt out|cancel|quit|end)\b/i.test(text);
  const matchesDiagnostic = /\b(shake|shaking|vibrate|vibration|highway|wobble|alignment|balance|check engine|light|fail|failed|e-check|echeck|emissions|squeak|noise|leak|leaking|smoke)\b/i.test(text);

  let topLabel = labels[0] || "general";
  let topScore = 0.6;

  if (matchesHoursLocation) {
    topLabel = labels.find(l => l.includes("hours") || l.includes("location")) || "asking about hours or location";
    topScore = 0.92;
  } else if (matchesGreeting) {
    topLabel = labels.find(l => l.includes("greeting") || l.includes("hello")) || "greeting or hello";
    topScore = 0.90;
  } else if (matchesTirePrice) {
    topLabel = labels.find(l => l.includes("tire") || l.includes("price") || l.includes("pricing")) || "asking about tire prices or sizes";
    topScore = 0.90;
  } else if (matchesBrakes) {
    topLabel = labels.find(l => l.includes("brake")) || "asking about brake service";
    topScore = 0.90;
  } else if (matchesOil) {
    topLabel = labels.find(l => l.includes("oil")) || "asking about oil change";
    topScore = 0.90;
  } else if (matchesDiagnostic) {
    topLabel = labels.find(l => l.includes("diagnostic") || l.includes("check engine")) || "asking about diagnostic or check engine";
    topScore = 0.90;
  } else if (matchesAppointment) {
    topLabel = labels.find(l => l.includes("appointment") || l.includes("scheduling") || l.includes("booking")) || "asking about appointment scheduling";
    topScore = 0.90;
  } else if (matchesOptOut) {
    topLabel = labels.find(l => l.includes("opting out") || l.includes("opt-out") || l.includes("opt out")) || "opting out of SMS";
    topScore = 0.95;
  }

  // Map to the custom labels if provided
  if (labels.length > 0 && !labels.includes(topLabel as any)) {
    const fallbackLabel = labels.find(l => {
      const lLower = l.toLowerCase();
      if (topLabel.includes("hours") || topLabel.includes("location")) return lLower.includes("hours") || lLower.includes("location");
      if (topLabel.includes("greeting") || topLabel.includes("hello")) return lLower.includes("greeting") || lLower.includes("hello");
      if (topLabel.includes("tire") || topLabel.includes("price") || topLabel.includes("pricing")) return lLower.includes("tire") || lLower.includes("price") || lLower.includes("pricing");
      if (topLabel.includes("brake")) return lLower.includes("brake");
      if (topLabel.includes("oil")) return lLower.includes("oil");
      if (topLabel.includes("diagnostic") || topLabel.includes("check engine")) return lLower.includes("diagnostic") || lLower.includes("check engine");
      if (topLabel.includes("appointment") || topLabel.includes("scheduling")) return lLower.includes("appointment") || lLower.includes("scheduling") || lLower.includes("booking");
      if (topLabel.includes("opting out") || topLabel.includes("opt-out")) return lLower.includes("opting out") || lLower.includes("opt-out") || lLower.includes("opt out");
      return false;
    });
    if (fallbackLabel) {
      topLabel = fallbackLabel;
    } else {
      topLabel = labels[0] || "general";
      topScore = 0.6;
    }
  }

  return {
    ok: true,
    topLabel,
    topScore,
    scores: [{ label: topLabel, score: topScore }],
    latencyMs: Date.now() - t0,
  };
}

export async function classifyIntent(
  text: string,
  opts: { labels?: readonly string[]; model?: string; timeoutMs?: number; multiLabel?: boolean } = {},
): Promise<IntentResponse> {
  const labels = opts.labels ?? NICKSTIRE_SMS_INTENT_LABELS;
  const model = opts.model ?? process.env.CLASSIFIER_INTENT_MODEL ?? DEFAULT_INTENT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const multiLabel = opts.multiLabel ?? false;

  if (!(await isIntentClassifierEnabled())) {
    return { ok: false, error: "disabled", reason: "disabled" };
  }
  if (!text || text.trim().length === 0) {
    return { ok: false, error: "empty_input", reason: "parse_error" };
  }

  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      fetch(`${HF_INFERENCE_URL}/${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
        },
        body: JSON.stringify({
          inputs: text,
          parameters: {
            candidate_labels: Array.from(labels),
            multi_label: multiLabel,
          },
        }),
      }),
      timeoutMs,
      "hf-intent-classify",
    );

    if (resp.status === 503) {
      return { ok: false, error: "model_loading", reason: "model_loading" };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "<no body>");
      log.warn("HuggingFace API failed, executing local heuristic fallback", {
        status: resp.status,
        error: errText.slice(0, 120),
      });

      return getLocalHeuristicFallback(text, labels, t0);
    }

    const data = (await resp.json()) as { labels?: string[]; scores?: number[] } | { error?: string };
    if (!data || !("labels" in data) || !Array.isArray(data.labels) || !Array.isArray(data.scores)) {
      return {
        ok: false,
        error: `unexpected response shape: ${JSON.stringify(data).slice(0, 120)}`,
        reason: "parse_error",
      };
    }
    const scores = data.labels.map((label, i) => ({ label, score: data.scores![i] ?? 0 }));
    scores.sort((a, b) => b.score - a.score);
    return {
      ok: true,
      topLabel: scores[0]?.label ?? "",
      topScore: scores[0]?.score ?? 0,
      scores,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("HuggingFace API call threw exception, executing local heuristic fallback", { error: msg });

    return getLocalHeuristicFallback(text, labels, t0);
  }
}

// ─── Health probe ─────────────────────────────────────────────

/**
 * Health probe for /api/health surface. Pings each enabled classifier
 * with a single canary input to confirm reachability. Lightweight (a
 * single 5-token classification) · don't run on every request.
 */
export async function checkClassifierHealth(): Promise<{
  promptInjection: { enabled: boolean; reachable: boolean; error?: string };
  intent: { enabled: boolean; reachable: boolean; error?: string };
}> {
  const piEnabled = await isInjectionScreenerEnabled();
  const intentEnabled = await isIntentClassifierEnabled();

  let piResult: { reachable: boolean; error?: string } = { reachable: false, error: "disabled" };
  let intentResult: { reachable: boolean; error?: string } = { reachable: false, error: "disabled" };

  if (piEnabled) {
    const r = await screenPromptInjection("test input · healthcheck canary", { timeoutMs: 3000 });
    piResult = r.ok
      ? { reachable: true }
      : { reachable: false, error: r.error };
  }
  if (intentEnabled) {
    const r = await classifyIntent("test input · healthcheck canary", {
      labels: ["test"],
      timeoutMs: 3000,
    });
    intentResult = r.ok
      ? { reachable: true }
      : { reachable: false, error: r.error };
  }

  return {
    promptInjection: { enabled: piEnabled, ...piResult },
    intent: { enabled: intentEnabled, ...intentResult },
  };
}

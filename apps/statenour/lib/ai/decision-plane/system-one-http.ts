import { z } from "zod";
import type {
  DecisionAnswer,
  DecisionBackend,
  DecisionQuestions,
  DecisionRequest,
  DecisionResult,
  DecisionEntry,
} from "./types";

const ProbabilitySchema = z.number().finite().min(0).max(1);
const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: ProbabilitySchema,
});
const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  confidence: ProbabilitySchema,
  probabilities: z.record(z.string(), ProbabilitySchema),
});
const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().finite(),
  confidence: ProbabilitySchema,
  legend: z.record(z.string(), z.unknown()),
  probabilities: z.record(z.string(), ProbabilitySchema),
});
const AnswerSchema = z.discriminatedUnion("type", [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);
const SystemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export interface SystemOneHttpBackendConfig {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  /**
   * Explicit operator attestation that raw decision state may leave the
   * private network. Never inferred merely from an API key being present.
   */
  allowExternalState?: boolean;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // RFC 6598 shared address space; used by Tailscale-style private overlays.
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function isPrivateDecisionEndpoint(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    isPrivateIpv4(host)
  );
}

function normalizeEndpoint(config: SystemOneHttpBackendConfig): {
  endpoint: string;
  trust: "private" | "external";
} {
  const url = new URL(config.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Decision backend ${config.id} must use http(s)`);
  }
  if (url.username || url.password) {
    throw new Error(`Decision backend ${config.id} URL must not embed credentials`);
  }

  const privateEndpoint = isPrivateDecisionEndpoint(url.toString());
  if (!privateEndpoint && !config.allowExternalState) {
    throw new Error(
      `Decision backend ${config.id} is public; set NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE=1 explicitly before sending raw state`,
    );
  }

  const base = url.toString().replace(/\/+$/, "");
  return {
    endpoint: `${base}/v1/systemone`,
    trust: privateEndpoint ? "private" : "external",
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function assertDistribution(
  probabilities: Record<string, number>,
  expectedKeys: readonly string[],
  label: string,
): void {
  for (const key of expectedKeys) {
    if (!(key in probabilities)) {
      throw new Error(`Decision backend omitted probability ${label}.${key}`);
    }
  }
  const extra = Object.keys(probabilities).filter((key) => !expectedKeys.includes(key));
  if (extra.length > 0) {
    throw new Error(`Decision backend returned unexpected probabilities for ${label}: ${extra.join(", ")}`);
  }
  const total = sum(Object.values(probabilities));
  if (Math.abs(total - 1) > 0.02) {
    throw new Error(`Decision backend probabilities for ${label} sum to ${total.toFixed(4)}, not 1`);
  }
}

function assertAnswerMatchesQuestion(
  key: string,
  question: DecisionQuestions[string],
  answer: DecisionAnswer,
): void {
  if (question.type !== answer.type) {
    throw new Error(
      `Decision backend type mismatch for ${key}: expected ${question.type}, got ${answer.type}`,
    );
  }

  if (question.type === "choice" && answer.type === "choice") {
    const keys = Object.keys(question.criteria);
    if (!keys.includes(answer.choice)) {
      throw new Error(`Decision backend chose unknown option ${key}.${answer.choice}`);
    }
    assertDistribution(answer.probabilities, keys, key);
    return;
  }

  if (question.type === "score" && answer.type === "score") {
    const keys = question.criteria.map((_, index) => String(index));
    if (answer.score < 0 || answer.score > question.criteria.length - 1) {
      throw new Error(`Decision backend score for ${key} is outside its rubric`);
    }
    assertDistribution(answer.probabilities, keys, key);
  }
}

function validateResponse<Q extends DecisionQuestions>(
  request: DecisionRequest<Q>,
  raw: unknown,
): {
  model: string;
  answers: { [K in keyof Q]: DecisionAnswer };
  usage: { input_tokens: number; output_tokens: number };
} {
  const parsed = SystemOneResponseSchema.parse(raw);
  const questionKeys = Object.keys(request.questions);
  if (questionKeys.length === 0) {
    throw new Error("Decision request requires at least one question");
  }

  for (const key of questionKeys) {
    const answer = parsed.answers[key];
    if (!answer) throw new Error(`Decision backend omitted answer ${key}`);
    assertAnswerMatchesQuestion(key, request.questions[key]!, answer);
  }
  const extras = Object.keys(parsed.answers).filter((key) => !(key in request.questions));
  if (extras.length > 0) {
    throw new Error(`Decision backend returned unknown answers: ${extras.join(", ")}`);
  }

  return parsed as unknown as {
    model: string;
    answers: { [K in keyof Q]: DecisionAnswer };
    usage: { input_tokens: number; output_tokens: number };
  };
}

export class SystemOneHttpBackend implements DecisionBackend {
  readonly id: string;
  readonly trust: "private" | "external";
  readonly #endpoint: string;
  readonly #model: string;
  readonly #apiKey?: string;
  readonly #timeoutMs: number;

  constructor(config: SystemOneHttpBackendConfig) {
    this.id = config.id;
    const normalized = normalizeEndpoint(config);
    this.trust = normalized.trust;
    this.#endpoint = normalized.endpoint;
    this.#model = config.model;
    this.#apiKey = config.apiKey;
    this.#timeoutMs = Math.max(250, Math.min(config.timeoutMs ?? 10_000, 30_000));
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
        },
        body: JSON.stringify({
          state: request.state,
          questions: request.questions,
          model: request.model ?? this.#model,
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(
          `Decision backend ${this.id} returned HTTP ${response.status}: ${body || response.statusText}`,
        );
      }

      const raw = await response.json();
      const parsed = validateResponse(request, raw);
      return {
        backend: this.id,
        model: parsed.model,
        answers: parsed.answers as DecisionResult<Q>["answers"],
        usage: {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
        },
        latencyMs: Math.round((performance.now() - started) * 10) / 10,
        requestId: response.headers.get("x-typesafe-request-id") ?? undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The generic Decision Plane primitive. It adds no policy authority: callers
 * decide how (or whether) a probabilistic answer can influence production.
 */
export async function evaluateDecisionPlane<Q extends DecisionQuestions>(
  backend: DecisionBackend,
  input: DecisionRequest<Q>,
): Promise<DecisionResult<Q>> {
  return backend.evaluate(input);
}

// Compile-time-only guard that keeps DecisionEntry JSON-compatible.
const _decisionEntryTypeGuard: DecisionEntry | undefined = undefined;
void _decisionEntryTypeGuard;

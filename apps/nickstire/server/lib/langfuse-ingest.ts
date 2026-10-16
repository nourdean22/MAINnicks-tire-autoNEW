/**
 * Langfuse tracing for nickstire's AI calls, over the public ingestion API.
 *
 * No Langfuse or OpenTelemetry package (the worktree is junctioned; nothing is
 * installed): one `fetch` to `POST {LANGFUSE_BASE_URL}/api/public/ingestion`
 * with basic auth public:secret and a batch of `trace-create` +
 * `generation-create` events, which is the whole wire contract.
 *
 * Contract with callers:
 *   - never throws into the caller, never blocks it: `traceGeneration()` queues
 *     and returns; a timer flushes one HTTP batch every FLUSH_INTERVAL_MS;
 *   - the queue is bounded (MAX_QUEUE); overflow is counted as dropped, never
 *     grown without limit;
 *   - keys unset = tracing OFF: nothing is queued, status says configured:false
 *     and /api/system/observability-status reads UNKNOWN, never HEALTHY;
 *   - masking is done HERE, not at call sites: every input/output excerpt goes
 *     through redactCallerText (phones, names, addresses, emails, VINs) and is
 *     capped, and the prompt is sent only as a sha256. A call site cannot
 *     forget to mask because it never hands over raw text that is sent raw;
 *   - a call marked `private: true` (receptionist private mode and any other
 *     do-not-record lane) is not traced; it is counted under skipped.private.
 *
 * Receipts for the status route: last ingestion time, result, HTTP status and
 * error, batches sent/failed, events traced/dropped/skipped.
 *
 * Env (set on the nickstire Railway service; unset today):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (default
 *   https://us.cloud.langfuse.com, the region statenour uses).
 */
import { createHash, randomUUID } from "node:crypto";
import { createLogger } from "./logger";
import { redactCallerText } from "../services/callerTextRedaction";
import { resolveNickDeployIdentity } from "./deployIdentity";

const log = createLogger("langfuse");

export const DEFAULT_LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com";
export const FLUSH_INTERVAL_MS = 3_000;
export const MAX_QUEUE = 200;
export const MAX_BATCH = 50;
/** Excerpt cap for masked input/output text. Langfuse gets a glimpse, not the transcript. */
export const EXCERPT_CHARS = 400;

export interface TraceGenerationInput {
  /** Trace name. Convention: `<lane>:<site>`, e.g. "receptionist:nickgpt-client". */
  name: string;
  /** Where in the code the provider was called, e.g. "_core/llm.ts". */
  site: string;
  model: string;
  /** Prompt text (system + messages, any shape). Sent as sha256 + masked excerpt of the last user turn. */
  promptText: string;
  /** The last user-authored text, masked before it leaves. */
  input?: string | null;
  /** Model output text, masked before it leaves. */
  output?: string | null;
  usage?: { promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null } | null;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
  /** Receptionist private mode and other do-not-record lanes: counted, never sent. */
  private?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LangfuseIngestStatus {
  configured: boolean;
  baseUrl: string | null;
  queued: number;
  batchesSent: number;
  batchesFailed: number;
  eventsTraced: number;
  eventsDropped: number;
  skipped: { private: number };
  lastIngestAt: string | null;
  lastIngestOk: boolean | null;
  lastHttpStatus: number | null;
  lastError: string | null;
}

type IngestEvent = { id: string; type: "trace-create" | "generation-create"; timestamp: string; body: Record<string, unknown> };

const state = {
  queue: [] as IngestEvent[],
  timer: null as ReturnType<typeof setTimeout> | null,
  inflight: null as Promise<FlushResult> | null,
  batchesSent: 0,
  batchesFailed: 0,
  eventsTraced: 0,
  eventsDropped: 0,
  skippedPrivate: 0,
  lastIngestAt: null as string | null,
  lastIngestOk: null as boolean | null,
  lastHttpStatus: null as number | null,
  lastError: null as string | null,
};

export function langfuseConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() || null;
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() || null;
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || DEFAULT_LANGFUSE_BASE_URL).replace(/\/$/, "");
  return { configured: Boolean(publicKey && secretKey), publicKey, secretKey, baseUrl };
}

export function isLangfuseConfigured(): boolean {
  return langfuseConfig().configured;
}

/** Masked, capped excerpt. Empty input stays empty (never a fabricated string). */
export function maskExcerpt(text: string | null | undefined): string {
  if (!text) return "";
  return redactCallerText(text, EXCERPT_CHARS);
}

export function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Queue one traced generation. Synchronous, never throws, never awaits. Returns
 * "queued", "skipped_private", "off" (keys unset) or "dropped" (queue full).
 */
export function traceGeneration(g: TraceGenerationInput): "queued" | "skipped_private" | "off" | "dropped" {
  try {
    if (g.private) {
      state.skippedPrivate += 1;
      return "skipped_private";
    }
    if (!langfuseConfig().configured) return "off";
    if (state.queue.length + 2 > MAX_QUEUE) {
      state.eventsDropped += 1;
      return "dropped";
    }
    const now = new Date().toISOString();
    const traceId = randomUUID();
    const identity = resolveNickDeployIdentity(process.env);
    const usage = g.usage
      ? {
          input: g.usage.promptTokens ?? undefined,
          output: g.usage.completionTokens ?? undefined,
          total: g.usage.totalTokens ?? undefined,
        }
      : undefined;
    const metadata = {
      site: g.site,
      promptSha256: promptHash(g.promptText),
      commit: identity.commitShort ?? "unknown",
      ...(g.metadata ?? {}),
    };
    state.queue.push({
      id: randomUUID(),
      type: "trace-create",
      timestamp: now,
      body: {
        id: traceId,
        name: g.name,
        timestamp: now,
        release: identity.commit ?? undefined,
        environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development",
        tags: ["nickstire", g.ok ? "ok" : "error"],
        input: maskExcerpt(g.input),
        output: maskExcerpt(g.output),
        metadata,
      },
    });
    state.queue.push({
      id: randomUUID(),
      type: "generation-create",
      timestamp: now,
      body: {
        id: randomUUID(),
        traceId,
        name: g.name,
        model: g.model,
        startTime: new Date(Date.now() - Math.max(0, g.latencyMs)).toISOString(),
        endTime: now,
        input: maskExcerpt(g.input),
        output: maskExcerpt(g.output),
        usage,
        level: g.ok ? "DEFAULT" : "ERROR",
        // Provider errors can echo the request body: masked like any other text.
        statusMessage: g.ok ? undefined : maskExcerpt(g.error ?? "error").slice(0, 300),
        metadata,
      },
    });
    state.eventsTraced += 1;
    scheduleFlush();
    return "queued";
  } catch (err) {
    // Tracing must never reach the caller.
    state.lastError = `trace: ${err instanceof Error ? err.message : String(err)}`;
    return "dropped";
  }
}

type Json = Record<string, any>;

function partsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: Json) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Last user-authored text of an OpenAI / Ollama / Anthropic messages array, or a Gemini `contents` array. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return typeof messages === "string" ? messages : "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Json;
    if (m?.role === "user") return m.parts ? partsText(m.parts) : partsText(m.content);
  }
  return "";
}

/** Output text of the provider response shapes nickstire calls (OpenAI-compatible, Ollama /api/chat, Anthropic, Gemini). */
export function responseText(json: unknown): string {
  const d = (json ?? {}) as Json;
  return (
    partsText(d.choices?.[0]?.message?.content) ||
    partsText(d.message?.content) ||
    partsText(d.content) ||
    partsText(d.candidates?.[0]?.content?.parts) ||
    ""
  );
}

function responseUsage(json: unknown): TraceGenerationInput["usage"] {
  const d = (json ?? {}) as Json;
  const u = d.usage ?? {};
  const g = d.usageMetadata ?? {};
  const promptTokens = u.prompt_tokens ?? u.input_tokens ?? g.promptTokenCount ?? d.prompt_eval_count ?? null;
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? g.candidatesTokenCount ?? d.eval_count ?? null;
  const totalTokens = u.total_tokens ?? g.totalTokenCount ?? null;
  return promptTokens === null && completionTokens === null && totalTokens === null
    ? null
    : { promptTokens, completionTokens, totalTokens };
}

/**
 * One call per provider round-trip, at every AI call site (the gate test
 * `langfuseTraceGate.test.ts` fails when a provider URL appears in a file that
 * never calls this or traceGeneration). Pass the request messages and the parsed
 * response (or `outputText`); extraction, masking and hashing happen here.
 */
export function traceChat(o: {
  name: string;
  site: string;
  model: string | null | undefined;
  messages: unknown;
  response?: unknown;
  outputText?: string | null;
  startedAt: number;
  ok: boolean;
  error?: unknown;
  private?: boolean;
}): void {
  try {
    traceGeneration({
      name: o.name,
      site: o.site,
      model: o.model || "unknown",
      promptText: typeof o.messages === "string" ? o.messages : JSON.stringify(o.messages ?? null),
      input: lastUserText(o.messages),
      output: o.outputText ?? responseText(o.response),
      usage: responseUsage(o.response),
      latencyMs: Date.now() - o.startedAt,
      ok: o.ok,
      error: o.error === undefined || o.error === null ? null : o.error instanceof Error ? o.error.message : String(o.error),
      private: o.private,
    });
  } catch {
    // Tracing must never reach the caller (JSON.stringify of a cyclic body, etc.).
  }
}

function scheduleFlush(): void {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushLangfuse();
  }, FLUSH_INTERVAL_MS);
  state.timer.unref?.();
}

export interface FlushResult {
  ok: boolean;
  sent: number;
  httpStatus: number | null;
  error: string | null;
  /** false when nothing was queued or keys are unset. */
  attempted: boolean;
}

/**
 * Send up to MAX_BATCH queued events now. Used by the timer, the probe and
 * shutdown. Concurrent callers share one in-flight request.
 */
export function flushLangfuse(fetchImpl: typeof fetch = fetch): Promise<FlushResult> {
  if (state.inflight) return state.inflight;
  state.inflight = doFlush(fetchImpl).finally(() => {
    state.inflight = null;
    if (state.queue.length > 0) scheduleFlush();
  });
  return state.inflight;
}

async function doFlush(fetchImpl: typeof fetch): Promise<FlushResult> {
  const cfg = langfuseConfig();
  if (!cfg.configured) return { ok: false, sent: 0, httpStatus: null, error: "keys unset", attempted: false };
  if (state.queue.length === 0) return { ok: true, sent: 0, httpStatus: null, error: null, attempted: false };
  const batch = state.queue.splice(0, MAX_BATCH);
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64")}`,
      },
      body: JSON.stringify({ batch }),
      signal: AbortSignal.timeout(10_000),
    });
    state.lastIngestAt = at;
    state.lastHttpStatus = res.status;
    // Langfuse answers 207 with per-event `errors` when it rejects events inside
    // an accepted batch: a 2xx alone is not an ack of every event.
    const rejected = res.ok ? await rejectedEvents(res) : 0;
    if (res.ok && rejected > 0) {
      state.batchesFailed += 1;
      state.lastIngestOk = false;
      state.lastError = `HTTP ${res.status}: ${rejected} of ${batch.length} event(s) rejected`;
      log.warn("langfuse ingestion partly rejected", { status: res.status, rejected });
      return { ok: false, sent: batch.length - rejected, httpStatus: res.status, error: state.lastError, attempted: true };
    }
    if (res.ok) {
      state.batchesSent += 1;
      state.lastIngestOk = true;
      state.lastError = null;
      return { ok: true, sent: batch.length, httpStatus: res.status, error: null, attempted: true };
    }
    const text = await res.text().catch(() => "");
    state.batchesFailed += 1;
    state.lastIngestOk = false;
    state.lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    log.warn("langfuse ingestion rejected", { status: res.status, dropped: batch.length });
    return { ok: false, sent: 0, httpStatus: res.status, error: state.lastError, attempted: true };
  } catch (err) {
    state.lastIngestAt = at;
    state.lastHttpStatus = null;
    state.batchesFailed += 1;
    state.lastIngestOk = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    log.warn("langfuse ingestion failed", { error: state.lastError, dropped: batch.length });
    return { ok: false, sent: 0, httpStatus: null, error: state.lastError, attempted: true };
  }
}

async function rejectedEvents(res: Response): Promise<number> {
  try {
    const body = (await res.json()) as { errors?: unknown };
    return Array.isArray(body?.errors) ? body.errors.length : 0;
  } catch {
    return 0; // an empty or non-JSON 2xx body carries no per-event verdict
  }
}

export function getLangfuseStatus(): LangfuseIngestStatus {
  const cfg = langfuseConfig();
  return {
    configured: cfg.configured,
    baseUrl: cfg.configured ? cfg.baseUrl : null,
    queued: state.queue.length,
    batchesSent: state.batchesSent,
    batchesFailed: state.batchesFailed,
    eventsTraced: state.eventsTraced,
    eventsDropped: state.eventsDropped,
    skipped: { private: state.skippedPrivate },
    lastIngestAt: state.lastIngestAt,
    lastIngestOk: state.lastIngestOk,
    lastHttpStatus: state.lastHttpStatus,
    lastError: state.lastError,
  };
}

/** Test seam: forget every counter and queued event. */
export function __resetLangfuseForTests(): void {
  if (state.timer) clearTimeout(state.timer);
  state.queue = [];
  state.timer = null;
  state.inflight = null;
  state.batchesSent = 0;
  state.batchesFailed = 0;
  state.eventsTraced = 0;
  state.eventsDropped = 0;
  state.skippedPrivate = 0;
  state.lastIngestAt = null;
  state.lastIngestOk = null;
  state.lastHttpStatus = null;
  state.lastError = null;
}

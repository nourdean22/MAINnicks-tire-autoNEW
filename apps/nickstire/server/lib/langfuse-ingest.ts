/**
 * Langfuse tracing for nickstire's AI calls, over OTLP/HTTP (JSON encoding).
 *
 * No Langfuse or OpenTelemetry package (the worktree is junctioned; nothing is
 * installed): one `fetch` to `POST {LANGFUSE_BASE_URL}/api/public/otel/v1/traces`
 * with basic auth public:secret and the header `x-langfuse-ingestion-version: 4`.
 * Each traced generation is two spans of one OTLP trace: a root span (the Langfuse
 * trace) and a child span typed `generation`. Attribute names are the ones
 * https://langfuse.com/integrations/native/opentelemetry documents (read 2026-10-17).
 *
 * Why not the legacy `POST /api/public/ingestion` this file used before: from
 * 2026-11-16 Langfuse Cloud is v4-only and removes it for trace and observation
 * events (https://langfuse.com/faq/all/deprecated-api-migration). Pinned by
 * `langfuseOtlp.test.ts`, which fails if the old URL comes back.
 *
 * Contract with callers:
 *   - never throws into the caller, never blocks it: `traceGeneration()` queues
 *     and returns; a timer flushes one HTTP batch every FLUSH_INTERVAL_MS;
 *   - the queue is bounded (MAX_QUEUE); overflow is counted as dropped, never
 *     grown without limit;
 *   - keys unset = tracing OFF: nothing is queued, status says configured:false
 *     and /api/system/observability-status reads UNKNOWN, never HEALTHY;
 *   - NO free text by default (review P2-1, 2026-10-17): Langfuse is a third
 *     party and the masker misses names in structured or unintroduced text
 *     ("Customer name: Maria Lopez", "Lopez, Maria 44101"). A default trace
 *     carries model, prompt sha256, input/output character counts, tokens,
 *     latency and an error CLASS ("HTTP 503", "TimeoutError"), never a message.
 *     `excerpt: true` opts one call in to masked, capped excerpts; only sites
 *     whose text holds no customer data may set it (today: the observability
 *     probe's synthetic ping/pong, nothing else);
 *   - a call marked `private: true` (receptionist private mode and any other
 *     do-not-record lane) is not traced; it is counted under skipped.private.
 *
 * Receipts for the status route: last ingestion time, result, HTTP status and
 * error, batches sent/failed, events traced/dropped/skipped.
 *
 * Env (set on the nickstire Railway service by the operator on 2026-10-17):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (default
 *   https://us.cloud.langfuse.com, the region statenour uses).
 */
import { createHash, randomBytes } from "node:crypto";
import { createLogger } from "./logger";
import { redactCallerText } from "../services/callerTextRedaction";
import { resolveNickDeployIdentity } from "./deployIdentity";

const log = createLogger("langfuse");

const DEFAULT_LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com";
const FLUSH_INTERVAL_MS = 3_000;
const MAX_QUEUE = 200;
const MAX_BATCH = 50;
/** Excerpt cap for masked input/output text. Langfuse gets a glimpse, not the transcript. */
const EXCERPT_CHARS = 400;

export interface TraceGenerationInput {
  /** Trace name. Convention: `<lane>:<site>`, e.g. "receptionist:nickgpt-client". */
  name: string;
  /** Where in the code the provider was called, e.g. "_core/llm.ts". */
  site: string;
  model: string;
  /** Prompt text (system + messages, any shape). Sent as sha256 + masked excerpt of the last user turn. */
  promptText: string;
  /** The last user-authored text. Only its length leaves unless `excerpt` is true. */
  input?: string | null;
  /** Model output text. Only its length leaves unless `excerpt` is true. */
  output?: string | null;
  /** Opt in to masked, capped input/output excerpts. Only for text with no customer data. */
  excerpt?: boolean;
  usage?: { promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null } | null;
  latencyMs: number;
  ok: boolean;
  /** Error CLASS only (errorClass()), never a provider message: messages can echo the request. */
  error?: string | null;
  /** Receptionist private mode and other do-not-record lanes: counted, never sent. */
  private?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
  /** Caller-chosen trace id (the probe uses it to confirm its own batch was accepted); normalized to 32 hex. */
  traceId?: string;
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

// OTLP/HTTP JSON (https://opentelemetry.io/docs/specs/otlp/, read 2026-10-17): lowerCamelCase keys,
// trace/span ids as hex strings, int64 timestamps as decimal strings, enums as integers.
type OtlpAttr = { key: string; value: { stringValue: string } | { arrayValue: { values: Array<{ stringValue: string }> } } };
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  status?: { code: number; message?: string };
}

const SPAN_KIND_INTERNAL = 1;
const STATUS_CODE_ERROR = 2;

const attr = (key: string, value: string): OtlpAttr => ({ key, value: { stringValue: value } });
/** Flatten a metadata map to `<prefix><key>` string attributes (the documented type); null/undefined are dropped. */
const metaAttrs = (prefix: string, meta: Record<string, unknown>): OtlpAttr[] =>
  Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => attr(`${prefix}${k}`, String(v)));
const nanos = (ms: number): string => `${Math.round(ms)}000000`;
const newSpanId = (): string => randomBytes(8).toString("hex");

/**
 * A 32-hex OTLP trace id from whatever the caller chose: 32 hex as is, a dashed UUID
 * undashed, anything else a stable sha256 prefix. Never throws; no id means a random one.
 */
function otlpTraceId(id: string | undefined): string {
  if (!id) return randomBytes(16).toString("hex");
  const hex = id.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) && !/^0{32}$/.test(hex) ? hex : createHash("sha256").update(id).digest("hex").slice(0, 32);
}

const state = {
  queue: [] as OtlpSpan[],
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

function langfuseConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() || null;
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() || null;
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || DEFAULT_LANGFUSE_BASE_URL).replace(/\/$/, "");
  return { configured: Boolean(publicKey && secretKey), publicKey, secretKey, baseUrl };
}

/** Masked, capped excerpt. Empty input stays empty (never a fabricated string). */
function maskExcerpt(text: string | null | undefined): string {
  if (!text) return "";
  return redactCallerText(text, EXCERPT_CHARS);
}

function promptHash(text: string): string {
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
    const endMs = Date.now();
    const startMs = endMs - (Number.isFinite(g.latencyMs) ? Math.max(0, g.latencyMs) : 0);
    const traceId = otlpTraceId(g.traceId);
    const rootId = newSpanId();
    const identity = resolveNickDeployIdentity(process.env);
    const usage = {
      input: g.usage?.promptTokens ?? undefined,
      output: g.usage?.completionTokens ?? undefined,
      total: g.usage?.totalTokens ?? undefined,
    };
    const metadata = {
      site: g.site,
      promptSha256: promptHash(g.promptText),
      inputChars: g.input?.length ?? 0,
      outputChars: g.output?.length ?? 0,
      commit: identity.commitShort ?? "unknown",
      ...(g.metadata ?? {}),
    };
    // Trace-level attributes ride on both spans: Langfuse filters need them on every span, not only the root.
    const traceAttrs: OtlpAttr[] = [
      attr("langfuse.trace.name", g.name),
      { key: "langfuse.trace.tags", value: { arrayValue: { values: ["nickstire", g.ok ? "ok" : "error"].map((stringValue) => ({ stringValue })) } } },
      attr("langfuse.environment", process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development"),
      ...(identity.commit ? [attr("langfuse.release", identity.commit)] : []),
    ];
    const excerptAttrs: OtlpAttr[] = g.excerpt
      ? [attr("langfuse.observation.input", maskExcerpt(g.input)), attr("langfuse.observation.output", maskExcerpt(g.output))]
      : [];
    const span = (s: Pick<OtlpSpan, "spanId" | "attributes"> & Partial<OtlpSpan>): OtlpSpan => ({
      traceId,
      name: g.name,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: nanos(startMs),
      endTimeUnixNano: nanos(endMs),
      ...s,
    });
    state.queue.push(
      span({
        spanId: rootId,
        attributes: [
          attr("langfuse.observation.type", "span"),
          ...traceAttrs,
          ...metaAttrs("langfuse.trace.metadata.", metadata),
          ...excerptAttrs,
        ],
      }),
      span({
        spanId: newSpanId(),
        parentSpanId: rootId,
        attributes: [
          attr("langfuse.observation.type", "generation"),
          ...traceAttrs,
          attr("langfuse.observation.model.name", g.model),
          ...(Object.values(usage).some((v) => v !== undefined) ? [attr("langfuse.observation.usage_details", JSON.stringify(usage))] : []),
          attr("langfuse.observation.level", g.ok ? "DEFAULT" : "ERROR"),
          ...(g.ok ? [] : [attr("langfuse.observation.status_message", errorClass(g.error))]),
          ...metaAttrs("langfuse.observation.metadata.", metadata),
          ...excerptAttrs,
        ],
        ...(g.ok ? {} : { status: { code: STATUS_CODE_ERROR, message: errorClass(g.error) } }),
      }),
    );
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

/**
 * The class of a failure, never its message (a provider message can echo the
 * request): "HTTP 503", "TimeoutError", "TypeError:ENOTFOUND", else "error".
 */
function errorClass(err: unknown): string {
  if (err === undefined || err === null) return "error";
  if (err instanceof Error) {
    const http = /\bHTTP \d{3}\b/.exec(err.message)?.[0];
    if (http) return http;
    const code = (err as { code?: unknown; cause?: { code?: unknown } }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
    return typeof code === "string" && /^[A-Z_]{2,40}$/.test(code) ? `${err.name}:${code}` : err.name || "Error";
  }
  const s = String(err);
  if (/^[A-Za-z]*Error(:[A-Z_]{2,40})?$/.test(s)) return s; // already a class
  return /\bHTTP \d{3}\b/.exec(s)?.[0] ?? "error";
}

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
function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return typeof messages === "string" ? messages : "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Json;
    if (m?.role === "user") return m.parts ? partsText(m.parts) : partsText(m.content);
  }
  return "";
}

/** Output text of the provider response shapes nickstire calls (OpenAI-compatible, Ollama /api/chat, Anthropic, Gemini). */
function responseText(json: unknown): string {
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
export interface TraceChatInput {
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
  /** Opt in to masked excerpts. Only for sites whose text holds no customer data. */
  excerpt?: boolean;
}

const tracedErrors = new WeakSet<object>();

/** Mark an error whose failure was already traced, so traceThrown() does not trace it twice. */
export function markTraced<E extends object>(err: E): E {
  tracedErrors.add(err);
  return err;
}

/**
 * Catch-all for one provider attempt: a throw (timeout, DNS, abort, bad JSON)
 * is traced once as ok:false, then the caller rethrows. Errors already traced
 * at a non-2xx branch (markTraced) are skipped.
 */
export function traceThrown(err: unknown, o: Omit<TraceChatInput, "ok" | "error" | "response" | "outputText">): void {
  if (err !== null && typeof err === "object" && tracedErrors.has(err)) return;
  traceChat({ ...o, ok: false, error: err });
}

/** For `.catch()` on a provider fetch or body read: trace the throw once, then rethrow it unchanged. */
export function rethrowTraced(o: Omit<TraceChatInput, "ok" | "error" | "response" | "outputText">): (err: unknown) => never {
  return (err: unknown): never => {
    traceThrown(err, o);
    throw err;
  };
}

export function traceChat(o: TraceChatInput): void {
  try {
    if (o.private) {
      state.skippedPrivate += 1;
      return;
    }
    // Off = return before any work: a vision call's messages carry base64 images.
    if (!langfuseConfig().configured) return;
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
      error: o.ok ? null : errorClass(o.error),
      excerpt: o.excerpt,
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
  /** Trace ids (32 hex) in a batch Langfuse accepted whole (2xx, no rejected spans); empty otherwise. */
  traceIds: string[];
}

/**
 * Send up to MAX_BATCH queued spans now. Used by the timer, the probe and
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
  if (!cfg.configured) return { ok: false, sent: 0, httpStatus: null, error: "keys unset", attempted: false, traceIds: [] };
  if (state.queue.length === 0) return { ok: true, sent: 0, httpStatus: null, error: null, attempted: false, traceIds: [] };
  const batch = state.queue.splice(0, MAX_BATCH);
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64")}`,
        // Real-time on the v4 data model; without it OTel data can lag up to 10 minutes (Langfuse OTel docs).
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: [attr("service.name", "nickstire")] },
            scopeSpans: [{ scope: { name: "nickstire.langfuse", version: "1" }, spans: batch }],
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    state.lastIngestAt = at;
    state.lastHttpStatus = res.status;
    // OTLP answers 200 with partialSuccess.rejectedSpans > 0 when it rejects spans inside
    // an accepted request: a 2xx alone is not an ack of every span.
    const rejected = res.ok ? await rejectedSpans(res) : { count: 0, message: "" };
    if (res.ok && rejected.count > 0) {
      state.batchesFailed += 1;
      state.lastIngestOk = false;
      state.lastError = `HTTP ${res.status}: ${rejected.count} of ${batch.length} span(s) rejected${rejected.message ? `: ${rejected.message}` : ""}`;
      log.warn("langfuse otlp export partly rejected", { status: res.status, rejected: rejected.count });
      return { ok: false, sent: batch.length - rejected.count, httpStatus: res.status, error: state.lastError, attempted: true, traceIds: [] };
    }
    if (res.ok) {
      state.batchesSent += 1;
      state.lastIngestOk = true;
      state.lastError = null;
      return {
        ok: true,
        sent: batch.length,
        httpStatus: res.status,
        error: null,
        attempted: true,
        traceIds: batch.filter((s) => s.parentSpanId === undefined).map((s) => s.traceId),
      };
    }
    const text = await res.text().catch(() => "");
    state.batchesFailed += 1;
    state.lastIngestOk = false;
    state.lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    log.warn("langfuse otlp export rejected", { status: res.status, dropped: batch.length });
    return { ok: false, sent: 0, httpStatus: res.status, error: state.lastError, attempted: true, traceIds: [] };
  } catch (err) {
    state.lastIngestAt = at;
    state.lastHttpStatus = null;
    state.batchesFailed += 1;
    state.lastIngestOk = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    log.warn("langfuse otlp export failed", { error: state.lastError, dropped: batch.length });
    return { ok: false, sent: 0, httpStatus: null, error: state.lastError, attempted: true, traceIds: [] };
  }
}

/** OTLP ExportTraceServiceResponse.partialSuccess: rejectedSpans is an int64 (JSON string or number); 0 with a message is only a warning. */
async function rejectedSpans(res: Response): Promise<{ count: number; message: string }> {
  try {
    const ps = ((await res.json()) as { partialSuccess?: { rejectedSpans?: number | string; errorMessage?: unknown } })?.partialSuccess;
    const count = Number(ps?.rejectedSpans ?? 0);
    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      message: typeof ps?.errorMessage === "string" ? ps.errorMessage.slice(0, 200) : "",
    };
  } catch {
    return { count: 0, message: "" }; // an empty or non-JSON 2xx body carries no per-span verdict
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

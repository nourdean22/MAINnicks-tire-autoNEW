/**
 * lib/observability/langfuse.ts — Langfuse tracing init (2026-08-25).
 *
 * WHY THIS EXISTS (and why braintrust-wrap.ts did not deliver it):
 * `wrapWithBraintrust` shipped 2026-05-17 with a BRAINTRUST_API_KEY set
 * in prod ever since — and has had ZERO callers outside its own file the
 * whole time (grep receipt in PR). The orphaned-subject defect shape:
 * built, tested, unwired. This module is wired at BOTH ends in the same
 * PR: instrumentation.ts calls initLangfuseTracing() at boot, and
 * build-stream-config.ts asks isLangfuseTelemetryEnabled() per attempt.
 *
 * HOW IT WORKS — the documented Langfuse v5 pattern
 * (langfuse.com/integrations/frameworks/vercel-ai-sdk): register a
 * LangfuseSpanProcessor (@langfuse/otel) on the global OTel provider via
 * NodeSDK, then AI SDK calls with `experimental_telemetry.isEnabled`
 * emit gen_ai spans the processor ships to
 * `${LANGFUSE_BASE_URL}/api/public/otel` with Basic auth. The processor
 * reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
 * itself; this module only decides WHETHER to start it.
 *
 * Defensive contract (the braintrust-wrap lesson, kept honest):
 *   · keys unset → "skipped", one info log, zero overhead — the AI SDK
 *     telemetry flag stays false so not even noop spans are built.
 *   · init throws → "failed", logged, chat unaffected (fail open — this
 *     is observability, not a gate).
 *   · `langfuseTracingStatus()` reports the REAL outcome for /system
 *     surfaces, never key-presence (the isBraintrustActive() bug class).
 *
 * Deliberately NOT here (YAGNI until traces are visibly landing):
 * prompt management, score ingestion, propagateAttributes session
 * promotion. See docs/integrations/langfuse-observability.md.
 *
 * 2026-09-17 · THAT YAGNI CONDITION IS NOW MET — 672 traces in a 7d window.
 * The one thing its absence costs is trace NAMING: every trace comes back with
 * `name: ""`, so the Langfuse trace list cannot be filtered or scanned by
 * surface and you must open a trace to read `metadata.source`. Closing it means
 * adding `@langfuse/tracing` and wrapping each AI call in
 * `propagateAttributes({ traceName }, cb)` — an AsyncLocalStorage frame around
 * the hot chat path, unverifiable until deployed. Left OPEN deliberately rather
 * than shipped on a guess: the identity is not lost, only unfilterable
 * (userId 50/50, tags 47/50, metadata.source 50/50 — measured, see
 * `scripts/probe-langfuse-errors.mjs`). Reopen when the UI cost bites.
 */

import { logger as rootLogger } from "@/lib/logger";
import { AI_SDK_TRACER_NAME, LANGFUSE_SELFCHECK_SPAN_NAME } from "./span-names";

const log = rootLogger.withSurface("observability/langfuse");

type TracingStatus = "started" | "skipped" | "failed" | "uninitialized";

/**
 * 2026-08-25 · state lives on globalThis, NOT at module level — proven
 * necessary on prod the same day the module shipped. Next.js compiles
 * instrumentation.ts as its OWN entry, so this module exists twice at
 * runtime: the instrumentation copy ran init (boot log said
 * langfuse_skipped) while the app-bundle copy that healthSummary reads
 * stayed "uninitialized" — /system showed "not initialized" over a lane
 * that had in fact initialized. Module-level singletons don't cross
 * bundle boundaries; globalThis does (the OTel provider itself is
 * process-global via @opentelemetry/api for the same reason, which is
 * why TRACING worked while the STATUS lied).
 */
interface LangfuseGlobalState {
  status: TracingStatus;
  /**
   * True when the processor was handed to an SDK that already owns the global
   * tracer provider (Sentry). Then we must NOT build a NodeSDK of our own —
   * the second registration is refused and every span is silently dropped.
   */
  attachedToHostProvider?: boolean;
  processor: { forceFlush(): Promise<void> } | null;
}
const g = globalThis as typeof globalThis & { __langfuseTracing?: LangfuseGlobalState };
function state(): LangfuseGlobalState {
  g.__langfuseTracing ??= { status: "uninitialized", processor: null };
  return g.__langfuseTracing;
}

export function isLangfuseConfigured(): boolean {
  return Boolean(
    (process.env.LANGFUSE_PUBLIC_KEY ?? "").trim() &&
      (process.env.LANGFUSE_SECRET_KEY ?? "").trim(),
  );
}

/**
 * Per-turn gate for `experimental_telemetry.isEnabled`.
 *
 * Requires the processor to have actually STARTED — a true here with a
 * dead pipeline would emit spans into a void while /system claims
 * tracing works. Private-mode turns are never traced: Langfuse spans
 * carry prompt + completion content, and the repo's observability
 * privacy stance (otel-export.ts, two layers) is that content never
 * leaves the process without an explicit, named decision.
 */
export function isLangfuseTelemetryEnabled(privateMode?: boolean): boolean {
  return state().status === "started" && !privateMode;
}

export function langfuseTracingStatus(): TracingStatus {
  return state().status;
}

// ---------------------------------------------------------------------------
// Per-call telemetry (2026-09-02, Langfuse best-practice pass)
//
// The AI SDK forwards `experimental_telemetry.metadata.{sessionId,userId,tags}`
// and `functionId` as the attributes the Langfuse span processor maps onto
// trace session / user / tags / name (verified against @langfuse/otel 5.10's
// attribute mapping, not from memory). Every generateText/streamText call in
// this app builds its block through langfuseTelemetry() so those keys are
// spelled once; tests/observability/ai-sdk-telemetry-gate.test.ts enumerates
// the call sites and fails on a bare one.
// ---------------------------------------------------------------------------

/** OTel attribute values are flat: primitives or homogeneous primitive arrays. */
export type TelemetryAttribute = string | number | boolean | string[] | number[] | boolean[];

export interface LangfuseTelemetryInput {
  /**
   * OBSERVATION name prefix (`ai.telemetry.functionId`) — Langfuse renders it as
   * `<functionId>:ai.generateText`. kebab-case verb-noun, stable across deploys.
   *
   * ⚠⚠ THIS IS NOT THE TRACE NAME, though this line said it was until
   * 2026-09-17. Measured against `GET /api/public/traces` in production:
   * **0 of 50 traces carried a name** (672 in the window) while `userId` landed
   * 50/50, `tags` 47/50 and `metadata` on every row. The three metadata-borne
   * channels below work; only this one was mis-documented.
   *
   * ★ The tell was the ASYMMETRY. Had the whole telemetry block been dead, every
   * field would have been empty together. Three of four landing meant the block
   * was fine and one specific mapping claim was false — the same lens
   * ("does the code have the property its docstring claims?") that found four
   * defects in this session's own merged work.
   *
   * Naming a trace needs `propagateAttributes({ traceName }, cb)` from
   * `@langfuse/tracing`, which this app does not install — see the module
   * header's YAGNI note, whose condition has now been met. The cost of the gap
   * is bounded: all identity IS present in `metadata.source` / `tags`, so this
   * is a UI-filterability gap, not a data-loss one, and
   * `scripts/probe-langfuse-errors.mjs` groups on the fallback already.
   */
  functionId: string;
  /** Private-mode turns are never traced: prompt + completion content stays in-process. */
  privateMode?: boolean;
  /** Langfuse session — groups every span of one conversation / job run. */
  sessionId?: string;
  /** Langfuse tags — filterable in the UI. Keep them low-cardinality. */
  tags?: string[];
  /** Free-form metadata. Nested values are JSON-stringified (attributes are flat). */
  metadata?: Record<string, unknown>;
}

/** Single-operator app: every trace belongs to the operator unless a caller says otherwise. */
export const LANGFUSE_DEFAULT_USER_ID = "operator";

export function toTelemetryAttributes(input: Record<string, unknown> | undefined): Record<string, TelemetryAttribute> {
  const out: Record<string, TelemetryAttribute> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out[key] = value as string[];
    } else {
      try {
        out[key] = JSON.stringify(value);
      } catch {
        out[key] = String(value);
      }
    }
  }
  return out;
}

/**
 * Build the `experimental_telemetry` block for one AI SDK call. `isEnabled` is
 * the started-processor gate, so with no Langfuse keys the SDK builds no spans
 * at all (zero overhead) and a private-mode turn is never exported.
 */
export function langfuseTelemetry(input: LangfuseTelemetryInput): {
  isEnabled: boolean;
  functionId: string;
  metadata: Record<string, TelemetryAttribute>;
} {
  const metadata: Record<string, TelemetryAttribute> = { userId: LANGFUSE_DEFAULT_USER_ID };
  if (input.sessionId) metadata.sessionId = input.sessionId;
  if (input.tags && input.tags.length > 0) metadata.tags = input.tags;
  Object.assign(metadata, toTelemetryAttributes(input.metadata));
  return { isEnabled: isLangfuseTelemetryEnabled(input.privateMode), functionId: input.functionId, metadata };
}

// ---------------------------------------------------------------------------
// Processor options: environment / release / mask
// ---------------------------------------------------------------------------

/** Langfuse rejects an environment outside ^(?!langfuse)[a-z0-9-_]+$ (max 40 chars). */
const ENVIRONMENT_RE = /^(?!langfuse)[a-z0-9-_]+$/;

/**
 * `LANGFUSE_TRACING_ENVIRONMENT` (Langfuse's own env var) wins; otherwise the
 * Railway environment name, otherwise NODE_ENV. Anything that would be
 * rejected at ingestion collapses to "default" rather than dropping spans.
 */
export function resolveLangfuseEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.LANGFUSE_TRACING_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "default").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return ENVIRONMENT_RE.test(cleaned) ? cleaned : "default";
}

/** `LANGFUSE_RELEASE`, else the Railway commit SHA — so a regression can be pinned to a deploy. */
export function resolveLangfuseRelease(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.LANGFUSE_RELEASE || env.RAILWAY_GIT_COMMIT_SHA || "").trim();
  return raw ? raw.slice(0, 40) : undefined;
}

/**
 * Belt-and-braces masking applied to every exported span payload: an API key
 * or bearer token that leaks into a prompt, a tool result or a model reply
 * never reaches Langfuse. The processor hands over the stringified data.
 */
const SECRET_RE = /\b(?:sk|pk)-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;
export function maskLangfuseData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  return data.replace(SECRET_RE, (m) => (m.startsWith("Bearer") ? "Bearer [REDACTED]" : `${m.slice(0, 3)}[REDACTED]`));
}


// ---------------------------------------------------------------------------
// Processor construction, split from provider registration (2026-09-02)
//
// Split so `sentry.server.config.ts` can build the processor and pass it into
// `Sentry.init({ openTelemetrySpanProcessors })` — Sentry registers the global
// tracer provider, so the Langfuse processor has to ride on ITS provider
// rather than lose a second registration silently.
// ---------------------------------------------------------------------------

export interface LangfuseSpanProcessorLike {
  forceFlush(): Promise<void>;
  onStart(...a: unknown[]): void;
  onEnd(...a: unknown[]): void;
  shutdown(): Promise<void>;
}

// Re-exported from the dependency-free module so the Sentry sampler can share
// them without pulling this file (and its Node-only OTel imports) into the
// browser bundle. See span-names.ts.
export { AI_SDK_TRACER_NAME, LANGFUSE_SELFCHECK_SPAN_NAME };
const INVALID_TRACE_ID = "00000000000000000000000000000000";

/** Minimal shape of the ended span an OTel processor receives. */
interface ReadableSpanLike {
  name?: string;
  instrumentationScope?: { name?: string };
  /** sdk-trace-base < 2 called it this; kept so the filter works on either. */
  instrumentationLibrary?: { name?: string };
}

/**
 * Is this a span the Vercel AI SDK emitted? Matched on instrumentation SCOPE,
 * not on the span name, because the scope is what the SDK controls and cannot
 * be spoofed by an unrelated span that happens to be called `ai.something`.
 */
export function isAiSdkSpan(span: unknown): boolean {
  const s = span as ReadableSpanLike | null;
  const scope = s?.instrumentationScope?.name ?? s?.instrumentationLibrary?.name;
  return scope === AI_SDK_TRACER_NAME && s?.name !== LANGFUSE_SELFCHECK_SPAN_NAME;
}

/**
 * Wrap a span processor so it only ever sees AI SDK spans.
 *
 * Load-bearing when Langfuse rides on SENTRY's tracer provider (the normal
 * production path): that provider is fed by Sentry's auto-instrumentation, so
 * without this filter every HTTP request, Next.js render and database span in
 * the process would be exported to Langfuse — burning quota and shipping
 * unrelated request telemetry to a vendor that should only ever see model
 * calls. `beforeSendTransaction` cannot prevent that; it runs on Sentry's own
 * export path, long after our processor's onEnd. (Review finding on #2080.)
 */
export function aiOnlySpanProcessor(inner: LangfuseSpanProcessorLike): LangfuseSpanProcessorLike {
  return {
    onStart(...args: unknown[]) {
      if (isAiSdkSpan(args[0])) inner.onStart(...args);
    },
    onEnd(...args: unknown[]) {
      if (isAiSdkSpan(args[0])) inner.onEnd(...args);
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
  };
}

/**
 * Build the Langfuse span processor (idempotent) and register the SIGTERM
 * drain. Returns null when Langfuse is unconfigured. Does NOT register any
 * tracer provider — that is `initLangfuseTracing`'s job, or Sentry's.
 */
export async function buildLangfuseSpanProcessor(): Promise<LangfuseSpanProcessorLike | null> {
  const st = state();
  if (st.processor) return st.processor as LangfuseSpanProcessorLike;
  if (!isLangfuseConfigured()) return null;

  // Const-specifier import, deliberately: this repo's junctioned worktrees
  // cannot run installs, so a literal specifier would fail `tsc` (TS2307)
  // where the package isn't physically present. The package is in
  // serverExternalPackages, so Next leaves it a runtime require either way.
  const LANGFUSE_OTEL = "@langfuse/otel";
  const { LangfuseSpanProcessor } = (await import(LANGFUSE_OTEL)) as {
    LangfuseSpanProcessor: new (opts?: {
      environment?: string;
      release?: string;
      mask?: (p: { data: unknown }) => unknown;
    }) => LangfuseSpanProcessorLike;
  };
  const spanProcessor = aiOnlySpanProcessor(
    new LangfuseSpanProcessor({
      environment: resolveLangfuseEnvironment(),
      release: resolveLangfuseRelease(),
      mask: ({ data }) => maskLangfuseData(data),
    }),
  );
  st.processor = spanProcessor;

  // Railway redeploys SIGTERM the container; without a drain the batch
  // processor's tail buffer (up to one flush interval of spans) dies with it.
  //
  // 2026-08-25 · Promise.resolve() wrap, load-bearing: `.catch` chained
  // directly assumes forceFlush() returns a promise. Under vitest the handler
  // outlives the test that registered it and the torn-down mock returns
  // undefined, so the bare `.catch` THREW inside the SIGTERM handler and put a
  // deterministic `Errors 1 error` in every statenour suite run. Canaried in
  // langfuse.test.ts with a synthetic undefined-returning teardown.
  process.once("SIGTERM", () => {
    void Promise.resolve(spanProcessor.forceFlush()).catch(() => {});
  });
  return spanProcessor;
}

/**
 * Mark the processor as living on a provider someone else registered (Sentry).
 * Called by sentry.server.config.ts after it hands the processor to Sentry.
 */
export function markLangfuseAttachedToHostProvider(): void {
  state().attachedToHostProvider = true;
}

/**
 * Ask the global tracer provider — by the SAME tracer name the AI SDK uses —
 * for a span, and report whether it actually records. A no-op tracer returns
 * an all-zero trace id and `isRecording() === false`; that is the signature of
 * "some other SDK owns the provider and our processor is never called".
 */
export async function langfuseSpanRecordingSelfCheck(): Promise<{
  recording: boolean;
  traceId: string | null;
  providerName: string | null;
}> {
  try {
    const OTEL_API = "@opentelemetry/api";
    const { trace } = (await import(OTEL_API)) as {
      trace: {
        getTracer(name: string): {
          startSpan(name: string): {
            isRecording(): boolean;
            spanContext(): { traceId: string };
            end(): void;
          };
        };
        getTracerProvider(): object;
      };
    };
    const providerName = trace.getTracerProvider()?.constructor?.name ?? null;
    const span = trace.getTracer(AI_SDK_TRACER_NAME).startSpan(LANGFUSE_SELFCHECK_SPAN_NAME);
    const traceId = span.spanContext().traceId;
    const recording = span.isRecording() && traceId !== INVALID_TRACE_ID;
    span.end();
    return { recording, traceId, providerName };
  } catch {
    return { recording: false, traceId: null, providerName: null };
  }
}

/**
 * Boot-time init — called once from instrumentation.ts inside the
 * NEXT_RUNTIME === "nodejs" guard. Idempotent.
 */
export async function initLangfuseTracing(): Promise<TracingStatus> {
  const st = state();
  if (st.status !== "uninitialized") return st.status;
  if (!isLangfuseConfigured()) {
    st.status = "skipped";
    log.info("langfuse_skipped", {
      reason: "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY unset",
      hint: "set both (plus LANGFUSE_BASE_URL for a region/self-host) on Railway statenour-web to activate tracing",
    });
    return st.status;
  }
  try {
    const spanProcessor = st.processor ?? (await buildLangfuseSpanProcessor());
    if (!spanProcessor) {
      st.status = "skipped";
      return st.status;
    }

    // 2026-09-02 · THE PROVIDER-CONFLICT FIX.
    //
    // `@opentelemetry/api`'s registerGlobal refuses a SECOND tracer provider
    // (allowOverride=false) — it logs a duplicate-registration error through
    // diag, which is a no-op logger by default, and KEEPS THE FIRST provider.
    // Sentry's `Sentry.init()` registers one (@sentry/node initOtel.js), and
    // instrumentation.ts imports sentry.server.config BEFORE this ran. So the
    // NodeSDK registration below was silently refused, every AI SDK span went
    // to Sentry's provider, and Langfuse received NOTHING while this function
    // still logged `langfuse_started`. Production ran that way with valid keys
    // and zero rows in Langfuse.
    //
    // When Sentry owns the provider we ride ON it (Sentry.init's supported
    // `openTelemetrySpanProcessors` option — see sentry.server.config.ts) and
    // must NOT construct a NodeSDK at all. `attachedToHostProvider` is set by
    // that path. Otherwise we own the provider ourselves, as before.
    if (!st.attachedToHostProvider) {
      const OTEL_SDK_NODE = "@opentelemetry/sdk-node";
      const { NodeSDK } = (await import(OTEL_SDK_NODE)) as {
        NodeSDK: new (cfg: { spanProcessors: unknown[] }) => { start(): void };
      };
      const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
      sdk.start();
    }

    // Prove the instrument fired. A started processor, a green status and a
    // dead pipeline were indistinguishable before this check: ask the SAME
    // tracer name the AI SDK uses for a span and require it to RECORD.
    let selfCheck = await langfuseSpanRecordingSelfCheck();

    // Self-heal: we were told Sentry took the processor, but nothing records.
    // Sentry's init returns early during `next build` and can throw, so the
    // handover is not guaranteed. Own the provider ourselves rather than
    // leaving tracing dead.
    if (!selfCheck.recording && st.attachedToHostProvider) {
      const OTEL_SDK_NODE_FALLBACK = "@opentelemetry/sdk-node";
      const { NodeSDK } = (await import(OTEL_SDK_NODE_FALLBACK)) as {
        NodeSDK: new (cfg: { spanProcessors: unknown[] }) => { start(): void };
      };
      new NodeSDK({ spanProcessors: [spanProcessor] }).start();
      st.attachedToHostProvider = false;
      selfCheck = await langfuseSpanRecordingSelfCheck();
      log.warn("langfuse_host_provider_handover_failed", {
        reason: "Sentry did not wire the processor in; fell back to owning the tracer provider",
        recovered: selfCheck.recording,
      });
    }

    if (!selfCheck.recording) {
      st.status = "failed";
      log.error("langfuse_tracer_not_recording", {
        reason: "the global OpenTelemetry tracer provider is not routing spans to the Langfuse processor",
        likelyCause: "another SDK (Sentry) registered the global provider first — pass the processor via Sentry.init openTelemetrySpanProcessors",
        attachedToHostProvider: st.attachedToHostProvider,
        tracerProvider: selfCheck.providerName,
      });
      return st.status;
    }
    st.status = "started";
    // Railway redeploys SIGTERM the container; without a drain the batch
    // processor's tail buffer (up to one flush interval of spans) dies
    // with it. once-guarded by the status singleton above.
    //
    // 2026-08-25 (same-day fix) · Promise.resolve() wrap, load-bearing:
    // `.catch` chained directly on the call assumes forceFlush() returns
    // a promise. Under vitest the handler outlives the test that
    // registered it, and the torn-down mock returns undefined — so the
    // bare `.catch` THREW inside the SIGTERM handler and put a
    // deterministic `Errors 1 error` in every statenour suite run
    // (4 sibling PRs red on 6,10x-passed suites). Promise.resolve()
    // absorbs any thenable-or-not return. Canaried in langfuse.test.ts
    // with a synthetic undefined-returning teardown.
    log.info("langfuse_started", {
      baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com (SDK default)",
      attachedToHostProvider: st.attachedToHostProvider,
      tracerProvider: selfCheck.providerName,
    });
  } catch (err) {
    st.status = "failed";
    log.error("langfuse_init_failed", {
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
  }
  return st.status;
}

/** Drain pending spans — for probe scripts and graceful shutdown. */
export async function flushLangfuseTraces(): Promise<void> {
  await state().processor?.forceFlush();
}

/** Test seam — resets module state so gating paths can be exercised. */
export function __resetLangfuseForTests(): void {
  g.__langfuseTracing = { status: "uninitialized", processor: null };
}

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
 */

import { logger as rootLogger } from "@/lib/logger";

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
  /** Trace name (`ai.telemetry.functionId`). kebab-case verb-noun, stable across deploys. */
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
    // Const-specifier imports, deliberately: this repo's junctioned
    // worktrees cannot run installs, so a literal specifier would fail
    // `tsc` (TS2307) everywhere the package isn't physically present.
    // Runtime behavior is identical — both packages are in
    // serverExternalPackages (next.config.ts), so Next leaves them as
    // runtime requires against the deployed node_modules either way.
    // Types are restored structurally below; the REAL wire contract is
    // proven by scripts/probe-langfuse-trace.ts.
    const LANGFUSE_OTEL = "@langfuse/otel";
    const OTEL_SDK_NODE = "@opentelemetry/sdk-node";
    const [{ LangfuseSpanProcessor }, { NodeSDK }] = (await Promise.all([
      import(LANGFUSE_OTEL),
      import(OTEL_SDK_NODE),
    ])) as [
      {
        LangfuseSpanProcessor: new (opts?: { environment?: string; release?: string; mask?: (p: { data: unknown }) => unknown }) => {
          forceFlush(): Promise<void>;
          onStart(...a: unknown[]): void;
          onEnd(...a: unknown[]): void;
          shutdown(): Promise<void>;
        };
      },
      { NodeSDK: new (cfg: { spanProcessors: unknown[] }) => { start(): void } },
    ];
    const spanProcessor = new LangfuseSpanProcessor({
      environment: resolveLangfuseEnvironment(),
      release: resolveLangfuseRelease(),
      mask: ({ data }) => maskLangfuseData(data),
    });
    const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
    sdk.start();
    st.processor = spanProcessor;
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
    process.once("SIGTERM", () => {
      void Promise.resolve(spanProcessor.forceFlush()).catch(() => {});
    });
    log.info("langfuse_started", {
      baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com (SDK default)",
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

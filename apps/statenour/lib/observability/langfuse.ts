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
      { LangfuseSpanProcessor: new () => { forceFlush(): Promise<void>; onStart(...a: unknown[]): void; onEnd(...a: unknown[]): void; shutdown(): Promise<void> } },
      { NodeSDK: new (cfg: { spanProcessors: unknown[] }) => { start(): void } },
    ];
    const spanProcessor = new LangfuseSpanProcessor();
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

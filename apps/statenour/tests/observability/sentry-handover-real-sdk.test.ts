/**
 * tests/observability/sentry-handover-real-sdk.test.ts · 2026-09-30 · Q-15
 *
 * The Langfuse span processor reaches the tracer provider ONE way: it is handed
 * to `Sentry.init({ openTelemetrySpanProcessors })` in sentry.server.config.ts
 * (see tracer-provider-conflict.test.ts for why it cannot register its own).
 *
 * Every other test of that handover mocks `@sentry/nextjs`, so they prove what
 * WE pass, never what the installed SDK does with it. That gap is about to
 * matter: `@sentry/nextjs` 11 (npm `latest` is 11.1.0 as of 2026-09-30) drops
 * `openTelemetrySpanProcessors` from its options. The option sits inside a
 * conditional spread, so `tsc` does not flag it as an excess property. And the
 * boot self-check in lib/observability/langfuse.ts only asks whether a span
 * RECORDS, which it still would on Sentry's provider. A major bump would
 * therefore compile, boot, report `langfuse_started`, and send Langfuse
 * nothing: the 2026-09-02 outage again.
 *
 * So this file drives the REAL installed SDKs, with only the model mocked: init
 * Sentry through the production `initSentryServer`, run one `generateText`
 * call with telemetry on, and require that the handed-over processor saw its
 * span. Upgrading Sentry past the handover turns this red (receipt in the PR
 * that added this file: the same probe on @sentry/node 11.1.0 delivers
 * nothing). Until the app owns its tracer provider (WP-O in
 * docs/research/2026-09-23-estate-master-architecture.md §7.2), keep
 * `@sentry/nextjs` on 10.x; this test is what enforces it.
 *
 * Nothing leaves the process: the DSN points at a closed local port, tracing
 * transactions are dropped by `beforeSendTransaction`, and no error is captured.
 *
 * A second way to break it without touching Sentry (2026-10-21, Dependabot PR 3202):
 * the lockfile gave `ai` @opentelemetry/api 1.10.0 while Sentry stayed on 1.9.1.
 * The API refuses a global registered by an older minor ("1.4 package may NOT use
 * 1.3 global", @opentelemetry/api dist/internal/semver), so `ai` got a no-op tracer
 * and every AI span vanished. The last test below names that cause directly.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { initSentryServer } from "../../sentry.server.config";
import { aiOnlySpanProcessor, type LangfuseSpanProcessorLike } from "@/lib/observability/langfuse";

/** A stand-in for LangfuseSpanProcessor that records the name of every span that reaches it. */
function recordingProcessor() {
  const ended: string[] = [];
  const processor: LangfuseSpanProcessorLike = {
    forceFlush: async () => {},
    onStart() {},
    onEnd(span: unknown) {
      ended.push(String((span as { name?: unknown }).name));
    },
    shutdown: async () => {},
  };
  return { processor, ended };
}

/** One real AI SDK call with telemetry on, answered by a mock model (no network). */
async function runTracedAiCall(functionId: string): Promise<string> {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const result = await generateText({
    model,
    prompt: "probe",
    experimental_telemetry: { isEnabled: true, functionId },
  });
  return result.text;
}

type OtelApiLike = {
  trace: { getTracer(name: string): { startSpan(name: string): { isRecording(): boolean; end(): void } } };
};

/** The @opentelemetry/api copy the installed `ai` itself imports (file-relative, as at runtime), and its version. */
function aiOwnOtelApi(): { api: OtelApiLike; version: string } {
  const fromAi = createRequire(createRequire(import.meta.url).resolve("ai"));
  const entry = fromAi.resolve("@opentelemetry/api");
  // The package exports no ./package.json, so walk up from its entry file to find it.
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@opentelemetry/api") return { api: fromAi(entry) as OtelApiLike, version: String(pkg.version) };
    } catch {
      // no package.json at this level; keep walking
    }
  }
  throw new Error(`no package.json above ${entry}`);
}

const savedEnv = { ...process.env };

describe("Sentry -> Langfuse span handover, on the INSTALLED @sentry/nextjs", () => {
  const langfuse = recordingProcessor();
  // Unfiltered control: sees every span Sentry's provider ends. Without it, the
  // "stays out of Langfuse" test below would also pass if no span recorded at all.
  const everything = recordingProcessor();

  beforeAll(() => {
    // A well-formed DSN so `enabled` is true and the real init path runs. Port 9
    // (discard) on loopback: any envelope Sentry tries to send goes nowhere.
    process.env.SENTRY_DSN = "http://public@127.0.0.1:9/1";
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    // Wrapped exactly as instrumentation.ts wraps the real Langfuse processor.
    initSentryServer([aiOnlySpanProcessor(langfuse.processor), everything.processor]);
  });

  afterAll(async () => {
    await Sentry.close(0);
    process.env = savedEnv;
  });

  it("Sentry actually initialized (otherwise a green result below would mean nothing)", () => {
    expect(Sentry.getClient()).toBeDefined();
    expect(Sentry.getClient()?.getOptions().enabled).toBe(true);
  });

  it("a real AI SDK call's spans reach the processor handed to Sentry.init", async () => {
    expect(await runTracedAiCall("q15-handover-probe")).toBe("ok");
    // AI SDK 6 names its spans by GenAI convention: `invoke_agent <functionId>`
    // for the call, `generate_content <model>` for the model step.
    expect(
      langfuse.ended.filter((name) => name.includes("q15-handover-probe")),
      "The installed @sentry/nextjs did not deliver spans to `openTelemetrySpanProcessors`. " +
        "If Sentry was upgraded past 10.x, that option is gone and Langfuse is receiving nothing. " +
        "Revert the upgrade, or move the app to its own tracer provider first (WP-O). " +
        "If Sentry did not move, read the @opentelemetry/api test below first.",
    ).toHaveLength(1);
    expect(langfuse.ended).toContain("generate_content mock-model-id");
  });

  it("only AI SDK spans get through; a span Sentry itself opens stays out of Langfuse", () => {
    Sentry.startSpan({ name: "GET /api/health" }, () => {});
    expect(everything.ended, "control: the span must exist for its absence to mean anything").toContain("GET /api/health");
    expect(langfuse.ended).not.toContain("GET /api/health");
  });

  it("the @opentelemetry/api copy `ai` imports can see the tracer provider Sentry registered", () => {
    const { api, version } = aiOwnOtelApi();
    const registered = (globalThis as Record<symbol, { version?: string } | undefined>)[
      Symbol.for("opentelemetry.js.api.1")
    ]?.version;
    // Not the "ai" tracer name, so this probe never lands in the Langfuse recorder above.
    const span = api.trace.getTracer("q15-api-split-probe").startSpan("q15-api-split-probe");
    const recording = span.isRecording();
    span.end();
    expect(
      recording,
      `ai imports @opentelemetry/api ${version}, but the global tracer provider was registered by ${registered}. ` +
        "A newer API minor refuses an older global, so every AI span is a no-op and Langfuse gets nothing. " +
        "Keep one @opentelemetry/api version in the lockfile (a root pnpm.overrides pin).",
    ).toBe(true);
  });
});

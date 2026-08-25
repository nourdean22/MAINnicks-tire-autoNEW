/**
 * scripts/probe-langfuse-trace.ts — offline end-to-end trace proof.
 *
 * Proves the ENTIRE tracing pipeline this repo owns, with no cloud
 * account and no real keys: AI SDK `experimental_telemetry` → global
 * OTel provider → LangfuseSpanProcessor (@langfuse/otel) → OTLP/HTTP
 * POST with Basic auth — captured by a local HTTP sink standing in for
 * `${LANGFUSE_BASE_URL}/api/public/otel`. The only hop NOT exercised is
 * Langfuse's server accepting the payload, which is their documented
 * OTLP contract and needs the operator's keys.
 *
 * Run:  pnpm tsx scripts/probe-langfuse-trace.ts
 * Exit: 0 with a receipt JSON on success · 1 with the failure printed.
 *
 * Uses fake keys against 127.0.0.1 ONLY — never set real keys here
 * (repo rule: no real API keys in test shells).
 */
import http from "node:http";
import { streamText } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";

interface Captured {
  method: string;
  url: string;
  auth: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

async function main(): Promise<void> {
  // 1 · local OTLP sink
  const captured: Captured[] = [];
  const sink = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captured.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const address = sink.address();
  if (address === null || typeof address === "string") throw new Error("sink has no port");
  const base = `http://127.0.0.1:${address.port}`;

  // 2 · fake credentials pointed at the sink — set BEFORE importing the
  // init module so its env reads see them.
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-local-proof";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-local-proof";
  process.env.LANGFUSE_BASE_URL = base;

  const { initLangfuseTracing, isLangfuseTelemetryEnabled, flushLangfuseTraces } = await import(
    "../lib/observability/langfuse"
  );

  const initStatus = await initLangfuseTracing();
  if (initStatus !== "started") {
    throw new Error(`initLangfuseTracing() returned "${initStatus}", expected "started"`);
  }
  if (!isLangfuseTelemetryEnabled(false)) {
    throw new Error("isLangfuseTelemetryEnabled(false) is false after successful init");
  }
  if (isLangfuseTelemetryEnabled(true)) {
    throw new Error("private-mode turn reported as traceable — privacy gate broken");
  }

  // 3 · a real streamText call through a mock model — same telemetry
  // shape build-stream-config.ts ships.
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "trace proof" },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: "stop" as const,
          usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
        },
      ]),
    }),
  });

  const result = streamText({
    model,
    prompt: "emit one span",
    experimental_telemetry: {
      isEnabled: isLangfuseTelemetryEnabled(false),
      functionId: "nick-chat-proof",
      metadata: { mode: "standard", probe: true },
    },
  });
  let text = "";
  for await (const delta of result.textStream) text += delta;

  // 4 · drain the processor and read the wire
  await flushLangfuseTraces();
  await new Promise((r) => setTimeout(r, 250));
  sink.close();

  const all = Buffer.concat(captured.map((c) => c.body)).toString("latin1");
  const checks: Array<[string, boolean]> = [
    ["at least one OTLP request captured", captured.length >= 1],
    ["POST method", captured.every((c) => c.method === "POST")],
    ["path targets the OTLP traces endpoint", captured.some((c) => /otel/.test(c.url))],
    ["Basic auth header present", captured.some((c) => c.auth?.startsWith("Basic "))],
    ["span carries functionId nick-chat-proof", all.includes("nick-chat-proof")],
    ["span carries AI SDK operation name", all.includes("ai.streamText")],
    ["mock completion text flowed", text === "trace proof"],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  const receipt = {
    sink: base,
    requests: captured.map((c) => ({
      method: c.method,
      url: c.url,
      auth: c.auth ? `${c.auth.slice(0, 12)}…` : null,
      contentType: c.contentType,
      bodyBytes: c.body.length,
    })),
    checks: Object.fromEntries(checks.map(([name, ok]) => [name, ok ? "PASS" : "FAIL"])),
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (failed.length > 0) {
    throw new Error(`${failed.length} check(s) failed: ${failed.map(([n]) => n).join(" · ")}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  },
);

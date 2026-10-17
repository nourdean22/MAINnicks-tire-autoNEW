/**
 * Langfuse tracing leaves nickstire as OTLP/HTTP JSON, never as the legacy
 * /api/public/ingestion batch.
 *
 * Why (finding C1.2, 2026-10-17): from 2026-11-16 Langfuse Cloud is v4-only and
 * "trace and observation events sent to POST /ingestion" are removed
 * (https://langfuse.com/faq/all/deprecated-api-migration, read 2026-10-17).
 * Without this move every nickstire AI trace goes dark with no error: the old
 * endpoint would answer 404, the status route would read DEGRADED, and nothing
 * else would notice.
 *
 * Four halves, all against a mocked fetch (no real telemetry leaves the test):
 *   1. the old URL is never called, in behaviour and in source;
 *   2. the request: URL, Basic auth, x-langfuse-ingestion-version: 4;
 *   3. the payload: resource, scope, spans and ONLY attribute names Langfuse documents;
 *   4. the ack: 2xx is acked, OTLP partialSuccess.rejectedSpans > 0 is not.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { __resetLangfuseForTests, flushLangfuse, getLangfuseStatus, traceGeneration } from "./lib/langfuse-ingest";

type AnyValue = { stringValue?: string; intValue?: string; boolValue?: boolean; arrayValue?: { values: AnyValue[] } };
type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: AnyValue }>;
  status?: { code: number; message?: string };
};
type OtlpBody = {
  resourceSpans: Array<{
    resource: { attributes: Array<{ key: string; value: AnyValue }> };
    scopeSpans: Array<{ scope: { name: string; version?: string }; spans: Span[] }>;
  }>;
};

function spansOf(body: unknown): Span[] {
  return (body as OtlpBody).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
}
function attrsOf(span: Span): Record<string, string | string[]> {
  return Object.fromEntries(
    span.attributes.map((a) => [a.key, a.value.arrayValue ? a.value.arrayValue.values.map((v) => v.stringValue ?? "") : (a.value.stringValue ?? "")]),
  );
}

function recorder(respond: () => Response = () => new Response("{}", { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit; json: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, json: JSON.parse(String(init.body)) });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function queueOne(over: Partial<Parameters<typeof traceGeneration>[0]> = {}) {
  return traceGeneration({ name: "lane:site", site: "lib/test.ts", model: "gpt-4o-mini", promptText: "p", latencyMs: 250, ok: true, ...over });
}

// Attribute names Langfuse documents for OTLP, copied from
// https://langfuse.com/integrations/native/opentelemetry (read 2026-10-17).
const DOCUMENTED = new Set([
  "langfuse.trace.name",
  "langfuse.trace.tags",
  "langfuse.release",
  "langfuse.environment",
  "langfuse.observation.type",
  "langfuse.observation.level",
  "langfuse.observation.status_message",
  "langfuse.observation.input",
  "langfuse.observation.output",
  "langfuse.observation.model.name",
  "langfuse.observation.usage_details",
]);
const DOCUMENTED_PREFIXES = ["langfuse.observation.metadata.", "langfuse.trace.metadata."];
const isDocumented = (k: string) => DOCUMENTED.has(k) || DOCUMENTED_PREFIXES.some((p) => k.startsWith(p));

const saved = { ...process.env };
beforeEach(() => {
  __resetLangfuseForTests();
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  delete process.env.LANGFUSE_BASE_URL;
});
afterEach(() => {
  __resetLangfuseForTests();
  process.env = { ...saved };
});

describe("the legacy ingestion endpoint is never called", () => {
  it("every request of a flush goes to /api/public/otel/v1/traces", async () => {
    for (let i = 0; i < 30; i++) queueOne(); // 60 spans: two batches
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    await flushLangfuse(fetchImpl);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c.url).toBe("https://us.cloud.langfuse.com/api/public/otel/v1/traces");
      expect(c.url).not.toContain("ingestion");
    }
  });

  it("the batch body is OTLP, not { batch: [...] }", async () => {
    queueOne();
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    expect(calls[0].json).not.toHaveProperty("batch");
    expect(calls[0].json).toHaveProperty("resourceSpans");
  });

  // Source gate with a planted control (positive-control-first): code, not comments.
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
      .join("\n");
  const OLD = /\/api\/public\/ingestion/;
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p);
    }
    return out;
  }

  it("planted control: the gate flags code that names the old URL and ignores a comment that does", () => {
    expect(OLD.test(stripComments("const u = `${b}/api/public/ingestion`;"))).toBe(true);
    expect(OLD.test(stripComments("// was POST /api/public/ingestion\nconst u = 1;"))).toBe(false);
  });

  it("no server source file names the old URL in code", () => {
    const offenders = walk(__dirname).filter((f) => OLD.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });
});

describe("the request", () => {
  it("POST with Basic auth, JSON content type and x-langfuse-ingestion-version: 4", async () => {
    queueOne();
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    expect(calls[0].init.method).toBe("POST");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json");
    expect(h.authorization).toBe(`Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
    expect(h["x-langfuse-ingestion-version"]).toBe("4");
  });

  it("LANGFUSE_BASE_URL decides the host and a trailing slash is not doubled", async () => {
    process.env.LANGFUSE_BASE_URL = "https://cloud.langfuse.com/";
    queueOne();
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    expect(calls[0].url).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
  });
});

describe("the payload contract", () => {
  it("one resource, one scope, a root span and a child generation span of one trace", async () => {
    queueOne({ traceId: "0123456789abcdef0123456789abcdef", metadata: { probeId: "p1", probe: true, n: 3, none: null } });
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    const body = calls[0].json as OtlpBody;
    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0].resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "nickstire" } });
    expect(body.resourceSpans[0].scopeSpans).toHaveLength(1);
    expect(body.resourceSpans[0].scopeSpans[0].scope.name).toBe("nickstire.langfuse");
    const [root, gen] = spansOf(body);
    expect(spansOf(body)).toHaveLength(2);
    expect(root.traceId).toBe("0123456789abcdef0123456789abcdef");
    expect(gen.traceId).toBe(root.traceId);
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(gen.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(gen.spanId).not.toBe(root.spanId);
    expect(root.parentSpanId).toBeUndefined();
    expect(gen.parentSpanId).toBe(root.spanId);
    expect(root.name).toBe("lane:site");
    expect(gen.name).toBe("lane:site");
    expect(Number.isInteger(gen.kind)).toBe(true); // enums are integers in OTLP/JSON
    // int64 timestamps are decimal strings; the generation lasted latencyMs.
    expect(gen.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(gen.endTimeUnixNano).toMatch(/^\d{19}$/);
    expect(BigInt(gen.endTimeUnixNano) - BigInt(gen.startTimeUnixNano)).toBe(250_000_000n);
    expect(root.startTimeUnixNano).toBe(gen.startTimeUnixNano);
    expect(root.endTimeUnixNano).toBe(gen.endTimeUnixNano);
  });

  it("span attributes use only names Langfuse documents, with the documented types", async () => {
    queueOne({ usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 }, metadata: { probeId: "p1", n: 3, flag: true, none: null } });
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    const [root, gen] = spansOf(calls[0].json);
    for (const span of [root, gen]) {
      for (const a of span.attributes) expect(isDocumented(a.key), `undocumented attribute ${a.key}`).toBe(true);
    }
    const r = attrsOf(root);
    const g = attrsOf(gen);
    expect(r["langfuse.observation.type"]).toBe("span");
    expect(g["langfuse.observation.type"]).toBe("generation");
    expect(r["langfuse.trace.name"]).toBe("lane:site");
    expect(r["langfuse.trace.tags"]).toEqual(["nickstire", "ok"]); // string[] -> arrayValue
    expect(g["langfuse.trace.tags"]).toEqual(["nickstire", "ok"]);
    expect(typeof r["langfuse.environment"]).toBe("string");
    expect(g["langfuse.observation.model.name"]).toBe("gpt-4o-mini");
    expect(g["langfuse.observation.level"]).toBe("DEFAULT");
    // usage_details is a JSON string
    expect(JSON.parse(g["langfuse.observation.usage_details"] as string)).toEqual({ input: 11, output: 7, total: 18 });
    // metadata is flattened per key and stringified; null is dropped; site/promptSha256/lengths ride along
    expect(g["langfuse.observation.metadata.probeId"]).toBe("p1");
    expect(g["langfuse.observation.metadata.n"]).toBe("3");
    expect(g["langfuse.observation.metadata.flag"]).toBe("true");
    expect(g).not.toHaveProperty("langfuse.observation.metadata.none");
    expect(g["langfuse.observation.metadata.site"]).toBe("lib/test.ts");
    expect(g["langfuse.observation.metadata.promptSha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(g["langfuse.observation.metadata.inputChars"]).toBe("0");
    expect(r["langfuse.trace.metadata.probeId"]).toBe("p1");
  });

  it("a generation with no usage carries no usage_details", async () => {
    queueOne();
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    expect(attrsOf(spansOf(calls[0].json)[1])).not.toHaveProperty("langfuse.observation.usage_details");
  });

  it("a failed call is level ERROR with the error class as status message and OTLP status code 2", async () => {
    queueOne({ ok: false, error: "HTTP 503" });
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    const gen = spansOf(calls[0].json)[1];
    const g = attrsOf(gen);
    expect(g["langfuse.observation.level"]).toBe("ERROR");
    expect(g["langfuse.observation.status_message"]).toBe("HTTP 503");
    expect(gen.status).toEqual({ code: 2, message: "HTTP 503" });
    expect(attrsOf(spansOf(calls[0].json)[0])["langfuse.trace.tags"]).toEqual(["nickstire", "error"]);
  });

  it("input and output ride as observation attributes only when excerpt is on", async () => {
    queueOne({ input: "ping", output: "pong" });
    queueOne({ input: "ping", output: "pong", excerpt: true });
    const { calls, fetchImpl } = recorder();
    await flushLangfuse(fetchImpl);
    const spans = spansOf(calls[0].json);
    expect(attrsOf(spans[1])).not.toHaveProperty("langfuse.observation.input");
    expect(attrsOf(spans[1])).not.toHaveProperty("langfuse.observation.output");
    expect(attrsOf(spans[3])["langfuse.observation.input"]).toBe("ping");
    expect(attrsOf(spans[3])["langfuse.observation.output"]).toBe("pong");
  });
});

describe("trace ids", () => {
  it("a 32-hex id is used as is and returned; a dashed UUID is the same id undashed; anything else hashes to a stable 32-hex id", async () => {
    const uuid = "7b3c1e9a-1111-4222-8333-444455556666";
    queueOne({ traceId: "0123456789abcdef0123456789abcdef" });
    queueOne({ traceId: uuid });
    queueOne({ traceId: "not hex at all" });
    const { calls, fetchImpl } = recorder();
    const r = await flushLangfuse(fetchImpl);
    const roots = spansOf(calls[0].json).filter((s) => s.parentSpanId === undefined);
    expect(roots.map((s) => s.traceId)).toEqual(["0123456789abcdef0123456789abcdef", "7b3c1e9a111142228333444455556666", expect.stringMatching(/^[0-9a-f]{32}$/)]);
    expect(r.traceIds).toEqual(roots.map((s) => s.traceId));
    // stable: the same odd id twice yields the same trace id
    queueOne({ traceId: "not hex at all" });
    const again = await flushLangfuse(recorder().fetchImpl);
    expect(again.traceIds).toEqual([roots[2].traceId]);
  });
});

describe("the ack", () => {
  const body = (o: unknown) => () => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

  it("200 with an empty OTLP response is acked", async () => {
    queueOne();
    const r = await flushLangfuse(recorder(body({})).fetchImpl);
    expect(r).toMatchObject({ ok: true, sent: 2, httpStatus: 200, attempted: true });
    expect(getLangfuseStatus()).toMatchObject({ batchesSent: 1, lastIngestOk: true, lastHttpStatus: 200 });
  });

  it("200 with an empty body is acked", async () => {
    queueOne();
    const r = await flushLangfuse(recorder(() => new Response("", { status: 200 })).fetchImpl);
    expect(r.ok).toBe(true);
  });

  it("200 with partialSuccess.rejectedSpans > 0 is NOT acked, even as an int64 string", async () => {
    queueOne();
    const r = await flushLangfuse(recorder(body({ partialSuccess: { rejectedSpans: "1", errorMessage: "span rejected" } })).fetchImpl);
    expect(r).toMatchObject({ ok: false, sent: 1, httpStatus: 200, traceIds: [] });
    expect(r.error).toContain("1 of 2 span(s) rejected");
    expect(getLangfuseStatus()).toMatchObject({ batchesFailed: 1, lastIngestOk: false });
  });

  it("partialSuccess with rejectedSpans 0 is a warning, not a rejection", async () => {
    queueOne();
    const r = await flushLangfuse(recorder(body({ partialSuccess: { rejectedSpans: "0", errorMessage: "heads up" } })).fetchImpl);
    expect(r.ok).toBe(true);
  });

  it("a 401 and a thrown fetch are not acked", async () => {
    queueOne();
    const denied = await flushLangfuse(recorder(() => new Response("bad key", { status: 401 })).fetchImpl);
    expect(denied).toMatchObject({ ok: false, httpStatus: 401 });
    queueOne();
    const boom = await flushLangfuse((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    expect(boom).toMatchObject({ ok: false, httpStatus: null });
  });

  it("the queue stays bounded: the 101st trace is dropped and counted", () => {
    for (let i = 0; i < 100; i++) expect(queueOne()).toBe("queued");
    expect(queueOne()).toBe("dropped");
    expect(getLangfuseStatus()).toMatchObject({ queued: 200, eventsDropped: 1, eventsTraced: 100 });
  });
});

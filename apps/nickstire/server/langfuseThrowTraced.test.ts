/**
 * A provider call that THROWS (timeout, DNS, abort) is traced, then rethrown.
 *
 * Review P2-2 (2026-10-17): the raw-fetch sites traced success and non-2xx but
 * never a throw, so the worst failures (provider down, DNS gone) left no trace
 * at all. Two halves:
 *   1. behaviour: a rejected fetch at real entry points (aiGateway,
 *      generateImage) leaves exactly one ok:false generation with the error
 *      CLASS, and the caller still sees the original error;
 *   2. source gate: every server file that calls fetch( on a provider endpoint
 *      also routes throws through traceThrown / rethrowTraced, unless its
 *      provider calls already catch every throw into a result that a traced
 *      entry point records (listed with the reason). Planted control first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { __resetLangfuseForTests, flushLangfuse, getLangfuseStatus } from "./lib/langfuse-ingest";
import { aiGateway } from "./lib/ai-gateway";
import { generateImage } from "./_core/imageGeneration";

const PROVIDER_ENDPOINT =
  /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|ollama\.com|openrouter\.ai|\/v1\/chat\/completions|\/api\/chat`|router\.huggingface\.co\/hf-inference|\/v1\/audio\/transcriptions|\/v1\/images\/generations|predictLongRunning|REPLICATE_API_BASE\}\/predictions`/;
const THROW_TRACE = /\b(traceThrown|rethrowTraced)\(/;
const RAW_FETCH = /\bfetch\(/;

/** Provider files whose throws never escape untraced, with the reason. */
const THROW_EXEMPT: Record<string, string> = {
  "lib/langfuse-ingest.ts": "the tracer itself",
  "_core/llm.ts": "invokeLLM's own catch traces every throw (traceChat ok:false) before rethrowing",
  "services/vision-analyzer.ts": "every backend catches throws into { ok:false } and the traced entry points record that result",
  "services/classifiers.ts": "the HF calls catch throws into { ok:false } and the traced entry points record that result",
  "services/voice-clone.ts": "the Replicate/Modal calls catch throws into { ok:false } and the traced entry point records that result",
};

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

function throwUntraced(src: string): boolean {
  const code = stripComments(src);
  return PROVIDER_ENDPOINT.test(code) && RAW_FETCH.test(code) && !THROW_TRACE.test(code);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The generation spans of every OTLP request, attributes flattened to { key: string }. */
async function wire(): Promise<Array<{ name: string; attrs: Record<string, string>; status?: { code: number; message?: string } }>> {
  const bodies: string[] = [];
  const ingest = (async (_u: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await flushLangfuse(ingest);
  return bodies
    .flatMap((b) => JSON.parse(b).resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((s: any) => s.spans)))
    .map((sp: any) => ({
      name: sp.name,
      status: sp.status,
      attrs: Object.fromEntries(sp.attributes.map((a: any) => [a.key, a.value.stringValue])) as Record<string, string>,
    }))
    .filter((sp) => sp.attrs["langfuse.observation.type"] === "generation");
}

describe("a thrown provider fetch is traced, then rethrown", () => {
  const saved = { ...process.env };
  const dnsError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  beforeEach(() => {
    __resetLangfuseForTests();
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_FORCE_GEMINI;
    vi.stubGlobal("fetch", vi.fn(async () => { throw dnsError(); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetLangfuseForTests();
    process.env = { ...saved };
  });

  it("aiGateway: DNS failure -> one ok:false generation 'TypeError:ENOTFOUND', original error rethrown", async () => {
    await expect(aiGateway({ task: "chat", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("fetch failed");
    expect(getLangfuseStatus().queued).toBe(2);
    const [gen] = await wire();
    expect(gen.name).toBe("gateway:openai");
    expect(gen.attrs).toMatchObject({ "langfuse.observation.level": "ERROR", "langfuse.observation.status_message": "TypeError:ENOTFOUND" });
  });

  it("generateImage: DNS failure -> one ok:false generation, original error rethrown", async () => {
    await expect(generateImage({ prompt: "a tire" })).rejects.toThrow("fetch failed");
    const gens = await wire();
    expect(gens).toHaveLength(1);
    expect(gens[0].name).toBe("image:openai");
    expect(gens[0].attrs).toMatchObject({ "langfuse.observation.level": "ERROR", "langfuse.observation.status_message": "TypeError:ENOTFOUND" });
  });

  it("a non-2xx already traced is not traced a second time by the catch-all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(aiGateway({ task: "chat", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("AI Gateway 503");
    expect(await wire()).toHaveLength(1);
  });
});

describe("source gate: provider throws are routed through the tracer", () => {
  const files = walk(__dirname);
  const rel = (p: string) => relative(__dirname, p).replace(/\\/g, "/");

  it("planted control: a raw provider fetch without a throw trace is flagged; with one it is not", () => {
    const planted = 'const r = await fetch("https://api.openai.com/v1/chat/completions"); traceChat({} as any);';
    expect(throwUntraced(planted)).toBe(true);
    expect(throwUntraced(`${planted}\nawait p.catch(rethrowTraced({} as any));`)).toBe(false);
    expect(throwUntraced(`${planted}\n// traceThrown( mentioned in a comment`)).toBe(true);
  });

  it("no provider file lets a throw escape untraced", () => {
    const offenders = files
      .map((f) => ({ f: rel(f), src: readFileSync(f, "utf8") }))
      .filter(({ f, src }) => !THROW_EXEMPT[f] && throwUntraced(src))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});

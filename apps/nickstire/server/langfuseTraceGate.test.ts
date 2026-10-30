/**
 * Gate: every server file that calls an AI provider also traces it.
 *
 * Same shape as statenour's ai-sdk-telemetry-gate: a source scan, because a
 * new direct `fetch` to a provider is exactly the call the gateway never sees.
 * A file whose CODE (comments stripped) names a provider endpoint must call
 * traceChat( or traceGeneration( from lib/langfuse-ingest.ts. File-level, so
 * it catches a new untraced file, not a second untraced fetch inside a traced
 * file (shortcut: per-file granularity; upgrade to per-fetch-site counting if
 * a traced file ever grows a second provider call that skips the trace).
 *
 * The planted control below proves the scanner fires; without it a regex that
 * matched nothing would keep this green forever.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const PROVIDER_ENDPOINT =
  /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|ollama\.com|openrouter\.ai|\/v1\/chat\/completions|\/api\/chat`|router\.huggingface\.co\/hf-inference|\/v1\/audio\/transcriptions|\/v1\/images\/generations|predictLongRunning|REPLICATE_API_BASE\}\/predictions`/;
const TRACE_CALL = /\btrace(Chat|Generation)\(/;

/** Files that name an endpoint but make no generation call. Each needs a reason. */
const EXEMPT: Record<string, string> = {
  "lib/langfuse-ingest.ts": "the tracer itself",
  "services/smsReplyEval.ts": "the SMS eval's fetch allow-list names the model hosts it lets through; it makes no generation call (orchestrateSms -> draftSmsReply does, traced)",
};

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

export function untracedProviderFile(src: string): boolean {
  const code = stripComments(src);
  return PROVIDER_ENDPOINT.test(code) && !TRACE_CALL.test(code);
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

describe("every AI provider call site is traced in Langfuse", () => {
  const files = walk(__dirname);
  const rel = (p: string) => relative(__dirname, p).replace(/\\/g, "/");

  it("finds the known provider sites (the scan is not silently empty)", () => {
    const sites = files.filter((f) => PROVIDER_ENDPOINT.test(stripComments(readFileSync(f, "utf8")))).map(rel);
    for (const known of ["_core/llm.ts", "lib/ai-gateway.ts", "services/nickgpt-client.ts", "services/vision-analyzer.ts", "services/igAutopost.ts"]) {
      expect(sites).toContain(known);
    }
  });

  it("no provider file is untraced", () => {
    const offenders = files
      .map((f) => ({ f: rel(f), src: readFileSync(f, "utf8") }))
      .filter(({ f, src }) => !EXEMPT[f] && untracedProviderFile(src))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it("planted control: an untraced provider fetch is flagged, a traced one is not, a comment is not a call", () => {
    const untraced = 'const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST" });';
    expect(untracedProviderFile(untraced)).toBe(true);
    expect(untracedProviderFile(`${untraced}\ntraceChat({ name: "x" } as any);`)).toBe(false);
    // Mentioning the tracer in a comment must not satisfy the gate.
    expect(untracedProviderFile(`${untraced}\n// traceChat( is called elsewhere`)).toBe(true);
    expect(untracedProviderFile(`${untraced}\n/* traceGeneration( */`)).toBe(true);
  });
});

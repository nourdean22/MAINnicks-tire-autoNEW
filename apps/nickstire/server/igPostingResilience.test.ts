/**
 * IG-lane liveness + structured-output resilience.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const llmMock = (
  invokeLLM: (params: any) => any,
  resolveEffectiveModel: (model?: string) => string | undefined = (model) => model,
  isOllamaModel: (model?: string) => boolean = () => false,
) => ({ invokeLLM, resolveEffectiveModel, isOllamaModel });

describe("invokeLLMForPosting retries once and only once", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("./_core/llm");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const good = { choices: [{ message: { content: '{"ok":true}' } }] };
  const empty = { choices: [{ message: { content: "   " } }] };
  const load = async () => (await import("./services/igPostingLlm")).invokeLLMForPosting;

  it("an empty completion is retried, and the second answer is returned", async () => {
    const calls: unknown[] = [];
    vi.doMock("./_core/llm", () => llmMock(async (p: unknown) => {
      calls.push(p);
      return calls.length === 1 ? empty : good;
    }));
    const fn = await load();
    const res = await fn({ messages: [{ role: "user", content: "x" }] } as never);
    expect(res.choices[0].message.content).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
  });

  it("a thrown transport error is retried once", async () => {
    let n = 0;
    vi.doMock("./_core/llm", () => llmMock(async () => {
      n += 1;
      if (n === 1) throw new Error("The operation was aborted due to timeout");
      return good;
    }));
    const fn = await load();
    await expect(fn({ messages: [] } as never)).resolves.toBeTruthy();
    expect(n).toBe(2);
  });

  it("two failures throw — no third attempt, no unbounded loop", async () => {
    let n = 0;
    vi.doMock("./_core/llm", () => llmMock(async () => {
      n += 1;
      throw new Error("The operation was aborted due to timeout");
    }));
    const fn = await load();
    await expect(fn({ messages: [] } as never)).rejects.toThrow(/timeout/);
    expect(n).toBe(2);
  });

  it("guards are defaults, not overrides — a caller's own values win", async () => {
    let seen: Record<string, unknown> = {};
    vi.doMock("./_core/llm", () => llmMock(async (p: Record<string, unknown>) => {
      seen = p;
      return good;
    }));
    const fn = await load();
    await fn({ messages: [], timeoutMs: 5_000 } as never);
    expect(seen.timeoutMs).toBe(5_000);
    expect(seen.priority).toBe(1);
  });
});

describe("structured posting retries malformed JSON before any side effect", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("./_core/llm");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const loadStructured = async () => (await import("./services/igPostingLlm")).invokeStructuredPosting;

  it("retries a non-empty truncated JSON response at the parse boundary", async () => {
    const calls: unknown[] = [];
    vi.doMock("./_core/llm", () => llmMock(async (p: unknown) => {
      calls.push(p);
      return calls.length === 1
        ? { choices: [{ message: { content: '{"caption":"cut' } }] }
        : { choices: [{ message: { content: '{"caption":"ok","hashtags":[],"imagePrompt":"x","conceptKey":"y"}' } }] };
    }));

    const fn = await loadStructured();
    const parsed = await fn<{ caption: string }>({ messages: [] } as never, "test");
    expect(parsed.caption).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("stops after two malformed structured responses", async () => {
    let calls = 0;
    vi.doMock("./_core/llm", () => llmMock(async () => {
      calls += 1;
      return { choices: [{ message: { content: '{"caption":"still cut' } }] };
    }));

    const fn = await loadStructured();
    await expect(fn({ messages: [] } as never, "test")).rejects.toThrow(/truncated/i);
    expect(calls).toBe(2);
  });

  it("keeps unsupported json_schema transport off the Venice lane but preserves the schema in-prompt", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://api.venice.ai/api/v1");
    let seen: any;
    vi.doMock("./_core/llm", () => llmMock(async (p: any) => {
      seen = p;
      return { choices: [{ message: { content: '{"caption":"ok"}' } }] };
    }, (model) => model ?? "llama-3.3-70b-instruct"));

    const fn = await loadStructured();
    const schema = {
      name: "ig_post",
      schema: {
        type: "object",
        properties: { caption: { type: "string" } },
        required: ["caption"],
      },
      strict: true,
    };
    await expect(fn<{ caption: string }>({
      messages: [{ role: "user", content: "write it" }],
      outputSchema: schema,
    } as never, "test")).resolves.toEqual({ caption: "ok" });

    expect(seen.outputSchema).toBeUndefined();
    expect(seen.output_schema).toBeUndefined();
    expect(seen.responseFormat).toBeUndefined();
    expect(seen.response_format).toBeUndefined();
    expect(seen.messages.at(-1)?.role).toBe("system");
    expect(seen.messages.at(-1)?.content).toContain('"caption"');
  });

  it("retains native schema transport for a Gemini-routed posting call", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://api.venice.ai/api/v1");
    let seen: any;
    vi.doMock("./_core/llm", () => llmMock(async (p: any) => {
      seen = p;
      return { choices: [{ message: { content: '{"caption":"ok"}' } }] };
    }, () => "gemini-2.5-flash"));

    const fn = await loadStructured();
    const outputSchema = {
      name: "ig_post",
      schema: { type: "object", properties: { caption: { type: "string" } }, required: ["caption"] },
    };
    await fn<{ caption: string }>({ messages: [], outputSchema, model: "gemini-2.5-flash" } as never, "test");
    expect(seen.outputSchema).toEqual(outputSchema);
  });
});

describe("every posting-lane LLM call carries the guards", () => {
  it("igAutopost has no bare invokeLLM call left", () => {
    const src = read("server/services/igAutopost.ts");
    const resilience = read("server/services/igPostingLlm.ts");
    expect(src.match(/await invokeLLM\(/g) ?? []).toHaveLength(0);
    expect(resilience.match(/await invokeLLM\(/g) ?? []).toHaveLength(1);
    expect(src.match(/invokeLLMForPosting\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("invokeStructuredPosting<");
  });

  it("the caption generator wires the schema and the measured DeepSeek output budget", () => {
    const src = read("server/services/igAutopost.ts");
    const start = src.indexOf("async function generatePost(");
    const end = src.indexOf("// IMAGE", start);
    const body = src.slice(start, end);
    expect(body).toContain("invokeStructuredPosting");
    expect(body).toContain("outputSchema: GEN_SCHEMA");
    // Live failed runs on 2026-09-25..27 repeatedly consumed exactly 4096
    // completion tokens before returning empty/truncated JSON. Keep the fix
    // local to generation instead of changing the whole estate's model route.
    expect(body).toContain("max_tokens: 8192");
    expect(body).not.toContain("max_tokens: 4096");
  });

  it("the daily brief call is a live lane, not background", () => {
    const src = read("server/services/reelBriefGen.ts");
    const fn = src.slice(src.indexOf("Full-brief generation routinely exceeds"));
    const call = fn.slice(0, fn.indexOf("});"));
    expect(call).toContain("priority: 1");
    expect(call).toContain("timeoutMs: 120000");
  });
});

describe("the daily tick names repair states instead of calling them unknown", () => {
  it("repair_queued/rendering read as in-flight; repair_failed reads as needing action", () => {
    const src = read("server/cron/jobs/dailyReelPost.ts");
    expect(src).toContain("Repair in flight (status: ${job.status})");
    expect(src).toContain("Repair FAILED - waiting for a re-queue");
    expect(src).toContain("Unknown job status:");
  });
});

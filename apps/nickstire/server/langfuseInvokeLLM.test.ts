/**
 * Consumer end of the Langfuse wiring: a real invokeLLM call (provider fetch
 * stubbed) produces one masked trace that reaches the ingestion request. A gate
 * that only checks the source for `traceChat(` cannot tell a trace that is
 * called from one that is built and never sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invokeLLM } from "./_core/llm";
import { __resetLangfuseForTests, flushLangfuse, getLangfuseStatus } from "./lib/langfuse-ingest";

describe("invokeLLM is traced in Langfuse", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    __resetLangfuseForTests();
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.AI_FORCE_OLLAMA;
    delete process.env.AI_FORCE_GEMINI;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_LEDGER_ENABLED;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            choices: [{ message: { role: "assistant", content: "We can see you today, call 216-555-0199." } }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          }),
          { status: 200 },
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetLangfuseForTests();
    process.env = { ...saved };
  });

  it("one call -> one trace + generation, tokens counted, phone masked on the wire", async () => {
    await invokeLLM({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are the shop assistant." },
        { role: "user", content: "My number is 216-555-0142, can I come in?" },
      ],
    });
    expect(getLangfuseStatus().queued).toBe(2);
    const bodies: string[] = [];
    const ingest = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await flushLangfuse(ingest);
    expect(r).toMatchObject({ ok: true, attempted: true, sent: 2 });
    const batch = JSON.parse(bodies[0]).batch as Array<{ type: string; body: Record<string, any> }>;
    const gen = batch.find((e) => e.type === "generation-create")!;
    expect(gen.body.model).toBe("gpt-4o-mini");
    expect(gen.body.usage).toEqual({ input: 11, output: 7, total: 18 });
    expect(gen.body.metadata.site).toBe("_core/llm.ts");
    expect(bodies[0]).not.toMatch(/555[-\s]?01(42|99)/);
    expect(bodies[0]).not.toContain("You are the shop assistant.");
  });

  it("tracing off (keys unset) leaves the call untouched and queues nothing", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    const out = await invokeLLM({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
    expect(out.choices[0].message.content).toContain("We can see you today");
    expect(getLangfuseStatus().queued).toBe(0);
  });
});

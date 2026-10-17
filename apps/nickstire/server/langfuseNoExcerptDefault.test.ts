/**
 * Langfuse is a third party: by default a trace carries NO free text.
 *
 * Review finding P2-1 (2026-10-17): the masker leaves names in structured or
 * unintroduced text, and up to 400 chars of the last user turn went to
 * Langfuse. The default is inverted: model, prompt hash, lengths, tokens,
 * latency and an error CLASS only. Excerpts are a per-call opt-in
 * (`excerpt: true`) for sites whose text carries no customer data, and are
 * still masked.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetLangfuseForTests, flushLangfuse, traceChat } from "./lib/langfuse-ingest";

const SAMPLES = ["Customer name: Maria Lopez", "Maria Lopez here", "Lopez, Maria 44101"];

async function wireBodies(): Promise<string> {
  const bodies: string[] = [];
  const fakeFetch = (async (_u: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await flushLangfuse(fakeFetch);
  return bodies.join("\n");
}

describe("traces carry no free text by default", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    __resetLangfuseForTests();
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  });
  afterEach(() => {
    __resetLangfuseForTests();
    process.env = { ...saved };
  });

  for (const sample of SAMPLES) {
    it(`no name on the wire for input "${sample}" (and the same text as output and as an error)`, async () => {
      traceChat({
        name: "llm:test",
        site: "test",
        model: "m",
        messages: [{ role: "user", content: sample }],
        outputText: `Thanks ${sample}`,
        startedAt: Date.now() - 5,
        ok: true,
      });
      traceChat({ name: "llm:test", site: "test", model: "m", messages: sample, startedAt: Date.now(), ok: false, error: new Error(`provider echoed: ${sample}`) });
      const wire = await wireBodies();
      expect(wire.length).toBeGreaterThan(0);
      expect(wire).not.toMatch(/Maria|Lopez|44101/);
      // What a default trace DOES carry: lengths and the prompt hash.
      expect(wire).toMatch(/"langfuse\.observation\.metadata\.inputChars","value":\{"stringValue":"\d+"\}/);
      expect(wire).toMatch(/"langfuse\.observation\.metadata\.promptSha256","value":\{"stringValue":"[0-9a-f]{64}"\}/);
    });
  }

  it("an error is sent as its class, never its message", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    traceChat({ name: "x", site: "s", model: "m", messages: "p", startedAt: Date.now(), ok: false, error: timeout });
    traceChat({ name: "x", site: "s", model: "m", messages: "p", startedAt: Date.now(), ok: false, error: "HTTP 503: upstream said Maria Lopez" });
    const wire = await wireBodies();
    expect(wire).toContain('"langfuse.observation.status_message","value":{"stringValue":"TimeoutError"}');
    expect(wire).toContain('"langfuse.observation.status_message","value":{"stringValue":"HTTP 503"}');
    expect(wire).not.toContain("aborted due to timeout");
  });

  it("excerpt: true opts in, and the opted-in text is still masked", async () => {
    traceChat({
      name: "probe",
      site: "s",
      model: "m",
      messages: [{ role: "user", content: "ping call 216-555-0142" }],
      outputText: "pong",
      startedAt: Date.now(),
      ok: true,
      excerpt: true,
    });
    const wire = await wireBodies();
    expect(wire).toContain("pong");
    expect(wire).toContain("ping");
    expect(wire).not.toMatch(/555[-\s]?0142/);
  });
});

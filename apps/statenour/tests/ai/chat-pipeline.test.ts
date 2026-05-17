/**
 * tests/ai/chat-pipeline.test.ts — chat pipeline contract tests.
 *
 * The chat route is the single most-trafficked endpoint and the most
 * fragile to refactor. Without contract tests on its component
 * pieces, regressions surface in production as "Nick stopped working"
 * with cryptic 500s.
 *
 * Coverage here:
 *   1. Stage tracker (timing.ts) — order-preserving, cache marking,
 *      subtask attribution, formatStageLog output shape
 *   2. Gate input validation (gate.ts) — bad body, empty messages,
 *      invalid JSON all bounce with structured 4xx
 *   3. Gate text extraction — handles legacy string content + v6
 *      parts arrays + malformed payloads gracefully
 *   4. Gate persona/override pass-through — the route depends on
 *      these defaults to be correct
 *
 * Mocks:
 *   - rate-limit always allows
 *   - power-panel budget always allows
 *   - intent-classifier returns a deterministic persona
 *
 * What this DOESN'T cover:
 *   - The actual SSE byte stream (need an integration env)
 *   - Tool execution (covered by tool-catalog tests)
 *   - End-to-end /api/ai/chat (covered by manual smoke + production)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: Date.now() + 60_000 })),
  getClientIp: vi.fn(() => "127.0.0.1"),
  RATE_LIMITS: { ai: { capacity: 10, refillPerMinute: 10 } },
}));
vi.mock("@/lib/services/power-panel", () => ({
  checkAiBudget: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/ai/intent-classifier", () => ({
  inferPersona: vi.fn(() => ({ persona: "master", confidence: 0.8 })),
}));

import { runGate, extractText } from "@/lib/ai/chat/gate";
import { classifyIntercept } from "@/lib/ai/chat/interceptors";
import {
  createStageTracker,
  formatStageLog,
  KNOWN_STAGES,
} from "@/lib/ai/chat/timing";
import * as rateLimit from "@/lib/rate-limit";
import * as powerPanel from "@/lib/services/power-panel";

function jsonRequest(body: unknown): Request {
  return new Request("https://test.local/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimit.checkRateLimit).mockReturnValue({
    allowed: true,
    resetAt: Date.now() + 60_000,
  } as ReturnType<typeof rateLimit.checkRateLimit>);
  vi.mocked(powerPanel.checkAiBudget).mockResolvedValue({ allowed: true });
});

describe("chat-pipeline · stage tracker", () => {
  it("times stages and reports them in order observed", async () => {
    const t = createStageTracker();
    const a = t.start("gate");
    await new Promise((r) => setTimeout(r, 5));
    a.end();
    const b = t.start("prefetch");
    await new Promise((r) => setTimeout(r, 8));
    b.end();
    const summary = t.summary();
    expect(Object.keys(summary.stages)).toEqual(["gate", "prefetch"]);
    expect(summary.stages.gate.ms).toBeGreaterThanOrEqual(0);
    expect(summary.stages.prefetch.ms).toBeGreaterThanOrEqual(0);
    expect(summary.totalMs).toBeGreaterThanOrEqual(
      summary.stages.gate.ms + summary.stages.prefetch.ms - 1,
    );
  });

  it("accumulates time on repeated start() of the same stage", () => {
    const t = createStageTracker();
    const first = t.start("classify");
    first.end();
    const second = t.start("classify");
    second.end();
    const summary = t.summary();
    // Same stage hit twice → single entry, accumulated ms (≥ 0)
    expect(Object.keys(summary.stages)).toEqual(["classify"]);
    expect(summary.stages.classify.ms).toBeGreaterThanOrEqual(0);
  });

  it("attaches subtasks + cacheHit + meta without losing the ms", () => {
    const t = createStageTracker();
    const timer = t.start("prefetch");
    timer.subtask("system-prompt", 80);
    timer.subtask("recall", 110);
    timer.end();
    t.cacheHit("prefetch", true);
    t.meta("prefetch", { tools: 18, mode: "standard" });
    const summary = t.summary();
    expect(summary.stages.prefetch.subs).toEqual({
      "system-prompt": 80,
      recall: 110,
    });
    expect(summary.stages.prefetch.cacheHit).toBe(true);
    expect(summary.stages.prefetch.meta).toEqual({
      tools: 18,
      mode: "standard",
    });
  });

  it("formatStageLog renders a single-line summary", () => {
    const t = createStageTracker();
    t.start("gate").end();
    t.cacheHit("prefetch", true);
    t.start("prefetch").end();
    const line = formatStageLog("req-abc", "standard", t.summary());
    expect(line).toMatch(/\[chat-pipeline reqId=req-abc mode=standard\]/);
    expect(line).toMatch(/gate=\d+/);
    expect(line).toMatch(/prefetch=\d+\(cache\)/);
    expect(line).toMatch(/total=\d+ms/);
  });

  it("KNOWN_STAGES enumerates the canonical pipeline stages", () => {
    expect(KNOWN_STAGES).toContain("gate");
    expect(KNOWN_STAGES).toContain("stream-text");
    expect(KNOWN_STAGES).toContain("post-stream");
    expect(KNOWN_STAGES.length).toBeGreaterThanOrEqual(7);
  });
});

describe("chat-pipeline · gate validation", () => {
  it("blocks rate-limited requests with 429 + Retry-After", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValueOnce({
      allowed: false,
      resetAt: Date.now() + 5_000,
    } as ReturnType<typeof rateLimit.checkRateLimit>);

    const req = jsonRequest({ messages: [{ role: "user", content: "hi" }] });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
    if (res.kind === "block") {
      expect(res.response.status).toBe(429);
      expect(res.response.headers.get("Retry-After")).toBeTruthy();
    }
  });

  it("blocks budget-paused requests with 429 + reason", async () => {
    vi.mocked(powerPanel.checkAiBudget).mockResolvedValueOnce({
      allowed: false,
      reason: "daily_cap_hit",
    } as Awaited<ReturnType<typeof powerPanel.checkAiBudget>>);

    const req = jsonRequest({ messages: [{ role: "user", content: "hi" }] });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
    if (res.kind === "block") {
      expect(res.response.status).toBe(429);
      const body = await res.response.json();
      expect(body.reason).toBe("daily_cap_hit");
    }
  });

  it("blocks invalid JSON with 400", async () => {
    const req = new Request("https://test.local/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
    if (res.kind === "block") {
      expect(res.response.status).toBe(400);
      const body = await res.response.json();
      expect(body.error).toMatch(/json/i);
    }
  });

  it("blocks empty messages array with 400", async () => {
    const req = jsonRequest({ messages: [] });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
    if (res.kind === "block") {
      expect(res.response.status).toBe(400);
    }
  });

  it("blocks suspiciously long message lists (>200) with 400", async () => {
    const messages = Array.from({ length: 250 }, () => ({
      role: "user",
      content: "x",
    }));
    const req = jsonRequest({ messages });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
    if (res.kind === "block") {
      expect(res.response.status).toBe(400);
    }
  });

  it("blocks non-array messages payload with 400", async () => {
    const req = jsonRequest({ messages: { foo: "bar" } });
    const res = await runGate(req);
    expect(res.kind).toBe("block");
  });
});

describe("chat-pipeline · gate pass shape", () => {
  it("passes through legacy string-content user message", async () => {
    const req = jsonRequest({
      messages: [{ role: "user", content: "what's my MIT?" }],
      conversationId: "abc-123",
      personality: "builder",
    });
    const res = await runGate(req);
    expect(res.kind).toBe("pass");
    if (res.kind === "pass") {
      expect(res.userContent).toBe("what's my MIT?");
      expect(res.conversationId).toBe("abc-123");
      // Explicit personality wins over inferred
      expect(res.personality).toBe("builder");
      expect(res.messages.length).toBe(1);
    }
  });

  it("extracts text from v6 parts array", async () => {
    const req = jsonRequest({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "first " },
            { type: "text", text: "and second" },
            { type: "image", url: "ignored.png" },
          ],
        },
      ],
    });
    const res = await runGate(req);
    expect(res.kind).toBe("pass");
    if (res.kind === "pass") {
      expect(res.userContent).toBe("first  and second");
    }
  });

  it("passes overrides through to caller", async () => {
    const req = jsonRequest({
      messages: [{ role: "user", content: "hello" }],
      modeOverride: "deep",
      providerOverride: "anthropic",
      taskTypeOverride: "reasoning",
    });
    const res = await runGate(req);
    expect(res.kind).toBe("pass");
    if (res.kind === "pass") {
      expect(res.modeOverride).toBe("deep");
      expect(res.providerOverride).toBe("anthropic");
      expect(res.taskTypeOverride).toBe("reasoning");
    }
  });

  it("infers persona when no explicit override is set", async () => {
    const req = jsonRequest({
      messages: [{ role: "user", content: "build me a quick hack" }],
    });
    const res = await runGate(req);
    expect(res.kind).toBe("pass");
    if (res.kind === "pass") {
      // Mock returns "master" — proves the inference path was hit
      expect(res.personality).toBe("master");
    }
  });

  it("returns empty userContent when last message isn't from user", async () => {
    const req = jsonRequest({
      messages: [{ role: "assistant", content: "I responded earlier" }],
    });
    const res = await runGate(req);
    expect(res.kind).toBe("pass");
    if (res.kind === "pass") {
      expect(res.userContent).toBe("");
    }
  });
});

describe("chat-pipeline · interceptor classifier", () => {
  // Pure classifier from lib/ai/chat/interceptors.ts — no DB, no
  // network. Tests the regex matrix that decides whether the route
  // skips the model pipeline.
  it("matches /img and /image and /picture slash commands", () => {
    expect(classifyIntercept("/img a sunset").slashImage).toBe(true);
    expect(classifyIntercept("/image of a tire").slashImage).toBe(true);
    expect(classifyIntercept("/picture please").slashImage).toBe(true);
    expect(classifyIntercept("/img").slashImage).toBe(true);
  });

  it("matches NL image asks ('make me a picture of …')", () => {
    expect(classifyIntercept("make me a picture of a sunset").nlImage).toBe(true);
    expect(classifyIntercept("generate an image of a car").nlImage).toBe(true);
    // "draw" alone without an image noun is intentionally NOT a match —
    // "draw me an illustration" / "draw a picture" needs the explicit
    // visual noun so unrelated asks ("draw a conclusion") don't trip
    // the fast path. Pinned here so future regex tweaks are deliberate.
    expect(classifyIntercept("draw a tire shop").nlImage).toBe(false);
    expect(classifyIntercept("draw an illustration of a tire shop").nlImage).toBe(true);
  });

  it("rejects metaphorical 'image plan'/'picture summary' false positives", () => {
    expect(classifyIntercept("give me an image plan").nlImage).toBe(false);
    expect(classifyIntercept("show me a picture summary of Q1").nlImage).toBe(false);
    expect(classifyIntercept("make me a picture roadmap").nlImage).toBe(false);
  });

  it("matches decision-log triggers (explicit log framing)", () => {
    expect(classifyIntercept("log this decision: pivot to mobile").decision).toBe(true);
    expect(classifyIntercept("decision: hire one tech").decision).toBe(true);
    expect(classifyIntercept("my decision: drop tire sales").decision).toBe(true);
    expect(classifyIntercept("my decision is to focus on labor").decision).toBe(true);
  });

  // v10.0.392 · bare "I decided to" no longer fires decision interceptor
  // because it over-fired on conversational reflection ('I decided to
  // take a different angle'). Operator must use explicit log framing.
  it("v10.0.392 · bare 'decided to' is conversational, NOT decision log", () => {
    expect(classifyIntercept("I decided to drop tire sales").decision).toBe(false);
    expect(classifyIntercept("decided to focus on labor").decision).toBe(false);
    expect(classifyIntercept("I've decided to take a different angle").decision).toBe(false);
  });

  it("matches brain-dump triggers", () => {
    expect(classifyIntercept("remember that I owe Dania a call").brainDump).toBe(true);
    expect(classifyIntercept("note: tire vendor changed terms").brainDump).toBe(true);
    expect(classifyIntercept("journal: today felt heavy").brainDump).toBe(true);
    expect(classifyIntercept("brain dump: scattered thoughts about Q3").brainDump).toBe(true);
  });

  it("returns any:false for normal conversational asks", () => {
    expect(classifyIntercept("what's my MIT today?").any).toBe(false);
    expect(classifyIntercept("how's revenue trending?").any).toBe(false);
    expect(classifyIntercept("hey").any).toBe(false);
  });

  it("returns any:true when at least one path matches", () => {
    expect(classifyIntercept("/img test").any).toBe(true);
    expect(classifyIntercept("decision: ship it").any).toBe(true);
    // Brain-dump regex requires content AFTER the trigger phrase —
    // "remember that" alone (no thought) is intentionally a miss so
    // the user gets the validation error, not a fast-path success.
    expect(classifyIntercept("remember that I owe Dania a call").any).toBe(true);
  });

  it("does not match decision/brain-dump when the trigger word is mid-sentence", () => {
    // "I should remember that…" does match — the regex is anchored to
    // start of string. This test pins the anchored behavior so a
    // future loosening of the regex is caught.
    expect(classifyIntercept("can you help me decide later").any).toBe(false);
    expect(classifyIntercept("the journal article was useful").any).toBe(false);
  });
});

describe("chat-pipeline · extractText helper", () => {
  it("returns string content directly", () => {
    expect(extractText({ role: "user", content: "hello" })).toBe("hello");
  });

  it("joins text-typed parts and ignores other types", () => {
    expect(
      extractText({
        role: "user",
        parts: [
          { type: "text", text: "a" },
          { type: "image", url: "x" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a b");
  });

  it("falls back to JSON-stringify for unknown content shapes", () => {
    const out = extractText({ content: { weird: 1 } });
    expect(out).toContain("weird");
  });

  it("returns empty string for missing content", () => {
    expect(extractText({})).toBe("");
  });

  it("handles parts arrays with non-text values gracefully", () => {
    expect(
      extractText({
        parts: [
          { type: "text" }, // missing text
          { type: "text", text: "real" },
        ],
      }),
    ).toBe("real");
  });
});

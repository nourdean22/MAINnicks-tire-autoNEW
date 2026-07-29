/**
 * tests/observability/otel-genai-map.test.ts — WP-20 (2026-07-29).
 * The privacy allowlist is the load-bearing assertion: this mapper is
 * the seam where trace data could leak into a generic backend.
 */

import { describe, it, expect } from "vitest";
import {
  classifySpan,
  spanName,
  toPortableSpan,
  ALLOWED_ATTRIBUTE_KEYS,
  REDACTION_VERSION,
  type AgentTraceLike,
} from "@/lib/observability/otel-genai-map";

const base: AgentTraceLike = {
  traceId: "trc_1",
  source: "chat",
  provider: "anthropic",
  model: "claude-opus-5",
  label: "main turn",
  durationMs: 1200,
  inputChars: 900,
  outputChars: 400,
  costCents: 3,
  toolCalls: 2,
};

describe("classifySpan", () => {
  it("maps known sources to both vocabularies", () => {
    expect(classifySpan("chat")).toEqual({ kind: "LLM", operation: "chat" });
    expect(classifySpan("tool")).toEqual({ kind: "TOOL", operation: "execute_tool" });
    expect(classifySpan("recall")).toEqual({ kind: "RETRIEVER", operation: "retrieve" });
    expect(classifySpan("critic")).toEqual({ kind: "EVALUATOR", operation: "evaluate" });
    expect(classifySpan("guardian")).toEqual({ kind: "GUARDRAIL", operation: "guardrail" });
  });

  it("an unknown source becomes CHAIN — never guessed as LLM", () => {
    // Mislabeling a non-inference span as inference would corrupt every
    // latency/cost aggregation built on the export.
    expect(classifySpan("some-future-engine")).toEqual({ kind: "CHAIN", operation: "chain" });
  });

  it("prefix-matches source variants (tool-exec, chat-stream)", () => {
    expect(classifySpan("tool-exec").kind).toBe("TOOL");
    expect(classifySpan("chat-stream").kind).toBe("LLM");
  });
});

describe("spanName follows the GenAI convention", () => {
  it("inference spans are '{operation} {request.model}'", () => {
    expect(spanName(base)).toBe("chat claude-opus-5");
  });
  it("tool spans are 'execute_tool {tool.name}'", () => {
    expect(spanName({ ...base, source: "tool", label: "createTask" })).toBe(
      "execute_tool createTask",
    );
  });
  it("model-less spans fall back to the operation alone", () => {
    expect(spanName({ ...base, model: null })).toBe("chat");
  });
});

describe("toPortableSpan", () => {
  it("emits the CURRENT provider key (gen_ai.provider.name, not the superseded gen_ai.system)", () => {
    const span = toPortableSpan(base);
    expect(span.attributes["gen_ai.provider.name"]).toBe("anthropic");
    expect(span.attributes).not.toHaveProperty("gen_ai.system");
  });

  it("emits both vocabularies side by side", () => {
    const span = toPortableSpan(base);
    expect(span.attributes["gen_ai.request.model"]).toBe("claude-opus-5");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.attributes["llm.model_name"]).toBe("claude-opus-5");
  });

  it("does NOT report character counts as token counts", () => {
    // inputChars is characters; publishing it under gen_ai.usage.*_tokens
    // would quietly corrupt downstream cost math.
    const span = toPortableSpan(base);
    expect(span.attributes).not.toHaveProperty("gen_ai.usage.input_tokens");
    expect(span.attributes).not.toHaveProperty("llm.token_count.prompt");
    expect(span.attributes["statenour.input_chars"]).toBe(900);
  });

  it("PRIVACY: every emitted key is on the allowlist — no content field can slip in", () => {
    for (const t of [
      base,
      { ...base, source: "tool", label: "sendSMS" },
      { ...base, errorClass: "rate_limit", model: null, provider: null },
    ]) {
      for (const key of Object.keys(toPortableSpan(t).attributes)) {
        expect(ALLOWED_ATTRIBUTE_KEYS, `unexpected attribute ${key}`).toContain(key);
      }
    }
  });

  it("PRIVACY: the allowlist itself contains no prompt/completion/content keys", () => {
    for (const key of ALLOWED_ATTRIBUTE_KEYS) {
      expect(key).not.toMatch(/input\.value|output\.value|\.prompt$|message|content|arguments/);
    }
  });

  it("records that inputs/outputs were never captured, with a policy version", () => {
    const span = toPortableSpan(base);
    expect(span.recordedInputs).toBe(false);
    expect(span.recordedOutputs).toBe(false);
    expect(span.redactionVersion).toBe(REDACTION_VERSION);
  });

  it("carries trace/parent linkage so correlation survives the rename", () => {
    const span = toPortableSpan({ ...base, parentId: "trc_parent" });
    expect(span.traceId).toBe("trc_1");
    expect(span.parentId).toBe("trc_parent");
  });

  it("maps errorClass onto the standard error.type", () => {
    expect(toPortableSpan({ ...base, errorClass: "timeout" }).attributes["error.type"]).toBe(
      "timeout",
    );
  });
});

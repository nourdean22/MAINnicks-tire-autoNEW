/**
 * Explainability envelope tests · v10.0.149
 *
 * Pure helpers — no DB. Verifies:
 *   · buildEnvelope defaults
 *   · extractEnvelope round-trip + version guard + malformed handling
 *   · EnvelopeBuilder accumulation semantics
 *   · makeMemoryPreview truncation
 */

import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  extractEnvelope,
  EnvelopeBuilder,
  makeMemoryPreview,
  ENVELOPE_VERSION,
} from "@/lib/automation/envelope";

describe("buildEnvelope", () => {
  it("returns a fully-populated envelope with safe defaults", () => {
    const e = buildEnvelope();
    expect(e.version).toBe(ENVELOPE_VERSION);
    expect(e.policyId).toBeNull();
    expect(e.memoriesUsed).toEqual([]);
    expect(e.factsAssumed).toEqual([]);
    expect(e.toolsCalled).toEqual([]);
    expect(e.reason).toBeNull();
  });

  it("preserves the partial fields supplied by the caller", () => {
    const e = buildEnvelope({ policyId: "cron.x", reason: "because" });
    expect(e.policyId).toBe("cron.x");
    expect(e.reason).toBe("because");
  });
});

describe("extractEnvelope", () => {
  it("returns null for non-object metadata", () => {
    expect(extractEnvelope(null)).toBeNull();
    expect(extractEnvelope(undefined)).toBeNull();
    expect(extractEnvelope("string")).toBeNull();
    expect(extractEnvelope(42)).toBeNull();
  });

  it("returns null when envelope key is missing", () => {
    expect(extractEnvelope({ other: "field" })).toBeNull();
  });

  it("returns null on version mismatch (forwards-incompatible row)", () => {
    expect(
      extractEnvelope({ envelope: { version: 999, policyId: "x" } }),
    ).toBeNull();
  });

  it("round-trips a fully-populated envelope through metadata shape", () => {
    const original = buildEnvelope({
      policyId: "tool.send-email",
      memoriesUsed: [
        { id: "m1", category: "wisdom", confidence: 0.8, preview: "p" },
      ],
      factsAssumed: ["it's tuesday"],
      toolsCalled: [{ name: "send-email", ok: true, durationMs: 120 }],
      reason: "operator approved",
    });
    const extracted = extractEnvelope({ envelope: original });
    expect(extracted).toEqual(original);
  });

  it("coerces missing array fields back to empty arrays", () => {
    const partial = { envelope: { version: ENVELOPE_VERSION, policyId: "x" } };
    const extracted = extractEnvelope(partial);
    expect(extracted?.memoriesUsed).toEqual([]);
    expect(extracted?.factsAssumed).toEqual([]);
    expect(extracted?.toolsCalled).toEqual([]);
  });
});

describe("EnvelopeBuilder", () => {
  it("starts with safe empty state", () => {
    const e = new EnvelopeBuilder().build();
    expect(e.policyId).toBeNull();
    expect(e.memoriesUsed).toHaveLength(0);
  });

  it("accepts policyId via constructor or setter", () => {
    const a = new EnvelopeBuilder("cron.a").build();
    const b = new EnvelopeBuilder().setPolicyId("cron.b").build();
    expect(a.policyId).toBe("cron.a");
    expect(b.policyId).toBe("cron.b");
  });

  it("accumulates memories one at a time and in bulk", () => {
    const e = new EnvelopeBuilder()
      .addMemory({ id: "m1", category: "wisdom", confidence: null, preview: "x" })
      .addMemories([
        { id: "m2", category: "rule", confidence: 0.9, preview: "y" },
        { id: "m3", category: "belief", confidence: null, preview: "z" },
      ])
      .build();
    expect(e.memoriesUsed.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("trims facts and skips empty ones", () => {
    const e = new EnvelopeBuilder()
      .addFact("  it's monday  ")
      .addFact("")
      .addFact("   ")
      .addFact("nick is on call")
      .build();
    expect(e.factsAssumed).toEqual(["it's monday", "nick is on call"]);
  });

  it("records tool calls in order", () => {
    const e = new EnvelopeBuilder()
      .recordToolCall("a", true, 100)
      .recordToolCall("b", false, 50)
      .build();
    expect(e.toolsCalled.map((t) => `${t.name}:${t.ok}`)).toEqual([
      "a:true",
      "b:false",
    ]);
  });

  it("clamps reason to 240 chars", () => {
    const long = "x".repeat(500);
    const e = new EnvelopeBuilder().setReason(long).build();
    expect(e.reason?.length).toBe(240);
  });

  it("setReason(null) clears the field", () => {
    const e = new EnvelopeBuilder().setReason("set").setReason(null).build();
    expect(e.reason).toBeNull();
  });

  it("build() returns a snapshot — later mutations don't leak in", () => {
    const eb = new EnvelopeBuilder();
    eb.addFact("first");
    const snap = eb.build();
    eb.addFact("second");
    expect(snap.factsAssumed).toEqual(["first"]);
  });
});

describe("makeMemoryPreview", () => {
  it("returns short content unchanged", () => {
    expect(makeMemoryPreview("short")).toBe("short");
  });
  it("truncates to 80 chars and appends ellipsis on long content", () => {
    const long = "abcdefghij".repeat(20); // 200 chars
    const r = makeMemoryPreview(long);
    expect(r.length).toBeLessThanOrEqual(81); // 80 + ellipsis
    expect(r.endsWith("…")).toBe(true);
  });
  it("trims trailing whitespace before the ellipsis", () => {
    const long = "x".repeat(78) + "    " + "rest".repeat(50);
    const r = makeMemoryPreview(long);
    expect(r).not.toMatch(/ +…$/);
  });
});

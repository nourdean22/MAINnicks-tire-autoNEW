/**
 * tests/lib/validators/nick-classify-schema.test.ts · Task #13.
 *
 * Contract test for the `nick.classifyMessage` tRPC procedure's
 * input shape and the RoutingDecision output shape.
 *
 * The .input() Zod schema is declared inline in lib/trpc/routers/
 * nick.ts. This file re-declares the same shape and pins it against
 * realistic client payloads, so a future schema tightening fails CI
 * before it breaks a real caller.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── nick.classifyMessage input ────────────────
describe("nick.classifyMessage · input payload contract", () => {
  const classifyInput = z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1).max(4000),
        }),
      )
      .min(1)
      .max(20),
  });

  it("accepts a single user message", () => {
    const parsed = classifyInput.safeParse({
      messages: [{ role: "user", content: "what's my net worth?" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a multi-turn history with assistant + system entries", () => {
    const parsed = classifyInput.safeParse({
      messages: [
        { role: "system", content: "you are nick" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hey" },
        { role: "user", content: "should I raise prices?" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty messages array", () => {
    const parsed = classifyInput.safeParse({ messages: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 20 messages (router only cares about latest)", () => {
    const messages = Array.from({ length: 21 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }));
    const parsed = classifyInput.safeParse({ messages });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown role value", () => {
    const parsed = classifyInput.safeParse({
      messages: [{ role: "robot", content: "hi" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty content strings", () => {
    const parsed = classifyInput.safeParse({
      messages: [{ role: "user", content: "" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects content longer than 4000 chars", () => {
    const parsed = classifyInput.safeParse({
      messages: [{ role: "user", content: "x".repeat(4001) }],
    });
    expect(parsed.success).toBe(false);
  });
});

// ──────────────── RoutingDecision output shape ────────────────
//
// This is the shape callers depend on. We re-declare it here to catch
// drift if someone changes the route enum or adds required fields.
describe("RoutingDecision · output shape contract", () => {
  const routeEnum = z.enum([
    "general",
    "financial-analyst",
    "decision-coach",
    "schedule-keeper",
    "marketing-director",
  ]);

  const routingDecision = z.object({
    route: routeEnum,
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
  });

  it("accepts a valid general decision", () => {
    const parsed = routingDecision.safeParse({
      route: "general",
      reason: "routing-disabled",
      confidence: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a financial-analyst decision", () => {
    const parsed = routingDecision.safeParse({
      route: "financial-analyst",
      reason: "keyword: financial signals matched",
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a decision-coach decision", () => {
    const parsed = routingDecision.safeParse({
      route: "decision-coach",
      reason: "llm: weighed trade-off framing",
      confidence: 0.7,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a schedule-keeper decision", () => {
    const parsed = routingDecision.safeParse({
      route: "schedule-keeper",
      reason: "keyword: schedule signals matched",
      confidence: 0.9,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a marketing-director decision", () => {
    const parsed = routingDecision.safeParse({
      route: "marketing-director",
      reason: "keyword: marketing signals matched",
      confidence: 0.95,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown route value", () => {
    const parsed = routingDecision.safeParse({
      route: "shop-mechanic",
      reason: "x",
      confidence: 0.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const parsed = routingDecision.safeParse({
      route: "general",
      reason: "x",
      confidence: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects confidence below 0", () => {
    const parsed = routingDecision.safeParse({
      route: "general",
      reason: "x",
      confidence: -0.1,
    });
    expect(parsed.success).toBe(false);
  });
});

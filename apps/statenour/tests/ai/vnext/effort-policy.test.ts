/**
 * Capability/effort router tests (lib/ai/vnext/effort-policy.ts — SHADOW).
 *
 * Pins the routing invariants the VNext plan commits to:
 *   · deterministic work never reaches an LLM;
 *   · trivial transforms stay on the cheap fast lane;
 *   · untrusted input ALWAYS gets fable (classifier ON) — even when
 *     Mythos access is attested;
 *   · Mythos is opt-in via operator attestation, never assumed;
 *   · frontier max-effort is justify-gated, never a default;
 *   · effort is pinned per conversation (prompt-cache stability).
 */

import { afterEach, describe, it, expect } from "vitest";
import { routeCapability, CLAUDE5_MODELS } from "@/lib/ai/vnext/effort-policy";

afterEach(() => {
  delete process.env.ANTHROPIC_MYTHOS_ENABLED;
});

describe("routeCapability — lanes", () => {
  it("deterministic → no LLM at all", () => {
    const d = routeCapability({ band: "deterministic", mythosEnabled: false });
    expect(d.lane).toBe("none");
    expect(d.model).toBeUndefined();
  });

  it("trivial → fast lane, no frontier model", () => {
    const d = routeCapability({ band: "trivial", mythosEnabled: false });
    expect(d.lane).toBe("fast");
    expect(d.model).toBeUndefined();
  });
});

describe("routeCapability — trust boundary", () => {
  it("untrusted input routes to fable (classifier ON) even with Mythos attested", () => {
    const d = routeCapability({ band: "strategic", untrustedInput: true, mythosEnabled: true });
    expect(d.model).toBe(CLAUDE5_MODELS.fable);
    expect(d.effort).toBe("medium");
  });
});

describe("routeCapability — Mythos gating", () => {
  it("normal band uses fable when Mythos is not attested", () => {
    const d = routeCapability({ band: "normal", mythosEnabled: false });
    expect(d.model).toBe(CLAUDE5_MODELS.fable);
    expect(d.effort).toBe("medium");
  });

  it("normal band uses mythos when the operator attests access", () => {
    const d = routeCapability({ band: "normal", mythosEnabled: true });
    expect(d.model).toBe(CLAUDE5_MODELS.mythos);
  });

  it("defaults to the ANTHROPIC_MYTHOS_ENABLED env attestation", () => {
    process.env.ANTHROPIC_MYTHOS_ENABLED = "1";
    expect(routeCapability({ band: "normal" }).model).toBe(CLAUDE5_MODELS.mythos);
    delete process.env.ANTHROPIC_MYTHOS_ENABLED;
    expect(routeCapability({ band: "normal" }).model).toBe(CLAUDE5_MODELS.fable);
  });
});

describe("routeCapability — bands", () => {
  it("strategic → primary at high effort", () => {
    const d = routeCapability({ band: "strategic", mythosEnabled: false });
    expect(d.model).toBe(CLAUDE5_MODELS.fable);
    expect(d.effort).toBe("high");
  });

  it("hard → opus-5 strong-cheap default (bake-off pending)", () => {
    const d = routeCapability({ band: "hard", mythosEnabled: true });
    expect(d.model).toBe(CLAUDE5_MODELS.opus);
    expect(d.effort).toBe("high");
  });

  it("frontier → fable max, justify-gated", () => {
    const d = routeCapability({ band: "frontier", mythosEnabled: false });
    expect(d.model).toBe(CLAUDE5_MODELS.fable);
    expect(d.effort).toBe("max");
    expect(d.justify).toBe(true);
  });
});

describe("routeCapability — conversation effort pin (prompt-cache stability)", () => {
  it("pins effort to the conversation's committed value", () => {
    const d = routeCapability({ band: "strategic", conversationEffort: "medium", mythosEnabled: false });
    expect(d.effort).toBe("medium");
    expect(d.rationale).toContain("pinned");
  });

  it("does not pin frontier runs (they belong in their own child run)", () => {
    const d = routeCapability({ band: "frontier", conversationEffort: "medium", mythosEnabled: false });
    expect(d.effort).toBe("max");
  });

  it("does not pin the fast lane (no effort there at all)", () => {
    const d = routeCapability({ band: "trivial", conversationEffort: "high", mythosEnabled: false });
    expect(d.effort).toBeUndefined();
  });
});

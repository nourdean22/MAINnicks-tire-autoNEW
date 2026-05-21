/**
 * behavior-directive · the per-turn intensity gate for Nick's chat prompt.
 *
 * getBehaviorDirective decides whether Nick's response carries the
 * ANTICIPATE→ANSWER→ELEVATE directive, the HIGH sparring-partner addendum,
 * or nothing at all. isStrictMode + resolveIntensity feed that decision.
 * These tests pin the gate: the strict-mode triggers, the intensity
 * env/override resolution, and that strict mode overrides intensity.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  isStrictMode,
  getBehaviorDirective,
  resolveIntensity,
  setIntensityOverride,
} from "@/lib/ai/knowledge/behavior-directive";

describe("isStrictMode", () => {
  it("returns false for a null message", () => {
    expect(isStrictMode(null)).toBe(false);
  });

  it("returns false for an ordinary message", () => {
    expect(isStrictMode("what's my revenue this week?")).toBe(false);
  });

  it("returns true for every strict trigger phrase", () => {
    const triggers = [
      "/strict show me the number",
      "just answer the question",
      "stay focused on the task",
      "execute only — no commentary",
      "no extra please",
    ];
    for (const msg of triggers) {
      expect(isStrictMode(msg)).toBe(true);
    }
  });

  it("matches triggers case-insensitively", () => {
    expect(isStrictMode("JUST ANSWER")).toBe(true);
  });
});

describe("getBehaviorDirective", () => {
  it("returns an empty directive for a strict message, overriding intensity", () => {
    expect(getBehaviorDirective("/strict just the facts", "HIGH")).toBe("");
  });

  it("returns an empty directive at MINIMAL intensity", () => {
    expect(getBehaviorDirective("normal question", "MINIMAL")).toBe("");
  });

  it("returns the ANTICIPATE/ELEVATE directive at STANDARD intensity", () => {
    const directive = getBehaviorDirective("normal question", "STANDARD");
    expect(directive.length).toBeGreaterThan(0);
    expect(directive).toContain("ANTICIPATE");
  });

  it("HIGH intensity embeds the STANDARD directive and adds to it", () => {
    const standard = getBehaviorDirective("normal question", "STANDARD");
    const high = getBehaviorDirective("normal question", "HIGH");
    expect(high).toContain(standard);
    expect(high.length).toBeGreaterThan(standard.length);
  });
});

describe("resolveIntensity", () => {
  const ORIGINAL = process.env.NICK_CHAT_INTENSITY;

  afterEach(() => {
    setIntensityOverride(null);
    if (ORIGINAL === undefined) delete process.env.NICK_CHAT_INTENSITY;
    else process.env.NICK_CHAT_INTENSITY = ORIGINAL;
  });

  it("defaults to STANDARD when nothing is set", () => {
    delete process.env.NICK_CHAT_INTENSITY;
    setIntensityOverride(null);
    expect(resolveIntensity()).toBe("STANDARD");
  });

  it("resolves HIGH / 1 / ON to HIGH", () => {
    for (const v of ["HIGH", "1", "ON"]) {
      process.env.NICK_CHAT_INTENSITY = v;
      expect(resolveIntensity()).toBe("HIGH");
    }
  });

  it("resolves MINIMAL / 0 / OFF to MINIMAL", () => {
    for (const v of ["MINIMAL", "0", "OFF"]) {
      process.env.NICK_CHAT_INTENSITY = v;
      expect(resolveIntensity()).toBe("MINIMAL");
    }
  });

  it("falls back to STANDARD for an unrecognized value", () => {
    process.env.NICK_CHAT_INTENSITY = "banana";
    expect(resolveIntensity()).toBe("STANDARD");
  });

  it("setIntensityOverride takes precedence over the env var", () => {
    process.env.NICK_CHAT_INTENSITY = "MINIMAL";
    setIntensityOverride("HIGH");
    expect(resolveIntensity()).toBe("HIGH");
  });
});

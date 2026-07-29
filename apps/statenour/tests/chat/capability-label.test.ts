/**
 * tests/chat/capability-label.test.ts — what the chat header may CLAIM
 * (2026-07-29).
 *
 * Reported: the badge read "FALLBACK ACTIVE" on a healthy app. The tone
 * defaulted to amber whenever provider health had not loaded, and
 * amber's label is "fallback active" — so an unmeasured state was
 * rendered as a specific provider failure.
 *
 * The rule these pin: unknown stays CAUTIOUS in appearance but never
 * asserts a diagnosis in words.
 */

import { describe, it, expect } from "vitest";
import { capabilityBadge } from "@/features/chat-v2/lib/capability-label";

const healthyTools = { totalTools: 174, degraded: 0, down: 0 };

describe("capabilityBadge — loading never fabricates a diagnosis", () => {
  it("THE REPORTED BUG: loading no longer says 'fallback active'", () => {
    const b = capabilityBadge({
      connection: "online",
      providerTone: undefined,
      providerErrored: false,
    });
    expect(b.label).not.toBe("fallback active");
    expect(b.label).toMatch(/checking/i);
  });

  it("loading is still cautious — it never claims health it has not measured", () => {
    const b = capabilityBadge({ connection: "online", providerTone: undefined, providerErrored: false });
    expect(b.cautious).toBe(true);
    expect(b.unknown).toBe(true);
  });

  it("a failed health query says UNKNOWN, not 'AI offline'", () => {
    // An unreachable health endpoint says nothing about the AI itself.
    const b = capabilityBadge({ connection: "online", providerTone: undefined, providerErrored: true });
    expect(b.label).toMatch(/unknown/i);
    expect(b.label).not.toBe("AI offline");
    expect(b.cautious).toBe(true);
  });
});

describe("capabilityBadge — real states still report accurately", () => {
  it("amber still means fallback active (the real signal is preserved)", () => {
    expect(
      capabilityBadge({ connection: "online", providerTone: "amber", providerErrored: false }).label,
    ).toBe("fallback active");
  });

  it("red means AI offline", () => {
    expect(
      capabilityBadge({ connection: "online", providerTone: "red", providerErrored: false }).label,
    ).toBe("AI offline");
  });

  it("offline connection outranks provider state — the client knows that firsthand", () => {
    const b = capabilityBadge({ connection: "offline", providerTone: "green", providerErrored: false });
    expect(b.label).toBe("chat offline");
    expect(b.unknown).toBe(false);
  });

  it("fully healthy reports the tool count and is NOT cautious", () => {
    const b = capabilityBadge({
      connection: "online",
      providerTone: "green",
      providerErrored: false,
      toolSummary: healthyTools,
    });
    expect(b.label).toBe("174 tools ready");
    expect(b.cautious).toBe(false);
    expect(b.unknown).toBe(false);
  });

  it("green providers with degraded tools stay cautious", () => {
    const b = capabilityBadge({
      connection: "online",
      providerTone: "green",
      providerErrored: false,
      toolSummary: { totalTools: 174, degraded: 3, down: 1 },
    });
    expect(b.cautious).toBe(true);
  });

  it("green providers with tools still loading are cautious and unknown — never green-by-default", () => {
    const b = capabilityBadge({ connection: "online", providerTone: "green", providerErrored: false });
    expect(b.cautious).toBe(true);
    expect(b.unknown).toBe(true);
  });
});

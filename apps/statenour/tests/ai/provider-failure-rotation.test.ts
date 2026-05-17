/**
 * v9.1.27 · Regression tests for the recently-failed provider tracker.
 *
 * The chat route uses streamText() directly with a single model from
 * getModel(). When a mid-stream error fires (Venice 5xx, transient
 * drop), the onError handler calls markProviderFailed(name) so the
 * NEXT request's getModel() automatically rotates to a different
 * provider. Auto-rehabs after ~60s.
 *
 * These tests pin the rotation logic so it can't silently regress.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  markProviderFailed,
  getRecentlyFailedProviders,
} from "@/lib/ai/provider";

afterEach(() => {
  vi.useRealTimers();
});

describe("v9.1.27 · markProviderFailed + getRecentlyFailedProviders", () => {
  it("marks a provider as recently failed", () => {
    markProviderFailed("venice");
    const failed = getRecentlyFailedProviders();
    expect(failed.find((f) => f.name === "venice")).toBeDefined();
  });

  it("expires markers after the TTL window (~60s)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
    markProviderFailed("ollama");
    expect(getRecentlyFailedProviders().find((f) => f.name === "ollama"))
      .toBeDefined();

    // Advance past the 60s window.
    vi.setSystemTime(new Date("2026-04-30T00:01:30Z"));
    expect(getRecentlyFailedProviders().find((f) => f.name === "ollama"))
      .toBeUndefined();
  });

  it("supports multiple providers marked simultaneously", () => {
    markProviderFailed("venice");
    markProviderFailed("openai");
    const failed = getRecentlyFailedProviders();
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed.find((f) => f.name === "venice")).toBeDefined();
    expect(failed.find((f) => f.name === "openai")).toBeDefined();
  });

  it("re-marking refreshes the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
    markProviderFailed("anthropic");
    const first = getRecentlyFailedProviders().find(
      (f) => f.name === "anthropic",
    )!;
    const firstExpires = first.expiresAt;

    // Move time forward 30s and re-mark.
    vi.setSystemTime(new Date("2026-04-30T00:00:30Z"));
    markProviderFailed("anthropic");
    const second = getRecentlyFailedProviders().find(
      (f) => f.name === "anthropic",
    )!;
    expect(second.expiresAt).toBeGreaterThan(firstExpires);
  });
});

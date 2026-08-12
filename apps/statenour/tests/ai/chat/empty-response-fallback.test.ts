/**
 * Empty-response fallback tests.
 *
 * When the model stream closes with no usable text after every salvage
 * path (persist-assistant-turn.ts), the turn used to be silently dropped
 * (hasContent=false → save skipped) → the user saw a blank bubble and
 * retried. When the empty turn had actually fired a tool, the retry
 * created DUPLICATES — the 06-08 "UFC USA BBQ" mission spawned 5×.
 *
 * This pins the honest fallback that replaces the silent drop.
 */

import { describe, it, expect } from "vitest";
import { emptyResponseFallback } from "@/lib/ai/chat/empty-response-fallback";

// A past-tense completion claim would be a fabrication (the model produced
// NOTHING) and would also trip the action-claim fabrication detector.
const FABRICATION = /\b(added|created|sent|scheduled|marked|saved|posted|done|completed|logged)\b/i;

describe("emptyResponseFallback", () => {
  it("returns a non-empty, non-whitespace message for a tool-call turn", () => {
    const msg = emptyResponseFallback("tool-calls");
    expect(msg.trim().length).toBeGreaterThan(0);
  });

  it("returns a non-empty, non-whitespace message for a stop turn", () => {
    const msg = emptyResponseFallback("stop");
    expect(msg.trim().length).toBeGreaterThan(0);
  });

  it("steers a tool-call turn AWAY from a blind retry (duplicate guard)", () => {
    // A tool may already have fired — re-sending duplicates it (the BBQ bug).
    const msg = emptyResponseFallback("tool-calls");
    expect(msg.toLowerCase()).toContain("duplicate");
  });

  it("invites a retry on a truly-empty (no-tool) turn", () => {
    const msg = emptyResponseFallback("stop");
    expect(msg.toLowerCase()).toMatch(/retry|smaller|break it/);
  });

  it("never claims a completed side effect (honesty / no fabrication)", () => {
    expect(emptyResponseFallback("tool-calls")).not.toMatch(FABRICATION);
    expect(emptyResponseFallback("stop")).not.toMatch(FABRICATION);
    expect(emptyResponseFallback(undefined)).not.toMatch(FABRICATION);
  });

  it("defaults to the retry message when finishReason is missing", () => {
    expect(emptyResponseFallback(undefined)).toBe(emptyResponseFallback("stop"));
  });

  it("the two branches produce distinct messages", () => {
    expect(emptyResponseFallback("tool-calls")).not.toBe(emptyResponseFallback("stop"));
  });

  // 2026-08-11 · refusal branch. Claude 5-family models end a turn with
  // stop_reason "refusal" (HTTP 200) — AI SDK finishReason "content-filter".
  it("names a refusal instead of pretending the request was too heavy", () => {
    const msg = emptyResponseFallback("content-filter");
    expect(msg.toLowerCase()).toContain("refus");
    expect(msg).not.toBe(emptyResponseFallback("stop"));
    expect(msg).not.toBe(emptyResponseFallback("tool-calls"));
  });

  it("the refusal message is honest — no fabricated side effect, no fake outage", () => {
    const msg = emptyResponseFallback("content-filter");
    expect(msg).not.toMatch(FABRICATION);
    expect(msg.toLowerCase()).not.toContain("unavailable");
  });
});

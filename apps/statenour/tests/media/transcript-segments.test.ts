/**
 * BDN-318 · transcript segment normalization.
 *
 * The shape is NOT guessed. videodb-python's `Video._fetch_transcript`
 * reads `word_timestamps` and `text` off this endpoint, and
 * `get_transcript` documents the element shape as "List of dicts with
 * keys: start (float), end (float), text (str)". These tests encode that
 * contract so a future response-shape change fails here rather than
 * silently returning zero segments.
 *
 * The load-bearing property is that a malformed row is DROPPED rather
 * than emitted with NaN timings — a segment that seeks the player to
 * nowhere is worse than a missing one.
 */

import { describe, expect, it } from "vitest";
import { normalizeSegments } from "@/lib/videodb/client";

describe("transcript segments · the documented shape", () => {
  it("passes through well-formed segments", () => {
    expect(
      normalizeSegments([
        { start: 0, end: 2.5, text: "we call them back twice" },
        { start: 2.5, end: 4, text: "then we stop" },
      ]),
    ).toEqual([
      { start: 0, end: 2.5, text: "we call them back twice" },
      { start: 2.5, end: 4, text: "then we stop" },
    ]);
  });

  it("accepts float timings", () => {
    expect(normalizeSegments([{ start: 12.34, end: 15.67, text: "x" }])[0]).toEqual({
      start: 12.34,
      end: 15.67,
      text: "x",
    });
  });

  it("accepts a zero-start first segment", () => {
    expect(normalizeSegments([{ start: 0, end: 1, text: "hi" }])).toHaveLength(1);
  });
});

describe("transcript segments · malformed rows are DROPPED, not emitted", () => {
  it("drops rows with missing or non-numeric timings", () => {
    // A NaN timing would seek the player to nowhere.
    expect(
      normalizeSegments([
        { text: "no timings" },
        { start: 1, text: "no end" },
        { end: 2, text: "no start" },
        { start: "1" as unknown as number, end: 2, text: "string start" },
      ]),
    ).toEqual([]);
  });

  it("drops empty and whitespace-only text", () => {
    expect(
      normalizeSegments([
        { start: 0, end: 1, text: "" },
        { start: 1, end: 2, text: "   " },
      ]),
    ).toEqual([]);
  });

  it("drops negative starts and backwards ranges", () => {
    expect(
      normalizeSegments([
        { start: -1, end: 2, text: "negative" },
        { start: 5, end: 3, text: "backwards" },
      ]),
    ).toEqual([]);
  });

  it("keeps the good rows alongside the bad ones", () => {
    // Strictness must not become blindness — one malformed row should
    // not discard an otherwise usable transcript.
    const out = normalizeSegments([
      { start: 0, end: 1, text: "keep me" },
      { start: Number.NaN, end: 2, text: "drop me" },
      { start: 2, end: 3, text: "keep me too" },
    ]);
    expect(out.map((s) => s.text)).toEqual(["keep me", "keep me too"]);
  });
});

describe("transcript segments · absent payloads", () => {
  it("returns [] for undefined, null and non-arrays", () => {
    expect(normalizeSegments(undefined)).toEqual([]);
    expect(normalizeSegments(null as never)).toEqual([]);
    expect(normalizeSegments({} as never)).toEqual([]);
  });

  it("returns [] for an empty array", () => {
    expect(normalizeSegments([])).toEqual([]);
  });
});

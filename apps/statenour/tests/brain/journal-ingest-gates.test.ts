/**
 * v10.0.232 · pin the entryType gate allowlists used by the journal
 * ingest pipeline. These determine which AI-extracted signals get
 * persisted vs dropped. Pre-v10.0.232 these were absent · every
 * AI-returned actionItem / commitment / insight / win / concern got
 * stored regardless of whether the entry classified as a question
 * vs a real brain dump.
 *
 * If these regress, every chat question over 200 chars starts
 * spawning phantom tasks + commitments + insights again.
 */
import { describe, it, expect } from "vitest";
import {
  TASK_CREATING_TYPES,
  COMMITMENT_CREATING_TYPES,
  INSIGHT_CREATING_TYPES,
  WIN_CREATING_TYPES,
  CONCERN_CREATING_TYPES,
  VALID_MOODS,
  simpleHash,
} from "@/lib/brain/journal-ingest";

describe("entryType allowlists · core invariants", () => {
  it("tasks · only planning + decision", () => {
    expect(TASK_CREATING_TYPES).toContain("planning");
    expect(TASK_CREATING_TYPES).toContain("decision");
    expect(TASK_CREATING_TYPES).not.toContain("raw");
    expect(TASK_CREATING_TYPES).not.toContain("thinking");
    expect(TASK_CREATING_TYPES).not.toContain("reasoning");
    expect(TASK_CREATING_TYPES).not.toContain("insight");
    expect(TASK_CREATING_TYPES).not.toContain("venting");
    expect(TASK_CREATING_TYPES).not.toContain("reflection");
  });

  it("commitments · same gate as tasks", () => {
    expect(COMMITMENT_CREATING_TYPES).toContain("decision");
    expect(COMMITMENT_CREATING_TYPES).toContain("planning");
    expect(COMMITMENT_CREATING_TYPES).not.toContain("raw");
    expect(COMMITMENT_CREATING_TYPES).not.toContain("venting");
    expect(COMMITMENT_CREATING_TYPES).not.toContain("thinking");
  });

  it("insights · skip raw / venting", () => {
    expect(INSIGHT_CREATING_TYPES).toContain("insight");
    expect(INSIGHT_CREATING_TYPES).toContain("reflection");
    expect(INSIGHT_CREATING_TYPES).not.toContain("raw");
    expect(INSIGHT_CREATING_TYPES).not.toContain("venting");
  });

  it("wins · skip raw / venting / thinking", () => {
    expect(WIN_CREATING_TYPES).toContain("reflection");
    expect(WIN_CREATING_TYPES).toContain("decision");
    expect(WIN_CREATING_TYPES).not.toContain("raw");
    expect(WIN_CREATING_TYPES).not.toContain("venting");
    expect(WIN_CREATING_TYPES).not.toContain("thinking");
  });

  it("concerns · allow venting (real signal) but skip raw", () => {
    expect(CONCERN_CREATING_TYPES).toContain("venting");
    expect(CONCERN_CREATING_TYPES).toContain("thinking");
    expect(CONCERN_CREATING_TYPES).toContain("reasoning");
    expect(CONCERN_CREATING_TYPES).not.toContain("raw");
  });
});

describe("VALID_MOODS allowlist", () => {
  it("includes the standard vocabulary the AI is trained to return", () => {
    expect(VALID_MOODS.has("calm")).toBe(true);
    expect(VALID_MOODS.has("stressed")).toBe(true);
    expect(VALID_MOODS.has("motivated")).toBe(true);
    expect(VALID_MOODS.has("frustrated")).toBe(true);
    expect(VALID_MOODS.has("scattered")).toBe(true);
    expect(VALID_MOODS.has("focused")).toBe(true);
    expect(VALID_MOODS.has("tired")).toBe(true);
    expect(VALID_MOODS.has("energized")).toBe(true);
    expect(VALID_MOODS.has("anxious")).toBe(true);
    expect(VALID_MOODS.has("reflective")).toBe(true);
  });

  it("rejects free-form / hyphenated / hallucinated AI moods", () => {
    expect(VALID_MOODS.has("contemplative-with-frustration")).toBe(false);
    expect(VALID_MOODS.has("ambivalent")).toBe(false);
    expect(VALID_MOODS.has("zenful")).toBe(false);
    expect(VALID_MOODS.has("")).toBe(false);
  });
});

describe("simpleHash · dedupe key generator", () => {
  it("returns a stable hash for the same input", () => {
    const a = simpleHash("commitment about Q3 launch");
    const b = simpleHash("commitment about Q3 launch");
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", () => {
    const a = simpleHash("commitment one");
    const b = simpleHash("commitment two");
    expect(a).not.toBe(b);
  });

  it("output is base36 (no special chars · safe for memory keys)", () => {
    const h = simpleHash("any string with weird chars: !@#$%^&* and unicode 日本");
    expect(h).toMatch(/^[a-z0-9]+$/);
  });

  it("handles empty string", () => {
    expect(simpleHash("")).toMatch(/^[a-z0-9]+$/);
  });
});

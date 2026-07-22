import { describe, expect, it } from "vitest";
import {
  normalizeContent,
  hashContent,
  isChange,
} from "@/lib/intelligence/change-detection";

describe("normalizeContent", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeContent("  a\n\n b\t c  ")).toBe("a b c");
  });
  it("returns empty for empty input", () => {
    expect(normalizeContent("")).toBe("");
  });
});

describe("hashContent", () => {
  it("is stable across trivial whitespace churn (no false-positive changes)", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello   world"));
    expect(hashContent("hello world")).toBe(hashContent(" hello world \n"));
  });
  it("differs when content materially differs", () => {
    expect(hashContent("hello world")).not.toBe(hashContent("hello mars"));
  });
  it("returns a 64-char sha256 hex digest", () => {
    expect(hashContent("x")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("isChange", () => {
  it("treats the first snapshot (no prior hash) as the baseline, never a change", () => {
    expect(isChange(null, "abc")).toBe(false);
    expect(isChange(undefined, "abc")).toBe(false);
  });
  it("is not a change when the hash is unchanged", () => {
    expect(isChange("abc", "abc")).toBe(false);
  });
  it("is a change when the hash differs from the prior snapshot", () => {
    expect(isChange("abc", "def")).toBe(true);
  });
});

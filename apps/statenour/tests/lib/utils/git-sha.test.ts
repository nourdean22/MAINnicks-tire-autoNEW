import { describe, it, expect } from "vitest";
import { extractShas } from "@/lib/utils/git-sha";

describe("extractShas", () => {
  it("extracts short (7-12 char) SHAs", () => {
    expect(extractShas("shipped 01c5438c and a24d58d1")).toEqual(["01c5438c", "a24d58d1"]);
  });

  it("extracts FULL 40-char SHAs (git log --format=%H form)", () => {
    const full = "a".repeat(40);
    expect(extractShas(`HEAD is ${full}`)).toEqual([full]);
  });

  it("drops hex-like noise in the 13-39 char range", () => {
    expect(extractShas(`token ${"b".repeat(20)} here`)).toEqual([]);
  });

  it("dedupes the short and full form of the same commit by first-7", () => {
    const full = "abcdef1234567890abcdef1234567890abcdef12";
    // short form shares the first 7 chars "abcdef1"
    expect(extractShas(`abcdef1 then ${full}`)).toEqual(["abcdef1"]);
  });

  it("is empty on prose with no SHAs", () => {
    expect(extractShas("just some words")).toEqual([]);
    expect(extractShas("")).toEqual([]);
  });
});

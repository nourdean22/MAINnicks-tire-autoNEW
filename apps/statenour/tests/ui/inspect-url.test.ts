/**
 * `?inspect=` codec · 2026-09-15.
 *
 * The inspector's URL contract: read from any query-string shape, write
 * without disturbing sibling params (`?tab=` on the same page), remove
 * cleanly, and keep the kind:id readable (only the id is percent-encoded).
 */
import { describe, expect, it } from "vitest";
import { INSPECT_PARAM, inspectHref, isInspecting, readInspect, withInspect } from "@/lib/ui/inspect-url";

describe("readInspect", () => {
  it("reads from a string with or without the leading '?', and from URLSearchParams", () => {
    expect(readInspect("?tab=memory&inspect=memory:abc")).toEqual({ kind: "memory", id: "abc" });
    expect(readInspect("tab=memory&inspect=memory:abc")).toEqual({ kind: "memory", id: "abc" });
    expect(readInspect(new URLSearchParams("inspect=task:t9"))).toEqual({ kind: "task", id: "t9" });
  });

  it("decodes a percent-encoded colon (URLSearchParams.toString() form)", () => {
    expect(readInspect("inspect=memory%3Aabc")).toEqual({ kind: "memory", id: "abc" });
  });

  it("is null when absent, empty or malformed — never a throw", () => {
    expect(readInspect("")).toBeNull();
    expect(readInspect(null)).toBeNull();
    expect(readInspect(undefined)).toBeNull();
    expect(readInspect("?tab=memory")).toBeNull();
    expect(readInspect("?inspect=")).toBeNull();
    expect(readInspect("?inspect=widget:1")).toBeNull();
  });
});

describe("withInspect", () => {
  it("preserves sibling params and appends the inspector", () => {
    expect(withInspect("?tab=memory", { kind: "memory", id: "abc" })).toBe("tab=memory&inspect=memory:abc");
  });

  it("replaces an existing inspector value", () => {
    expect(withInspect("?tab=memory&inspect=memory:old", { kind: "task", id: "new" })).toBe("tab=memory&inspect=task:new");
  });

  it("removes the param on null and leaves the rest untouched", () => {
    expect(withInspect("?tab=memory&inspect=memory:abc", null)).toBe("tab=memory");
    expect(withInspect("?inspect=memory:abc", null)).toBe("");
  });

  it("percent-encodes only the id, keeping kind and colon literal", () => {
    expect(withInspect("", { kind: "person", id: "a b&c" })).toBe(`${INSPECT_PARAM}=person:a%20b%26c`);
    expect(readInspect(withInspect("", { kind: "person", id: "a b&c" }))).toEqual({ kind: "person", id: "a b&c" });
  });
});

describe("inspectHref / isInspecting", () => {
  it("builds a full href and omits the '?' when nothing remains", () => {
    expect(inspectHref("/brain", "tab=memory", { kind: "memory", id: "m1" })).toBe("/brain?tab=memory&inspect=memory:m1");
    expect(inspectHref("/missions", "?inspect=task:t1", null)).toBe("/missions");
  });

  it("isInspecting matches kind and id exactly", () => {
    expect(isInspecting("?inspect=task:t1", { kind: "task", id: "t1" })).toBe(true);
    expect(isInspecting("?inspect=task:t1", { kind: "task", id: "t2" })).toBe(false);
    expect(isInspecting("", { kind: "task", id: "t1" })).toBe(false);
  });
});

/**
 * EntityRef · the closed object-identity registry · 2026-09-15.
 *
 * The contract the URL, the page-context bridge and the ledger all lean on:
 * `<kind>:<id>` parses only for registered kinds, the FIRST colon splits so
 * ids may carry colons, and anything else is null (never a throw, never a
 * guessed kind). A URL must not be able to smuggle a type into the UI.
 */
import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  ENTITY_KIND_LABEL,
  formatEntityRef,
  isEntityKind,
  parseEntityRef,
  sameEntity,
  toPageContextAnchor,
} from "@/lib/ui/entity-ref";

describe("parseEntityRef / formatEntityRef", () => {
  it("round-trips every registered kind", () => {
    for (const kind of ENTITY_KINDS) {
      const ref = { kind, id: "abc123" };
      expect(parseEntityRef(formatEntityRef(ref))).toEqual(ref);
      expect(ENTITY_KIND_LABEL[kind].length).toBeGreaterThan(0);
    }
  });

  it("splits at the FIRST colon so ids may contain colons", () => {
    expect(parseEntityRef("memory:a:b:c")).toEqual({ kind: "memory", id: "a:b:c" });
  });

  it("rejects unknown kinds — a URL cannot invent a type", () => {
    expect(parseEntityRef("widget:1")).toBeNull();
    expect(parseEntityRef("Memory:1")).toBeNull(); // case-sensitive: the registry is lowercase
    expect(isEntityKind("widget")).toBe(false);
    expect(isEntityKind("memory")).toBe(true);
  });

  it("rejects empty ids, missing colons and non-strings", () => {
    expect(parseEntityRef("memory:")).toBeNull();
    expect(parseEntityRef("memory:   ")).toBeNull();
    expect(parseEntityRef("memory")).toBeNull();
    expect(parseEntityRef(":abc")).toBeNull();
    expect(parseEntityRef("")).toBeNull();
    expect(parseEntityRef(null)).toBeNull();
    expect(parseEntityRef(undefined)).toBeNull();
    expect(parseEntityRef(42)).toBeNull();
  });

  it("caps the id at the ledger's 200 chars", () => {
    expect(parseEntityRef(`task:${"x".repeat(200)}`)).not.toBeNull();
    expect(parseEntityRef(`task:${"x".repeat(201)}`)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseEntityRef("  task:t1  ")).toEqual({ kind: "task", id: "t1" });
  });
});

describe("sameEntity", () => {
  it("compares kind AND id, and treats null as never equal", () => {
    expect(sameEntity({ kind: "task", id: "1" }, { kind: "task", id: "1" })).toBe(true);
    expect(sameEntity({ kind: "task", id: "1" }, { kind: "memory", id: "1" })).toBe(false);
    expect(sameEntity({ kind: "task", id: "1" }, { kind: "task", id: "2" })).toBe(false);
    expect(sameEntity(null, { kind: "task", id: "1" })).toBe(false);
    expect(sameEntity(null, null)).toBe(false);
  });
});

describe("toPageContextAnchor", () => {
  it("maps the kinds the chat bridge has fields for", () => {
    expect(toPageContextAnchor({ kind: "task", id: "t1" })).toEqual({ lastTaskId: "t1" });
    expect(toPageContextAnchor({ kind: "mission", id: "m1" })).toEqual({ lastMissionId: "m1" });
    expect(toPageContextAnchor({ kind: "journal", id: "j1" })).toEqual({ lastJournalEntryId: "j1" });
    expect(toPageContextAnchor({ kind: "decision", id: "d1" })).toEqual({ lastDecisionId: "d1" });
    expect(toPageContextAnchor({ kind: "pin", id: "p1" })).toEqual({ lastPinId: "p1" });
  });

  it("is empty for kinds the bridge cannot carry, rather than guessing a field", () => {
    expect(toPageContextAnchor({ kind: "memory", id: "x" })).toEqual({});
    expect(toPageContextAnchor({ kind: "person", id: "x" })).toEqual({});
  });
});

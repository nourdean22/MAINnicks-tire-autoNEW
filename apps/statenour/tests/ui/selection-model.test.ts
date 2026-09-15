/**
 * Selection model · pure reducer + key grammar · 2026-09-15.
 *
 * Pinned here: no wrap at the ends, Shift-extend replaces its own run but
 * keeps rows toggled individually, stale keys are ignored, and the key map
 * never claims modifier chords or keys typed into an input.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  escapeStep,
  isTypingTarget,
  keyToIntent,
  reconcileSelection,
  reduceSelection,
  type SelectionState,
} from "@/lib/ui/selection-model";

const ORDER = ["task:a", "task:b", "task:c", "task:d"];

describe("reduceSelection · focus movement", () => {
  it("Down from nothing lands on the first row; Up from nothing on the last", () => {
    expect(reduceSelection(EMPTY_SELECTION, { type: "move", delta: 1 }, ORDER).focus).toBe("task:a");
    expect(reduceSelection(EMPTY_SELECTION, { type: "move", delta: -1 }, ORDER).focus).toBe("task:d");
  });

  it("clamps at the ends — never wraps", () => {
    const atEnd: SelectionState = { focus: "task:d", selected: [], anchor: null };
    expect(reduceSelection(atEnd, { type: "move", delta: 1 }, ORDER).focus).toBe("task:d");
    const atStart: SelectionState = { focus: "task:a", selected: [], anchor: null };
    expect(reduceSelection(atStart, { type: "move", delta: -1 }, ORDER).focus).toBe("task:a");
  });

  it("home / end jump; an empty order is a no-op", () => {
    const s: SelectionState = { focus: "task:b", selected: [], anchor: null };
    expect(reduceSelection(s, { type: "home" }, ORDER).focus).toBe("task:a");
    expect(reduceSelection(s, { type: "end" }, ORDER).focus).toBe("task:d");
    expect(reduceSelection(s, { type: "move", delta: 1 }, [])).toBe(s);
  });

  it("ignores a focus event for a key that is not in the list", () => {
    const s: SelectionState = { focus: "task:b", selected: [], anchor: null };
    expect(reduceSelection(s, { type: "focus", key: "task:zzz" }, ORDER)).toBe(s);
  });
});

describe("reduceSelection · selection", () => {
  it("toggle adds then removes the focused row and sets the anchor", () => {
    const s0: SelectionState = { focus: "task:b", selected: [], anchor: null };
    const s1 = reduceSelection(s0, { type: "toggle" }, ORDER);
    expect(s1.selected).toEqual(["task:b"]);
    expect(s1.anchor).toBe("task:b");
    const s2 = reduceSelection(s1, { type: "toggle" }, ORDER);
    expect(s2.selected).toEqual([]);
  });

  it("extend selects the run from the anchor and keeps individually toggled rows", () => {
    const s0: SelectionState = { focus: "task:a", selected: ["task:d"], anchor: null };
    const s1 = reduceSelection(s0, { type: "extend", delta: 1 }, ORDER); // a..b
    expect(s1.focus).toBe("task:b");
    expect(s1.selected).toEqual(["task:d", "task:a", "task:b"]);
    const s2 = reduceSelection(s1, { type: "extend", delta: 1 }, ORDER); // a..c
    expect(s2.selected).toEqual(["task:d", "task:a", "task:b", "task:c"]);
    const s3 = reduceSelection(s2, { type: "extend", delta: -1 }, ORDER); // back to a..b — c leaves the run, d stays
    expect(s3.selected).toEqual(["task:d", "task:a", "task:b"]);
  });

  it("range selects between the anchor and the clicked key", () => {
    const s0: SelectionState = { focus: "task:a", selected: ["task:a"], anchor: "task:a" };
    const s1 = reduceSelection(s0, { type: "range", key: "task:c" }, ORDER);
    expect(s1.selected).toEqual(["task:a", "task:b", "task:c"]);
  });

  it("select-only, select-all, clear and reset", () => {
    const s = reduceSelection(EMPTY_SELECTION, { type: "select-only", key: "task:c" }, ORDER);
    expect(s).toEqual({ focus: "task:c", anchor: "task:c", selected: ["task:c"] });
    expect(reduceSelection(s, { type: "select-all" }, ORDER).selected).toEqual(ORDER);
    const cleared = reduceSelection(s, { type: "clear" }, ORDER);
    expect(cleared.selected).toEqual([]);
    expect(cleared.focus).toBe("task:c"); // clear keeps focus
    expect(reduceSelection(s, { type: "reset" }, ORDER)).toBe(EMPTY_SELECTION);
  });
});

describe("reconcileSelection", () => {
  it("drops keys whose rows left the list and returns the same object when nothing changed", () => {
    const s: SelectionState = { focus: "task:b", selected: ["task:a", "task:b"], anchor: "task:a" };
    expect(reconcileSelection(s, ORDER)).toBe(s);
    const next = reconcileSelection(s, ["task:b", "task:c"]);
    expect(next).toEqual({ focus: "task:b", selected: ["task:b"], anchor: null });
  });
});

describe("keyToIntent", () => {
  it("maps the grammar", () => {
    expect(keyToIntent({ key: "j" })).toEqual({ intent: "move", delta: 1 });
    expect(keyToIntent({ key: "ArrowDown" })).toEqual({ intent: "move", delta: 1 });
    expect(keyToIntent({ key: "k" })).toEqual({ intent: "move", delta: -1 });
    expect(keyToIntent({ key: "ArrowUp", shiftKey: true })).toEqual({ intent: "extend", delta: -1 });
    expect(keyToIntent({ key: "J", shiftKey: true })).toEqual({ intent: "extend", delta: 1 });
    expect(keyToIntent({ key: "x" })).toEqual({ intent: "toggle" });
    expect(keyToIntent({ key: " " })).toEqual({ intent: "peek" });
    expect(keyToIntent({ key: "Enter" })).toEqual({ intent: "open" });
    expect(keyToIntent({ key: "Escape" })).toEqual({ intent: "escape" });
    expect(keyToIntent({ key: "Home" })).toEqual({ intent: "home" });
    expect(keyToIntent({ key: "End" })).toEqual({ intent: "end" });
  });

  it("never claims modifier chords (⌘K, ⌘⇧K, the chat matrix) or unrelated keys", () => {
    expect(keyToIntent({ key: "k", metaKey: true })).toBeNull();
    expect(keyToIntent({ key: "j", ctrlKey: true })).toBeNull();
    expect(keyToIntent({ key: "x", altKey: true })).toBeNull();
    expect(keyToIntent({ key: "g" })).toBeNull();
    expect(keyToIntent({ key: "r" })).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is true for inputs, textareas, selects, contenteditable and ARIA text boxes (the positive cases)", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: (n) => (n === "role" ? "textbox" : null) })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: (n) => (n === "contenteditable" ? "true" : null) })).toBe(true);
  });

  it("is false for a plain row (the control — without it the grammar would never fire)", () => {
    expect(isTypingTarget({ tagName: "DIV", getAttribute: () => null })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("escapeStep", () => {
  it("unwinds one level per press: peek, then selection, then the inspector", () => {
    expect(escapeStep({ peek: true, hasSelection: true, inspecting: true })).toBe("close-peek");
    expect(escapeStep({ peek: false, hasSelection: true, inspecting: true })).toBe("clear-selection");
    expect(escapeStep({ peek: false, hasSelection: false, inspecting: true })).toBe("close-inspector");
    expect(escapeStep({ peek: false, hasSelection: false, inspecting: false })).toBe("none");
  });
});

/**
 * Same-name records must not overwrite each other (2026-10-02). Production had
 * 11 one-second windows holding 2-4 reflections; each export rewrote the shared
 * file, which woke the watch daemon, which exported again, forever.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNotePathClaimer } from "@/lib/obsidian/note-writer";

describe("createNotePathClaimer", () => {
  it("the first record keeps the plain name; a second record with the same name gets its own path", () => {
    const claim = createNotePathClaimer();
    const a = claim("/v/Reflections", "2026-09-18_13-24-49_reflection", "cmu78awv8006hrlm07agyfb8x");
    const b = claim("/v/Reflections", "2026-09-18_13-24-49_reflection", "cmu78awv9007irlm07zzzz1234");
    expect(a).toBe(path.join("/v/Reflections", "2026-09-18_13-24-49_reflection.md"));
    expect(b).toBe(path.join("/v/Reflections", "2026-09-18_13-24-49_reflection zz1234.md"));
    expect(new Set([a, b]).size).toBe(2);
  });

  it("the same record claims the same path again, and a fresh run reproduces the same mapping", () => {
    const run = () => {
      const claim = createNotePathClaimer();
      return [claim("/v/Goals", "Get fit", "g1"), claim("/v/Goals", "Get fit", "g2"), claim("/v/Goals", "Get fit", "g1")];
    };
    const first = run();
    expect(first[0]).toBe(first[2]);
    expect(run()).toEqual(first);
  });

  it("different directories never collide", () => {
    const claim = createNotePathClaimer();
    expect(claim("/v/Goals", "X", "a")).not.toBe(claim("/v/Missions", "X", "b"));
    expect(claim("/v/Missions", "X", "b")).toBe(path.join("/v/Missions", "X.md"));
  });
});

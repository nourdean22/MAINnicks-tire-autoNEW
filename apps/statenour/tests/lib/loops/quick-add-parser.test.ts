/**
 * quick-add-parser · done:/did: prefix · 2026-05-21.
 *
 * Covers the `done:` / `did:` prefix added so the operator can log a
 * task they finished earlier in one line. The critical guarantee is
 * the colon requirement: a bare "did I lock the door" must NOT parse
 * as a completed task — only an explicit "done:" / "did:" does.
 *
 * Also pins that stripping the prefix leaves the remainder fully
 * parseable for the other kinds (PROMISE, DAILY) and tokens.
 */

import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "@/lib/loops/quick-add-parser";

describe("parseQuickAdd · done:/did: prefix", () => {
  it("flags `done:` and strips the prefix from the title", () => {
    const r = parseQuickAdd("done: cleaned the garage");
    expect(r?.markDone).toBe(true);
    expect(r?.title).toBe("cleaned the garage");
    expect(r?.loopKind).toBe("ONCE");
  });

  it("flags `did:` the same way", () => {
    const r = parseQuickAdd("did: oil change on the truck");
    expect(r?.markDone).toBe(true);
    expect(r?.title).toBe("oil change on the truck");
  });

  it("accepts no space after the colon", () => {
    expect(parseQuickAdd("done:filed the taxes")?.markDone).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseQuickAdd("DONE: shipped the build")?.markDone).toBe(true);
  });

  // The whole reason the colon is mandatory — a genuine reminder that
  // happens to start with "did" must stay a normal open task.
  it("does NOT flag a colonless phrase starting with 'did'", () => {
    const r = parseQuickAdd("did I lock the front door");
    expect(r?.markDone).toBe(false);
    expect(r?.title).toBe("did I lock the front door");
  });

  it("does NOT flag a colonless phrase starting with 'do'", () => {
    expect(parseQuickAdd("do the laundry")?.markDone).toBe(false);
  });

  it("leaves a plain task unflagged", () => {
    expect(parseQuickAdd("call the vendor")?.markDone).toBe(false);
  });

  // Prefix stripped first → the remainder still resolves PROMISE +
  // promiseTo. "done: promise @dania …" logs a kept promise.
  it("still parses a PROMISE after the done: prefix", () => {
    const r = parseQuickAdd("done: @dania returned her call");
    expect(r?.markDone).toBe(true);
    expect(r?.loopKind).toBe("PROMISE");
    expect(r?.promiseTo).toBe("dania");
    expect(r?.title).toBe("returned her call");
  });

  // Tokens after the prefix still resolve (domain, here).
  it("still parses an @domain token after the done: prefix", () => {
    const r = parseQuickAdd("did: morning workout @health");
    expect(r?.markDone).toBe(true);
    expect(r?.domain).toBe("health");
  });

  it("leaves daily: parsing intact (regression)", () => {
    const r = parseQuickAdd("daily: meditate");
    expect(r?.loopKind).toBe("DAILY");
    expect(r?.markDone).toBe(false);
  });
});

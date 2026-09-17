/**
 * `tool_telemetry.tool_name` is a UNIQUE key, so anything that reaches it
 * becomes a tool as far as every reader is concerned.
 *
 * THE PRODUCTION ROW THAT FORCED THIS. One row of 50 held 101 characters of an
 * entire tool-call payload — arguments, newlines, and a stray `</arg_value>`
 * closing tag — where the name belongs. Nothing in this repo emits that
 * encoding (`arg_value` appears nowhere in lib/ or app/), so it arrived from the
 * model's output through a provider/SDK parse. We cannot fix that parser from
 * here; the boundary has to hold.
 *
 * The cost was not one junk row: a real `searchColdMemory` invocation was
 * attributed to the garbage key, so that tool's totalCalls is short by at least
 * one — and the usage census, the never-chosen analysis and the
 * description-rewrite cron's `lastErrors` evidence all read this table.
 */
import { describe, it, expect } from "vitest";
import { isRecordableToolName } from "@/lib/ai/tool-telemetry";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

/** Byte-for-byte the value measured in production on 2026-09-17. */
const THE_ROW = 'searchColdMemory({\n  query: "nicks tire instagram post",\n  scope: "ingest",\n  limit: 5\n})</arg_value>';

describe("isRecordableToolName", () => {
  it("CANARY: rejects the exact 101-char payload found in production", () => {
    expect(THE_ROW.length).toBe(101); // the fixture is the real thing, not a paraphrase
    expect(isRecordableToolName(THE_ROW)).toBe(false);
  });

  it("POSITIVE CONTROL: accepts EVERY name in the live catalog", () => {
    // Without this, a guard that rejected everything would satisfy the canary
    // above and silently stop all telemetry — trading a corrupt table for an
    // empty one, which reads as "no tool was ever called".
    const rejected = TOOL_CATALOG.map((t) => (t as { name: string }).name).filter(
      (n) => !isRecordableToolName(n),
    );
    expect(rejected, "the guard would drop real catalog tools").toEqual([]);
    expect(TOOL_CATALOG.length).toBeGreaterThan(150); // the catalog was actually loaded
  });

  it("accepts the historical dotted keys already in the table", () => {
    // `arsenal.webSearch`, `person.update`, `memory.remember` predate today's
    // naming. They are real invocations and must not be reclassified as junk by
    // a guard added afterwards.
    for (const n of ["arsenal.webSearch", "person.update", "memory.remember", "getGoals"]) {
      expect(isRecordableToolName(n), `${n} is a real historical key`).toBe(true);
    }
  });

  it.each([
    ["embedded newline", "getTasks\nmore"],
    ["call syntax", "getTasks({a:1})"],
    ["closing tag", "getTasks</arg_value>"],
    ["leading digit", "7tools"],
    ["empty", ""],
    ["whitespace", "   "],
    ["over length", "a".repeat(65)],
  ])("rejects %s", (_label, value) => {
    expect(isRecordableToolName(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [["getTasks"]]])(
    "rejects the non-string %s without throwing",
    (value) => {
      expect(isRecordableToolName(value)).toBe(false);
    },
  );
});

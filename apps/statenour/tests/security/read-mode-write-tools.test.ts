/**
 * tests/security/read-mode-write-tools.test.ts
 * 2026-09-02 deep-research audit · finding C-5
 *
 * Read mode is a promise: "nothing runs." It is kept by
 * `stripMutatingTools()`, which asks `classifyTool()` whether each catalog
 * entry is read-safe. That classifier has three tripwires — the
 * `sideEffecting` flag, WRITE_CATEGORIES, and MUTATING_PREFIX — and all
 * three read the CATALOG, never the implementation. So the promise is only
 * as true as the catalog's metadata, and a single wrong `category:` silently
 * converts read mode into write mode for that tool.
 *
 * `proposeCalendarEvent` was exactly that: it calls createEvent() and puts a
 * real event on the operator's Google Calendar, while declaring
 * `category: "personal_read", battle: true`. Its name — the only thing
 * suggesting a proposal — is not a MUTATING_PREFIX verb, so nothing caught it.
 *
 * This test pins the tools whose implementations were read in that audit and
 * confirmed to perform a real write or outbound effect. It is a LEDGER, not a
 * heuristic: a name-based rule is what failed here, so the defense cannot be
 * another name-based rule. Add a row when a tool is confirmed to write.
 */
import { describe, expect, it } from "vitest";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { classifyTool } from "@/lib/ai/capability-registry";

/**
 * Tools whose implementation was READ and confirmed to write or reach
 * outward. Each must classify as NOT read-safe, so read mode strips it.
 */
const CONFIRMED_WRITE_TOOLS: Array<{ name: string; writes: string }> = [
  { name: "proposeCalendarEvent", writes: "createEvent() → the operator's real Google Calendar, attendees included" },
  { name: "sendTelegram", writes: "outbound Telegram message" },
  { name: "sendOpportunitySms", writes: "customer-facing SMS (behind its own approval receipt)" },
  { name: "githubCreateIssue", writes: "creates a GitHub issue" },
  { name: "githubCreatePR", writes: "opens a GitHub pull request" },
  { name: "runDeviceCommand", writes: "queues a command to a physical device" },
  { name: "browseAndDo", writes: "drives a headless browser against a live site" },
];

/**
 * Tools that must STAY available in read mode. Without this half, a
 * classifier that returned "not read-safe" for everything would pass the
 * block above while making read mode useless.
 */
const CONFIRMED_READ_TOOLS = ["getTodaySchedule", "getTasks", "getMissions", "getCommitments"];

describe("read mode · a tool that writes must never classify as read-safe", () => {
  it.each(CONFIRMED_WRITE_TOOLS)("$name is stripped in read mode (writes: $writes)", ({ name }) => {
    const inCatalog = TOOL_CATALOG.some((t) => t.name === name);
    expect(inCatalog, `${name} is missing from TOOL_CATALOG — rename or removal, update this ledger`).toBe(true);
    expect(classifyTool(name).readSafe, `${name} classifies as read-safe but it writes`).toBe(false);
  });

  it("positive control · genuine read tools survive read mode", () => {
    for (const name of CONFIRMED_READ_TOOLS) {
      expect(classifyTool(name).readSafe, `${name} should stay available in read mode`).toBe(true);
    }
  });

  it("proposeCalendarEvent is caught by the flag, not by its name", () => {
    // The regression that produced this test: the name evaded MUTATING_PREFIX
    // ("propose" is not a mutating verb) and the category evaded
    // WRITE_CATEGORIES. Pinning the REASON means a future edit that restores
    // `category: "personal_read"` fails here even if some other tripwire
    // happens to cover it — the catalog must say what the tool does.
    const meta = TOOL_CATALOG.find((t) => t.name === "proposeCalendarEvent");
    expect(meta?.sideEffecting, "the write must be declared on the catalog entry").toBe(true);
    expect(meta?.category).toBe("personal_write");
    expect(meta?.battle ?? false, "a tool that writes is not battle-safe").toBe(false);
  });

  it("no tool is offered in BATTLE mode while declaring a side effect", () => {
    // BATTLE mode is documented as "fast, read-only". `sideEffecting` is the
    // strongest signal a catalog entry can carry, so the two must never
    // co-occur. (The looser invariant "battle implies readSafe" is NOT
    // asserted: two draft/compose tools — draftOpportunitySms, composeEmail —
    // are battle:true and classify unsafe on their names alone. That is the
    // conservative direction and stripping them is harmless; this test guards
    // the dangerous direction.)
    const offenders = TOOL_CATALOG.filter((t) => t.battle && t.sideEffecting).map((t) => t.name);
    expect(offenders).toEqual([]);
  });
});

/**
 * Calendar r2 W3: Nick's calendar write tools are reachable from the way Nour actually asks, and
 * never on shop wording (manager ruling 15:42Z, the same exclusion the people family got in #3440):
 * "schedule the customer's brake job" is a shop job, not an event on his own calendar. Reading his
 * calendar stays reachable either way.
 */
import { describe, expect, it } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
const offered = async (prompt: string) => new Set(Object.keys((await pruneTools("standard" as never, allTools(), prompt)) ?? {}));

describe("calendar write tools · reachable from his words", () => {
  it.each([
    ["move my dentist appointment to thursday at 3", "moveCalendarEvent"],
    ["reschedule my 2pm meeting to friday", "moveCalendarEvent"],
    ["push my call with sam back an hour", "moveCalendarEvent"],
    ["cancel my 2pm meeting", "deleteCalendarEvent"],
    ["delete the gym block from my calendar tomorrow", "deleteCalendarEvent"],
    ["book a focus block at 10 tomorrow", "proposeCalendarEvent"],
    ["put lunch with dad on my calendar saturday at noon", "proposeCalendarEvent"],
  ])("%s -> %s", async (prompt, tool) => {
    expect(await offered(prompt)).toContain(tool);
  });
});

describe("calendar write tools · never on shop wording", () => {
  const WRITES = ["proposeCalendarEvent", "moveCalendarEvent", "deleteCalendarEvent"];
  it.each([
    "schedule the customer's brake job for tomorrow morning",
    "move the tire appointment for the customer to 3",
    "cancel the estimate appointment for the silver civic",
    "book the techs for the alignment job at 10",
  ])("%s reaches no personal calendar write", async (prompt) => {
    const got = await offered(prompt);
    for (const w of WRITES) expect(got.has(w), `${w} offered for: ${prompt}`).toBe(false);
  });

  it("CONTROL: reading his calendar stays reachable on a plain schedule question", async () => {
    expect(await offered("what's on my calendar today")).toContain("getTodaySchedule");
  });

  it("CONTROL: an unrelated question reaches no calendar tool at all", async () => {
    const got = await offered("what's the weather tomorrow");
    expect([...got].filter((t) => /Calendar|Schedule/.test(t))).toEqual([]);
  });
});

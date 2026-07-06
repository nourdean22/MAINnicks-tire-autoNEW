/**
 * action-intent-detector regression corpus · v10.0.391
 *
 * Operator complaint · "chat thinks everything I'm is my to do list".
 * Root cause · the task-add-to-list regex was too broad. Pattern was:
 *   /\b(?:add|put|throw)\b.{0,30}\b(?:to|on|in)\b.{0,20}\b(?:list|todo|to-?do|inbox|tasks)\b/i
 * which fired on:
 *   · "add me to the call list"
 *   · "put him in the inbox detail"
 *   · "throw it on the schedule"
 * Each matched a forced toolChoice='required' on createTask.
 *
 * v10.0.391 tightened the pattern. These tests lock in the new behavior
 * AND the conversational cases that should NEVER fire.
 */

import { describe, expect, it } from "vitest";
import { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";

describe("detectActionIntent · should fire (positive cases)", () => {
  it("explicit add-to-todo", () => {
    expect(detectActionIntent("add this to my todo list")?.intent).toBe("task-add-to-list");
  });
  it("'add to my todo' fires", () => {
    expect(detectActionIntent("add this to my todo")?.intent).toBe("task-add-to-list");
  });
  it("add task explicit", () => {
    const r = detectActionIntent("add a task to call John tomorrow");
    expect(r?.intent).toBe("task-create");
  });
  it("create task with quote", () => {
    expect(detectActionIntent('create: "follow up with supplier"')?.intent).toBe("task-create");
  });
  it("break into tasks (bulk)", () => {
    expect(detectActionIntent("break this into 5 tasks")?.intent).toBe("bulk-task-create");
  });
});

describe("detectActionIntent · should NOT fire (conversational · regression armor)", () => {
  it("'add me to the call list' is conversational, not task creation", () => {
    expect(detectActionIntent("can you add me to the call list?")).toBeNull();
  });
  it("'add it to the schedule' is conversational", () => {
    expect(detectActionIntent("we should add it to the schedule for next week")).toBeNull();
  });
  it("'put him in the inbox' is conversational", () => {
    // 'inbox' alone doesn't trigger · only with 'my'/'the' + task-specific framing
    expect(detectActionIntent("put him in the inbox detail")).toBeNull();
  });
  it("'throw it on the calendar' is conversational", () => {
    expect(detectActionIntent("just throw it on the calendar real quick")).toBeNull();
  });
  it("'I should do X' is reflective, not task creation", () => {
    expect(detectActionIntent("I should follow up with the supplier this week")).toBeNull();
  });
  it("'we need to Y' is conversational", () => {
    expect(detectActionIntent("we need to figure out the pricing model")).toBeNull();
  });
  it("'I might do Z' is conditional, not commitment", () => {
    expect(detectActionIntent("I might call them tomorrow if we have time")).toBeNull();
  });
  it("'let's discuss W' is collaborative", () => {
    expect(detectActionIntent("let's discuss the inventory rotation")).toBeNull();
  });
  it("question form short-circuits", () => {
    expect(detectActionIntent("what tasks do I have today?")).toBeNull();
  });
});

// v10.0.392 · cross-system regression armor.
// The image-noun + decision interceptors are tested at their own
// regex level (in interceptors.ts), but we add cases here to verify
// the action-intent path doesn't accidentally fire on the same
// conversational phrasing.
describe("v10.0.392 · conversational phrasing should never task-ify", () => {
  it("'cover the cost' (was image-noun false positive · also not a task)", () => {
    expect(detectActionIntent("can you cover the cost of those parts")).toBeNull();
  });
  it("'frequent flyer' is conversational", () => {
    expect(detectActionIntent("they're a frequent flyer customer")).toBeNull();
  });
  it("'banner year' is conversational", () => {
    expect(detectActionIntent("last quarter was a banner year for us")).toBeNull();
  });
  it("'I decided to take a different angle' is reflective", () => {
    expect(detectActionIntent("I decided to take a different angle on the campaign")).toBeNull();
  });
});

describe("detectActionIntent · still fires on legit task language", () => {
  it("add task X", () => {
    expect(detectActionIntent("add task: review the contract")?.intent).toBe("task-create");
  });
  it("create todo", () => {
    expect(detectActionIntent("create a new todo for picking up parts")?.intent).toBe("task-create");
  });
  it("complete task", () => {
    expect(detectActionIntent("we're done with the inventory audit")?.intent).toBe("task-complete");
  });
});

// v10.0.533 · data-sync. A live agent_traces read proved "sync my calendar"
// was answered as prose ("Calendar synced") with zero tools called — no sync
// concept existed, so toolChoice was never forced. These lock the new concept
// firing on real sync phrasings AND staying quiet on a meeting "sync up".
describe("detectActionIntent · data-sync (v10.0.533)", () => {
  it.each([
    "sync my calendar",
    "sync my gmail",
    "refresh my inbox",
    "sync my drive",
    "pull my latest emails",
    "ingest my latest docs",
    "refresh my knowledge base",
  ])("fires data-sync on: %s", (q) => {
    const r = detectActionIntent(q);
    expect(r?.intent).toBe("data-sync");
    // expectedTool is the full alternation; the route splits on "|" and
    // attaches all three sync tools, then toolChoice:"required" lets the
    // model pick the right one.
    expect(r?.expectedTool).toContain("syncCalendar");
  });
  it("does NOT fire on a meeting 'sync up' with a distant calendar mention", () => {
    expect(
      detectActionIntent("we should sync up with the team about the calendar next week"),
    ).toBeNull();
  });
  it("does NOT fire on a calendar read question", () => {
    expect(detectActionIntent("what's on my calendar today?")).toBeNull();
  });
});

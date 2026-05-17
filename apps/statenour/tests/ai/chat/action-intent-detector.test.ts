/**
 * Action-intent detector tests · v10.0.175
 *
 * Verifies the proactive force layer:
 *   · clear action requests trigger detection
 *   · questions / observations DO NOT trigger
 *   · the right expectedTool surfaces for each intent
 */

import { describe, it, expect } from "vitest";
import { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";

describe("detectActionIntent · positive matches", () => {
  it("detects bulk-task add (Bay 5 case)", () => {
    const r = detectActionIntent("add these tasks to Bay 5 Revive");
    expect(r?.intent).toBe("bulk-task-create");
    expect(r?.expectedTool).toBe("addTasksToProject");
  });

  it("detects bulk via 'break X into tasks'", () => {
    const r = detectActionIntent("break this project down into tasks please");
    expect(r?.intent).toBe("bulk-task-create");
  });

  it("detects single-task add (the Go to sleep case)", () => {
    const r = detectActionIntent("add a task: go to sleep by midnight");
    expect(r?.expectedTool).toBe("createTask");
  });

  it("detects 'add this to my list'", () => {
    const r = detectActionIntent("add this to my todo list");
    expect(r?.expectedTool).toBe("createTask");
  });

  it("detects mark done", () => {
    const r = detectActionIntent("mark the brake job done");
    expect(r?.expectedTool).toBe("completeTask");
  });

  // v10.0.176 — bare completion verbs without "mark" prefix
  it("detects 'complete those tasks'", () => {
    const r = detectActionIntent("complete those tasks");
    expect(r?.expectedTool).toBe("completeTask");
  });

  it("detects 'finish the brake job'", () => {
    const r = detectActionIntent("finish the brake job");
    expect(r?.expectedTool).toBe("completeTask");
  });

  it("detects \"we're done with the Friday tasks\"", () => {
    const r = detectActionIntent("we're done with the Friday tasks");
    expect(r?.expectedTool).toBe("completeTask");
  });

  // v10.0.176 — imperative "add: X" / "add 'X'" forms
  it("detects 'add: go to sleep'", () => {
    const r = detectActionIntent("add: go to sleep by midnight");
    expect(r?.expectedTool).toBe("createTask");
  });

  it("detects \"add 'pick up parts'\"", () => {
    const r = detectActionIntent("add 'pick up parts' to the list");
    expect(r?.expectedTool).toBe("createTask");
  });

  it("detects send email", () => {
    const r = detectActionIntent("send a follow-up email to that customer");
    expect(r?.expectedTool).toBe("composeEmail");
  });

  it("detects schedule follow-up", () => {
    const r = detectActionIntent("schedule a follow-up for 3 days from now");
    expect(r?.expectedTool).toBe("scheduleFollowUp");
  });

  it("detects priority bump", () => {
    const r = detectActionIntent("bump priority on Bay 5");
    expect(r?.expectedTool).toBe("setTaskPriority");
  });
});

describe("detectActionIntent · questions DO NOT trigger", () => {
  it("ignores 'what tasks do I have?'", () => {
    expect(detectActionIntent("what tasks do I have?")).toBeNull();
  });

  it("ignores 'did you add the tasks?'", () => {
    expect(detectActionIntent("did you add the tasks?")).toBeNull();
  });

  it("ignores 'show me my tasks'", () => {
    expect(detectActionIntent("show me my tasks")).toBeNull();
  });

  it("ignores 'how do I add a task?'", () => {
    expect(detectActionIntent("how do I add a task?")).toBeNull();
  });

  it("ignores 'list all open tasks'", () => {
    expect(detectActionIntent("list all open tasks")).toBeNull();
  });

  it("ignores anything ending with a question mark", () => {
    expect(detectActionIntent("send the email?")).toBeNull();
  });
});

describe("detectActionIntent · edge cases", () => {
  it("returns null for empty input", () => {
    expect(detectActionIntent("")).toBeNull();
    expect(detectActionIntent("  ")).toBeNull();
  });

  it("returns null for very short input", () => {
    expect(detectActionIntent("hi")).toBeNull();
  });

  it("returns null for chitchat", () => {
    expect(detectActionIntent("good morning")).toBeNull();
    expect(detectActionIntent("thanks")).toBeNull();
  });
});

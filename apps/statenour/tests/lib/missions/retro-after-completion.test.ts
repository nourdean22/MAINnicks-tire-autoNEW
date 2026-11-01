/**
 * Nour 2026-11-01 14:22Z: "i just completed a task in health on missions page and it wants me to archive the whole
 * health category as if its a task". Ticking the last open task in a mission opened "Mission complete · Skip +
 * archive" for ANY active non-anchor mission, so a life-area bucket with no end (a Health lane whose anchor flag
 * is missing, or a mission simply titled "Health") read as finished. A mission only closes on its last task when it
 * declares an end state (a deadline or completion criteria, missionHasEndState); everything else stays open, and
 * "Complete mission" stays the explicit door.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retroDueAfterCompletion } from "@/lib/services/mission-helpers";

const task = (id: string, missionId: string, status = "READY", loopKind = "ONCE") => ({ id, missionId, status, loopKind });

const healthBucket = { id: "m-h", title: "GENERAL HEALTH", status: "ACTIVE", systemKind: null, deadline: null };
const project = { id: "m-p", title: "Bathroom repair", status: "ACTIVE", systemKind: null, deadline: "2026-11-20T00:00:00Z" };

describe("retroDueAfterCompletion", () => {
  it("the last task in a life-area bucket (no deadline, no criteria) never offers to archive it", () => {
    expect(retroDueAfterCompletion(healthBucket, [task("t1", "m-h")], "t1")).toBe(false);
    expect(retroDueAfterCompletion({ ...healthBucket, title: "Health" }, [task("t1", "m-h")], "t1")).toBe(false);
  });

  it("control: the last open task of a project with a deadline does open the retro", () => {
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("t0", "m-p", "DONE")], "t1")).toBe(true);
  });

  // Deliberate (silent-failure read, 2026-11-01): a project with no deadline and no criteria no longer opens the retro
  // on its last task either. It still closes through the explicit "Complete mission" door (handleCompleteMission).
  it("a user project with no deadline or criteria does not open the retro on its last task", () => {
    expect(retroDueAfterCompletion({ ...project, deadline: null }, [task("t1", "m-p")], "t1")).toBe(false);
  });
  it("declared completion criteria count as an end state too", () => {
    const p = { ...project, deadline: null, completionCriteria: { done: "tiles set" } };
    expect(retroDueAfterCompletion(p, [task("t1", "m-p")], "t1")).toBe(true);
  });

  it("another open task in the same mission keeps it closed", () => {
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("t2", "m-p")], "t1")).toBe(false);
  });

  it("an open task in ANOTHER mission does not block this one; done or archived siblings do not either", () => {
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("x", "m-other")], "t1")).toBe(true);
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("a", "m-p", "ARCHIVED"), task("d", "m-p", "DONE")], "t1")).toBe(true);
  });

  it("weekly habits do not count as remaining work either", () => {
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("w", "m-p", "READY", "WEEKLY")], "t1")).toBe(true);
  });

  it("habits never count as remaining work", () => {
    expect(retroDueAfterCompletion(project, [task("t1", "m-p"), task("h", "m-p", "READY", "DAILY")], "t1")).toBe(true);
  });

  it("anchors and inactive missions never close on a task", () => {
    expect(retroDueAfterCompletion({ ...project, systemKind: "GENERAL" }, [task("t1", "m-p")], "t1")).toBe(false);
    expect(retroDueAfterCompletion({ ...project, status: "PAUSED" }, [task("t1", "m-p")], "t1")).toBe(false);
  });

  it("the /missions completion flow asks this predicate (wiring pin: the hook has no render harness)", () => {
    const hook = readFileSync("app/(mastery)/missions/hooks/use-mission-actions.ts", "utf8");
    expect(hook).toMatch(/retroDueAfterCompletion\(mission, tasks, id\)/);
  });
});

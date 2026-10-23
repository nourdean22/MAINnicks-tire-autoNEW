/**
 * Focus mode with no next move sorts by the deck's own order (job 2026-10-23,
 * map F15, second half). The stored autoPriority column is stale by design
 * (#1946); the deck's taskOrder is the live score. Without a hero, Focus used
 * to pick by autoPriority and disagree with the cards.
 */
import { describe, expect, it } from "vitest";
import { pickFocusTask } from "@/app/(mastery)/missions/hooks/use-execution-focus";
import type { Task } from "@/components/actions/shared";

const t = (id: string, autoPriority: number, extra: Record<string, unknown> = {}) =>
  ({ id, title: id, status: "READY", autoPriority, dueDate: null, createdAt: "2026-10-01T00:00:00Z", missionId: "m", ...extra }) as unknown as Task;

describe("pickFocusTask · no hero", () => {
  it("takes the first open task in the deck's order, not the highest stored autoPriority", () => {
    const tasks = [t("t-stale-high", 99), t("t-live-top", 1)];
    expect(pickFocusTask(tasks, null, undefined, null, ["t-live-top", "t-stale-high"])?.id).toBe("t-live-top");
  });

  it("skips ids in the order that are no longer open", () => {
    const tasks = [t("t-done", 1, { status: "DONE" }), t("t-next", 1)];
    expect(pickFocusTask(tasks, null, undefined, null, ["t-done", "t-next"])?.id).toBe("t-next");
  });

  it("control: with no deck order (offline), the old heuristic still answers", () => {
    const tasks = [t("t-low", 1), t("t-high", 99)];
    expect(pickFocusTask(tasks, null, undefined, null, [])?.id).toBe("t-high");
  });
});

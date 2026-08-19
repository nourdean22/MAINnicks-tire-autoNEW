import { describe, expect, it } from "vitest";
import { missionBoardReadState } from "@/app/(mastery)/missions/mission-board-read-state";

describe("missionBoardReadState", () => {
  it("renders the board normally when both reads are healthy", () => {
    expect(missionBoardReadState({ tasksData: [], missionsData: [], tasksErrored: false, missionsErrored: false })).toBe("ready");
  });

  it("keeps complete cached data visible after a background refresh fails", () => {
    expect(missionBoardReadState({ tasksData: [{ id: "t1" }], missionsData: [{ id: "m1" }], tasksErrored: true, missionsErrored: false })).toBe("stale");
  });

  it("never substitutes an empty board when either required read has no cached data", () => {
    expect(missionBoardReadState({ tasksData: undefined, missionsData: [], tasksErrored: true, missionsErrored: false })).toBe("unreadable");
    expect(missionBoardReadState({ tasksData: [], missionsData: undefined, tasksErrored: false, missionsErrored: true })).toBe("unreadable");
  });
});

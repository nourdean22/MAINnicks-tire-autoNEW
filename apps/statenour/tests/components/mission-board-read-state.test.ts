import { describe, expect, it } from "vitest";
import { missionBoardReadState } from "@/app/(mastery)/missions/mission-board-read-state";

describe("missionBoardReadState", () => {
  it("renders the board normally when both reads are healthy", () => {
    expect(missionBoardReadState({ tasksData: [], missionsData: [], tasksErrored: false, missionsErrored: false })).toBe("ready");
  });

  it("keeps complete cached data visible after a background refresh fails", () => {
    expect(missionBoardReadState({ tasksData: [{ id: "t1" }], missionsData: [{ id: "m1" }], tasksErrored: true, missionsErrored: false })).toBe("stale");
  });

  // W2 (2026-10-16): the page never read isLoading, so MissionFeed got [] during the first fetch and
  // rendered "no active missions" for a board that had not answered yet (a false empty).
  it("reports loading while either read has no data and has not errored, so the board shows a skeleton", () => {
    expect(missionBoardReadState({ tasksData: undefined, missionsData: undefined, tasksErrored: false, missionsErrored: false })).toBe("loading");
    expect(missionBoardReadState({ tasksData: [], missionsData: undefined, tasksErrored: false, missionsErrored: false })).toBe("loading");
  });

  it("a paused or idle first load (offline: no data, no error, nothing fetching) is loading, never an empty board", () => {
    // review round 1: keyed on isLoading this shape read "ready" with [] (isLoading is isFetching && isPending in v5)
    expect(missionBoardReadState({ tasksData: undefined, missionsData: undefined, tasksErrored: false, missionsErrored: false })).not.toBe("ready");
  });

  it("a read that errored is never loading: unreadable wins when nothing is cached", () => {
    expect(missionBoardReadState({ tasksData: undefined, missionsData: undefined, tasksErrored: true, missionsErrored: false })).toBe("unreadable");
  });

  it("never substitutes an empty board when either required read has no cached data", () => {
    expect(missionBoardReadState({ tasksData: undefined, missionsData: [], tasksErrored: true, missionsErrored: false })).toBe("unreadable");
    expect(missionBoardReadState({ tasksData: [], missionsData: undefined, tasksErrored: false, missionsErrored: true })).toBe("unreadable");
  });
});

/**
 * Round 1 P1-4 (manager, 2026-11-03): a failed next-phase spawn used to look like "nothing to spawn", and milestones
 * 2..N stopped with no sign. The completion result names the failure and /missions says it out loud.
 */
import { describe, expect, it } from "vitest";

import { nextPhaseToast } from "@/lib/missions/next-phase-toast";

describe("nextPhaseToast", () => {
  it("a failed spawn is an error toast that says the next milestone's tasks were not created", () => {
    expect(nextPhaseToast({ nextPhaseSpawnFailed: "db down" })).toEqual({
      kind: "error",
      message: "The next milestone's tasks were not created (db down). Reopen and finish this task to retry.",
    });
  });
  it("a spawn says how many tasks the next milestone got", () => {
    expect(nextPhaseToast({ nextPhaseSpawned: 3 })).toEqual({ kind: "success", message: "Next milestone ready: 3 new tasks" });
    expect(nextPhaseToast({ nextPhaseSpawned: 1 })).toEqual({ kind: "success", message: "Next milestone ready: 1 new task" });
  });
  it("nothing to spawn is no toast", () => {
    expect(nextPhaseToast({ nextPhaseSpawned: 0 })).toBeNull();
    expect(nextPhaseToast(undefined)).toBeNull();
  });
});

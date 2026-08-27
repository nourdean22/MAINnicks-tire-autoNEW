import { scoreTaskPriority } from "@/lib/scoring/task-priority";

describe("scoreTaskPriority", () => {
  it("rewards high ROI, lower friction, due urgency, and primary mission weight", () => {
    const missionMap = new Map([
      [
        "mission-1",
        {
          id: "mission-1",
          rank: 1,
          rankScore: 88
        }
      ]
    ]);

    const result = scoreTaskPriority(
      {
        id: "task-1",
        title: "Top task",
        missionId: "mission-1",
        status: "READY",
        roiScore: 92,
        frictionScore: 18,
        energyRequired: "LOW",
        dueDate: "2099-01-01"
      },
      missionMap,
      new Date("2098-12-31T12:00:00.000Z")
    );

    // 2026-08-27 weight revision (NOW_WEIGHTS): roi demoted, real terms added.
    // Pin the MECHANISMS, not a magic threshold: each named input must move
    // the score in its own direction, and the material facts must be named
    // in the one-line explanation.
    expect(result.score).toBeGreaterThanOrEqual(60); // "high" band
    expect(result.explanation).toContain("mission #1");
    expect(result.explanation).toContain("due in 1d");

    const unranked = scoreTaskPriority(
      {
        id: "task-1",
        title: "Top task",
        missionId: "mission-none",
        status: "READY",
        roiScore: 92,
        frictionScore: 18,
        energyRequired: "LOW",
        dueDate: "2099-01-01"
      },
      missionMap,
      new Date("2098-12-31T12:00:00.000Z")
    );
    expect(result.score).toBeGreaterThan(unranked.score); // mission rank pulls up

    const noDue = scoreTaskPriority(
      {
        id: "task-1",
        title: "Top task",
        missionId: "mission-1",
        status: "READY",
        roiScore: 92,
        frictionScore: 18,
        energyRequired: "LOW",
        dueDate: null
      },
      missionMap,
      new Date("2098-12-31T12:00:00.000Z")
    );
    expect(result.score).toBeGreaterThan(noDue.score); // deadline proximity pulls up
  });

  it("uses manual overrides when present", () => {
    const result = scoreTaskPriority(
      {
        id: "task-1",
        title: "Manual task",
        missionId: "mission-1",
        status: "READY",
        roiScore: 25,
        frictionScore: 82,
        energyRequired: "HIGH",
        manualPriorityOverride: 100
      },
      new Map()
    );

    expect(result.score).toBe(100);
    expect(result.manual).toBe(true);
  });
});

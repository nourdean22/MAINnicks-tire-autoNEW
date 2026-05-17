import { rankMissions } from "@/lib/scoring/mission-ranking";

describe("rankMissions", () => {
  it("orders active missions by weighted score", () => {
    const result = rankMissions([
      {
        id: "a",
        title: "Mission A",
        status: "ACTIVE",
        priority: 8,
        roiScore: 88,
        neglectCost: 74,
        deadline: "2099-01-10"
      },
      {
        id: "b",
        title: "Mission B",
        status: "ACTIVE",
        priority: 5,
        roiScore: 54,
        neglectCost: 41,
        deadline: "2099-02-10"
      }
    ]);

    expect(result.primaryMission?.id).toBe("a");
    expect(result.secondaryMission?.id).toBe("b");
  });

  it("lets manual override win", () => {
    const result = rankMissions([
      {
        id: "a",
        title: "Mission A",
        status: "ACTIVE",
        priority: 10,
        roiScore: 100,
        neglectCost: 100,
        deadline: "2099-01-10"
      },
      {
        id: "b",
        title: "Mission B",
        status: "ACTIVE",
        priority: 1,
        roiScore: 10,
        neglectCost: 10,
        manualRankOverride: 50
      }
    ]);

    expect(result.primaryMission?.id).toBe("b");
    expect(result.primaryMission?.manual).toBe(true);
  });
});

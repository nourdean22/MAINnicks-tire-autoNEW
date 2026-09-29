import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  getDbTyped: vi.fn<() => Promise<any>>(),
  execute: vi.fn(),
  logError: vi.fn(),
  selectResponses: [] as Array<Array<{ armId: string }>>,
}));

vi.mock("./featureFlags", () => ({
  isEnabled: h.isEnabled,
}));

vi.mock("../db", () => ({
  getDbTyped: h.getDbTyped,
}));

vi.mock("../lib/logger", () => ({
  createLogger: () => ({
    error: h.logError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

function fakeDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => h.selectResponses.shift() ?? []),
        })),
      })),
    })),
    execute: h.execute,
  };
}

import {
  CONTACT_HOLDOUT_CONTROL_PCT,
  contactArmForSubject,
  contactLaneForVariant,
  resolveContactExperiment,
} from "./contactExperiment";

describe("contactExperiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.selectResponses.length = 0;
    h.isEnabled.mockResolvedValue(true);
    h.execute.mockResolvedValue([[]]);
    h.getDbTyped.mockResolvedValue(fakeDb());
  });

  it("registers only explicit proactive lanes and preserves independent holdouts", () => {
    expect(contactLaneForVariant("retention_d90_v2")).toMatchObject({
      laneKey: "retention_d90",
      experimentId: "contact:retention_d90:v1",
      flagKey: "contact_holdout_retention",
    });
    expect(contactLaneForVariant("winback")?.laneKey).toBe("winback");
    expect(contactLaneForVariant("drip")?.laneKey).toBe("drip");
    expect(contactLaneForVariant("weather_first_freeze")?.laneKey).toBe("weather_first_freeze");
    expect(contactLaneForVariant("review_request")?.laneKey).toBe("review_request");
    expect(contactLaneForVariant("campaign:42")?.experimentId).toBe("contact:campaign:42:v1");

    expect(contactLaneForVariant("declined_14")).toBeNull();
    expect(contactLaneForVariant("cross_sell")).toBeNull();
    expect(contactLaneForVariant("booking_confirmation")).toBeNull();
    expect(contactLaneForVariant("opp_bridge_lead")).toBeNull();
    expect(contactLaneForVariant(undefined)).toBeNull();
  });

  it("is deterministic and stays near the declared 15% control allocation", () => {
    const experimentId = "contact:retention_d90:v1";
    expect(contactArmForSubject(experimentId, "2165550199"))
      .toBe(contactArmForSubject(experimentId, "2165550199"));

    let controls = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const subject = String(216_000_0000 + i);
      if (contactArmForSubject(experimentId, subject) === "control") controls++;
    }
    const pct = (controls / total) * 100;
    expect(CONTACT_HOLDOUT_CONTROL_PCT).toBe(15);
    expect(pct).toBeGreaterThan(13);
    expect(pct).toBeLessThan(17);
  });

  it("does nothing when the master flag is off", async () => {
    h.isEnabled.mockImplementation(async (key) => key !== "contact_holdouts_enabled");

    const result = await resolveContactExperiment("2165550100", "retention_d90");

    expect(result).toMatchObject({
      eligible: true,
      armed: false,
      measurable: false,
      armId: null,
      reason: "master_flag_off",
    });
    expect(h.getDbTyped).not.toHaveBeenCalled();
  });

  it("fails open to treatment when durable assignment storage is unavailable", async () => {
    h.getDbTyped.mockResolvedValue(null);

    const result = await resolveContactExperiment("2165550101", "winback");

    expect(result).toMatchObject({
      eligible: true,
      armed: true,
      measurable: false,
      armId: "treatment",
      reason: "db_unavailable_send_normally",
    });
  });

  it("reuses an existing durable assignment without rewriting it", async () => {
    h.selectResponses.push([{ armId: "control" }]);

    const result = await resolveContactExperiment("2165550102", "review_request");

    expect(result).toMatchObject({
      measurable: true,
      armId: "control",
      reason: "existing_durable_assignment",
    });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("INSERT IGNOREs once and trusts the durable read-back in a race", async () => {
    // First read sees no row. A concurrent writer wins the unique key and
    // read-back says treatment; the local predicted arm must not override it.
    h.selectResponses.push([], [{ armId: "treatment" }]);

    const result = await resolveContactExperiment("2165550103", "campaign:77");

    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      measurable: true,
      armId: "treatment",
      reason: "durable_assignment_created",
      experimentId: "contact:campaign:77:v1",
    });
  });

  it("fails open to treatment on assignment exceptions", async () => {
    h.getDbTyped.mockRejectedValue(new Error("db down"));

    const result = await resolveContactExperiment("2165550104", "drip");

    expect(result).toMatchObject({
      measurable: false,
      armId: "treatment",
      reason: "assignment_error_send_normally",
    });
    expect(h.logError).toHaveBeenCalled();
  });
});

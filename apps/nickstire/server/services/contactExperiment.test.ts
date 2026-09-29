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
    expect(contactLaneForVariant("weather_first_freeze")?.laneKey).toBe("weather_first_freeze");
    expect(contactLaneForVariant("review_request")?.laneKey).toBe("review_request");
    expect(contactLaneForVariant("campaign:42")?.experimentId).toBe("contact:campaign:42:v1");

    // drip pools every drip campaign (incl. declined-estimate follow-ups) under
    // one key and its processor ignores the send outcome: not a lane.
    expect(contactLaneForVariant("drip")).toBeNull();
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

  // The race test above cannot tell "returned the stored row" from "returned
  // the local prediction" if the prediction is already treatment. These pick
  // subjects whose PREDICTED arm differs from the STORED one, in both directions.
  it.each([
    ["control", "treatment"],
    ["treatment", "control"],
  ] as const)("a race where the prediction is %s but the stored row is %s returns the STORED arm", async (predicted, stored) => {
    const experimentId = "contact:winback:v1";
    let phone = "";
    for (let i = 0; i < 100; i++) {
      const candidate = `216555${String(100 + i).padStart(4, "0")}`;
      if (contactArmForSubject(experimentId, candidate) === predicted) { phone = candidate; break; }
    }
    expect(phone).not.toBe("");
    h.selectResponses.push([], [{ armId: stored }]);

    const result = await resolveContactExperiment(phone, "winback");

    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(result.armId).toBe(stored);
    expect(result.measurable).toBe(true);
  });

  it("assigns every lane INDEPENDENTLY: both-control rate ≈ 15% × 15% for every real lane pair", () => {
    // The real lane ids a customer can be in at once. The old x31 polynomial
    // hash made each lane the same hash shifted by a constant: measured over
    // 50k numbers, pairs ranged 0.00%-14.38% both-control against 2.25%.
    const experimentIds = [
      ...["d7", "d14", "d45", "d90", "d180", "d365"].map((t) => `contact:retention_${t}:v1`),
      "contact:winback:v1",
      "contact:review_request:v1",
      "contact:weather_first_freeze:v1",
      "contact:weather_snow_forecast:v1",
      "contact:campaign:12:v1",
      "contact:campaign:13:v1",
    ];
    const N = 20_000;
    const controls = experimentIds.map((id) => {
      const arr = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        arr[i] = contactArmForSubject(id, String(2_160_000_000 + i * 37)) === "control" ? 1 : 0;
      }
      return arr;
    });
    for (let a = 0; a < experimentIds.length; a++) {
      for (let b = a + 1; b < experimentIds.length; b++) {
        let both = 0;
        for (let i = 0; i < N; i++) both += controls[a][i] & controls[b][i];
        const pct = (both / N) * 100;
        expect(pct, `${experimentIds[a]} x ${experimentIds[b]}`).toBeGreaterThan(2.25 - 0.6);
        expect(pct, `${experimentIds[a]} x ${experimentIds[b]}`).toBeLessThan(2.25 + 0.6);
      }
    }
  });

  it("never logs the phone when the assignment query fails (the drizzle error carries bound params)", async () => {
    // Shape of a real DrizzleQueryError: the message is the SQL AND its params.
    const phone = "2165550188";
    class DrizzleQueryError extends Error {}
    h.execute.mockRejectedValue(new DrizzleQueryError(
      `Failed query: INSERT IGNORE INTO contact_experiment_assignments (...) VALUES (?, ?, ?, ?, ?, ?)\nparams: contact:winback:v1,winback,${phone},control,v1,winback`,
    ));
    h.selectResponses.push([]);

    const result = await resolveContactExperiment(`+1${phone}`, "winback");

    expect(result.reason).toBe("assignment_error_send_normally");
    expect(h.logError).toHaveBeenCalled();
    const logged = JSON.stringify(h.logError.mock.calls);
    expect(logged).toContain("DrizzleQueryError");
    expect(logged).not.toContain(phone);
    expect(logged).not.toContain(phone.slice(-7));
  });

  it("fails open to treatment on assignment exceptions", async () => {
    h.getDbTyped.mockRejectedValue(new Error("db down"));

    const result = await resolveContactExperiment("2165550104", "winback");

    expect(result).toMatchObject({
      measurable: false,
      armId: "treatment",
      reason: "assignment_error_send_normally",
    });
    expect(h.logError).toHaveBeenCalled();
  });
});

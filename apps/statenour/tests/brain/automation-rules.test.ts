/**
 * The automation engine, against the eight rules it actually has.
 *
 * THE AUDIT THIS ENCODES. `automation-engine.ts` had never run, and disagreed
 * with its own stored rules at four levels. Three were shape mismatches; the
 * fourth was semantics, and it is the one that would have hurt:
 *
 *   THE RULES ARE EDGE-TRIGGERED. THE ENGINE WAS LEVEL-TRIGGERED.
 *
 * "Camera offline alert" means a camera WENT offline. The engine asked whether
 * a camera IS offline. Measured in prod 2026-08-26: 20 of 22 devices OFFLINE,
 * last seen 2026-04-06..04-14 — the integration died in April. At the stored
 * 1-hour cooldown that is 24 Telegrams a day about a four-month-old fact.
 *
 * Every fixture below is the REAL trigger/action JSON from prod, so this file
 * doubles as the record of what each rule does now.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateTrigger,
  matchesDeviceCondition,
  unsupportedConditionKeys,
  computeFingerprint,
  planAction,
  type DeviceView,
  type EvalContext,
  type TriggerSpec,
} from "@/lib/brain/automation-rules";

const cam = (id: string, status = "OFFLINE"): DeviceView => ({
  id,
  status,
  deviceType: "CAMERA",
  currentState: null,
});

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  devices: [cam("c1"), cam("c2"), { id: "l1", status: "ONLINE", deviceType: "LOCK", currentState: null }],
  hour: 14,
  dayOfWeek: 3,
  freshMemoryCategories: new Set<string>(),
  ...over,
});

describe("device conditions describe a CLASS, and unknown fields are unsatisfiable", () => {
  it("matches every camera that is offline — the shape the old matcher could not", () => {
    // The old code was devices.find(d => d.id === trigger.deviceId), and the
    // rule carries no deviceId, so it never fired.
    const cond = { status: "OFFLINE", deviceType: "CAMERA" };
    expect(matchesDeviceCondition(cam("c1"), cond)).toBe(true);
    expect(matchesDeviceCondition(cam("c9", "ONLINE"), cond)).toBe(false);
  });

  it("AN UNKNOWN FIELD MATCHES NOTHING, rather than being ignored", () => {
    // "Device running 6+ hours" is {runningHours: 6}. SmartDevice has no such
    // column. Ignoring the key would make the condition vacuously true and
    // alert on EVERY device in the estate — worse than never firing.
    expect(matchesDeviceCondition(cam("c1"), { runningHours: 6 })).toBe(false);
    expect(unsupportedConditionKeys({ runningHours: 6 })).toEqual(["runningHours"]);
    expect(unsupportedConditionKeys({ status: "OFFLINE", deviceType: "CAMERA" })).toEqual([]);
  });

  it("an empty condition matches nothing, not everything", () => {
    expect(matchesDeviceCondition(cam("c1"), {})).toBe(false);
  });
});

describe("the fingerprint is what makes a level trigger behave like an edge", () => {
  it("is stable regardless of device order", () => {
    // Postgres does not promise row order. An order-sensitive fingerprint would
    // re-alert on nothing but a re-sort.
    expect(computeFingerprint("device", ["b", "a"])).toBe(computeFingerprint("device", ["a", "b"]));
  });

  it("changes when the match set changes, and only then", () => {
    const two = computeFingerprint("device", ["c1", "c2"]);
    expect(computeFingerprint("device", ["c1", "c2"])).toBe(two);
    expect(computeFingerprint("device", ["c1", "c2", "c3"])).not.toBe(two);
  });
});

describe("triggers · the four types, including the one that silently never ran", () => {
  it("time fires on the ET hour and respects a day filter", () => {
    const t: TriggerSpec = { type: "time", hour: 14 };
    expect(evaluateTrigger(t, ctx()).fires).toBe(true);
    expect(evaluateTrigger(t, ctx({ hour: 13 })).fires).toBe(false);
    expect(evaluateTrigger({ ...t, days: [0, 6] }, ctx()).fires).toBe(false);
  });

  it("device_state fires on a class match and fingerprints the matched set", () => {
    const r = evaluateTrigger(
      { type: "device_state", condition: { status: "OFFLINE", deviceType: "CAMERA" } },
      ctx(),
    );
    expect(r.fires).toBe(true);
    expect(r.fingerprint).toBe(computeFingerprint("device", ["c1", "c2"]));
  });

  it("device_state REFUSES a condition it cannot evaluate, and says which field", () => {
    const r = evaluateTrigger({ type: "device_state", condition: { runningHours: 6 } }, ctx());
    expect(r.fires).toBe(false);
    expect(r.reason).toContain("runningHours");
  });

  it("pattern needs a FRESH memory in its category", () => {
    const t: TriggerSpec = { type: "pattern", category: "anomaly" };
    expect(evaluateTrigger(t, ctx()).fires).toBe(false);
    expect(
      evaluateTrigger(t, ctx({ freshMemoryCategories: new Set(["anomaly"]) })).fires,
    ).toBe(true);
  });

  it("composite is ANDed — and it used to fall through the switch entirely", () => {
    // "Late night motion + lights off". There was no composite case and no
    // default:, so shouldFire stayed false with no error and no log.
    const t: TriggerSpec = {
      type: "composite",
      conditions: [
        { type: "time", hour: 23 },
        { type: "device_state", condition: { status: "OFFLINE", deviceType: "CAMERA" } },
      ],
    };
    expect(evaluateTrigger(t, ctx({ hour: 23 })).fires).toBe(true);
    expect(evaluateTrigger(t, ctx({ hour: 10 })).fires).toBe(false);
  });

  it("AN UNKNOWN TRIGGER TYPE IS REPORTED, not silently skipped", () => {
    const r = evaluateTrigger({ type: "moon_phase" } as TriggerSpec, ctx());
    expect(r.fires).toBe(false);
    expect(r.reason).toContain("moon_phase");
  });
});

describe("actions · the stored shapes, none of which the old loop could run", () => {
  it("notify and check both become a message", () => {
    // Both stored `check` actions ("Check shop camera activity", "No device
    // commands in 48 hours") ask the operator to look at something. That is a
    // message, not a device command.
    for (const type of ["notify", "check"]) {
      const p = planAction({ type, channel: "telegram", message: "Camera went offline" }, "Camera offline alert");
      expect(p.kind).toBe("notify");
      if (p.kind === "notify") {
        expect(p.message).toContain("Camera offline alert");
        expect(p.message).toContain("Camera went offline");
      }
    }
  });

  it("THE OLD BUG: a notify action must not become a DeviceCommand", () => {
    // deviceId and command are both NOT NULL with an FK. The old loop built one
    // from undefined fields on every action, so every fire threw.
    const p = planAction({ type: "notify", message: "hi" }, "R");
    expect(p.kind).not.toBe("device");
  });

  it("a device command is planned only when it carries both required fields", () => {
    expect(planAction({ type: "device_command", deviceId: "d1", command: "turn_off" }, "R").kind).toBe("device");
    expect(planAction({ type: "device_command", deviceId: "d1" }, "R").kind).toBe("unsupported");
  });

  it("an unsupported action names itself", () => {
    const p = planAction({ type: "teleport" }, "R");
    expect(p.kind).toBe("unsupported");
    if (p.kind === "unsupported") expect(p.detail).toContain("teleport");
  });
});

describe("THE EIGHT REAL RULES · what each one does now", () => {
  // Live prod device mix: 10 CAMERA/OFFLINE, 2 CAMERA/ONLINE, plus others.
  const prodCtx = ctx({
    devices: [
      ...Array.from({ length: 10 }, (_, i) => cam(`cam${i}`)),
      cam("live1", "ONLINE"),
      cam("live2", "ONLINE"),
    ],
    hour: 18,
  });

  const cases: Array<[string, TriggerSpec, boolean]> = [
    ["No leads in 24 hours (time 18)", { type: "time", hour: 18 }, true],
    ["Shop inactive (time 14)", { type: "time", hour: 14 }, false],
    ["System disconnect (time 8)", { type: "time", hour: 8 }, false],
    [
      "Camera offline alert",
      { type: "device_state", condition: { status: "OFFLINE", deviceType: "CAMERA" } },
      true,
    ],
    ["Device running 6+ hours", { type: "device_state", condition: { runningHours: 6 } }, false],
    ["High drift risk task", { type: "pattern", category: "anomaly" }, false],
    ["Low energy pattern detected", { type: "pattern", category: "pattern" }, false],
    [
      "Late night motion + lights off",
      {
        type: "composite",
        conditions: [
          { type: "time", hour: 23 },
          { type: "device_state", condition: { event: "motion_detected" } },
        ],
      },
      false,
    ],
  ];

  for (const [name, trigger, expected] of cases) {
    it(`${name} -> ${expected ? "FIRES" : "does not fire"}`, () => {
      expect(evaluateTrigger(trigger, prodCtx).fires).toBe(expected);
    });
  }

  it("POSITIVE CONTROL: the engine is not simply refusing everything", () => {
    // Every assertion above could be satisfied by an evaluator that always
    // returned false. At least one real rule must fire, and its fingerprint
    // must name the ten offline cameras rather than being a constant.
    const firing = cases.filter(([, t]) => evaluateTrigger(t, prodCtx).fires);
    expect(firing.length).toBeGreaterThan(0);
    const camera = evaluateTrigger(cases[3][1], prodCtx);
    expect(camera.fingerprint).toContain("cam0");
    expect(camera.reason).toContain("10");
  });

  it("THE ALERT-FATIGUE GUARD: an unchanged world produces an unchanged fingerprint", () => {
    // This is what stops 24 messages a day about April. Same devices, later
    // hour, same fingerprint -> the engine suppresses the repeat.
    const a = evaluateTrigger(cases[3][1], prodCtx);
    const b = evaluateTrigger(cases[3][1], { ...prodCtx, hour: 19 });
    expect(a.fingerprint).toBe(b.fingerprint);

    // An eleventh camera dropping IS new, and must break the tie.
    const c = evaluateTrigger(cases[3][1], {
      ...prodCtx,
      devices: [...prodCtx.devices, cam("cam10")],
    });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });
});

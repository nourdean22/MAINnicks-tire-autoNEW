/**
 * Pure evaluation for the automation engine — triggers, actions, and the
 * fingerprint that stops a permanently-true condition alerting forever.
 *
 * WHY THIS FILE EXISTS. `automation-engine.ts` had never run, and an audit on
 * 2026-08-26 found it disagreed with its own stored rules at FOUR levels. Three
 * were shape mismatches. The fourth is a semantics mismatch and is the one that
 * matters most:
 *
 *   THE RULES ARE EDGE-TRIGGERED. THE ENGINE WAS LEVEL-TRIGGERED.
 *
 * "Camera offline alert" means a camera WENT offline. The engine evaluated
 * whether a camera IS offline. Measured in prod: 20 of 22 devices are OFFLINE
 * and were last seen 2026-04-06..04-14 — the integration died in April. With a
 * 1-hour cooldown, a level-triggered executor sends 24 messages a day about a
 * four-month-old fact. That is the alert-fatigue failure this estate has
 * already paid for once.
 *
 * So a rule fires when its MATCH SET CHANGES, not while the condition holds.
 * `computeFingerprint` reduces the match to a stable string; the engine stores
 * it and re-fires only when it differs. Ten cameras going offline is one alert;
 * an eleventh joining them is a new one; nothing changing is silence.
 *
 * Everything here is pure so it can be tested without a database, a clock, or
 * Telegram. The engine keeps the I/O.
 */

/** The device fields the engine actually selects. Structural on purpose. */
export interface DeviceView {
  id: string;
  status: string;
  deviceType: string;
  currentState: unknown;
}

export interface EvalContext {
  devices: DeviceView[];
  /** ET hour 0-23. */
  hour: number;
  /** ET weekday, 0=Sun. */
  dayOfWeek: number;
  /** Categories with a memory fresh enough to count, for `pattern` triggers. */
  freshMemoryCategories: Set<string>;
}

export type TriggerEval =
  | { fires: false; reason: string; fingerprint: null }
  | { fires: true; reason: string; fingerprint: string };

const NO: (reason: string) => TriggerEval = (reason) => ({
  fires: false,
  reason,
  fingerprint: null,
});

/**
 * Does a device satisfy a condition describing a CLASS of device?
 *
 * The stored rules describe classes — `{status:"OFFLINE", deviceType:"CAMERA"}`
 * — while the old matcher only handled `{deviceId}`, so both device rules could
 * never fire. Unknown keys make a condition UNSATISFIABLE rather than ignored:
 * `{runningHours: 6}` refers to a field SmartDevice does not have, and silently
 * treating an unmatchable condition as matched would fire an alert on every
 * device in the estate.
 */
export function matchesDeviceCondition(
  device: DeviceView,
  condition: Record<string, unknown>,
): boolean {
  const entries = Object.entries(condition);
  if (entries.length === 0) return false; // an empty condition matches nothing, not everything
  return entries.every(([key, want]) => {
    if (key === "deviceId") return device.id === want;
    if (key === "status") return device.status === want;
    if (key === "deviceType") return device.deviceType === want;
    // Anything else is a field this view does not carry. Unsatisfiable.
    return false;
  });
}

/** Keys `matchesDeviceCondition` can actually evaluate. */
export const SUPPORTED_DEVICE_KEYS = ["deviceId", "status", "deviceType"] as const;

/** Condition keys this engine cannot evaluate, for loud reporting. */
export function unsupportedConditionKeys(condition: Record<string, unknown>): string[] {
  return Object.keys(condition).filter(
    (k) => !(SUPPORTED_DEVICE_KEYS as readonly string[]).includes(k),
  );
}

/**
 * Stable identity for a match, so re-evaluating an unchanged world is silent.
 * Sorted, because device order from the database is not guaranteed and an
 * order-dependent fingerprint would alert on nothing but a re-sort.
 */
export function computeFingerprint(kind: string, parts: string[]): string {
  return `${kind}:${[...parts].sort().join(",")}`;
}

export interface TriggerSpec {
  type?: string;
  hour?: number;
  minute?: number;
  days?: number[];
  deviceId?: string;
  condition?: Record<string, unknown>;
  category?: string;
  conditions?: TriggerSpec[];
  [k: string]: unknown;
}

/**
 * Evaluate one trigger. Never throws; an unknown type is reported, not ignored.
 *
 * The old switch had no `default:`, so a `composite` rule fell straight through
 * with `shouldFire` still false — no error, no log, never evaluated. One stored
 * rule was in exactly that state.
 */
export function evaluateTrigger(trigger: TriggerSpec, ctx: EvalContext): TriggerEval {
  switch (trigger.type) {
    case "time": {
      if (typeof trigger.hour !== "number") return NO("time trigger has no hour");
      if (ctx.hour !== trigger.hour) return NO(`hour ${ctx.hour} != ${trigger.hour}`);
      if (trigger.days && !trigger.days.includes(ctx.dayOfWeek)) {
        return NO(`day ${ctx.dayOfWeek} not in schedule`);
      }
      // One fire per ET day per rule: the hour is true for the whole hour, and
      // a tick-rate re-alert is the level-trigger bug in miniature.
      return {
        fires: true,
        reason: `ET hour ${trigger.hour}`,
        fingerprint: computeFingerprint("time", [`${ctx.dayOfWeek}`, `${trigger.hour}`]),
      };
    }

    case "device_state": {
      const condition = trigger.condition ?? (trigger.deviceId ? { deviceId: trigger.deviceId } : {});
      const unsupported = unsupportedConditionKeys(condition);
      if (unsupported.length > 0) {
        return NO(`condition references unsupported field(s): ${unsupported.join(", ")}`);
      }
      const matched = ctx.devices.filter((d) => matchesDeviceCondition(d, condition));
      if (matched.length === 0) return NO("no device matches");
      return {
        fires: true,
        reason: `${matched.length} device(s) match`,
        fingerprint: computeFingerprint("device", matched.map((d) => d.id)),
      };
    }

    case "pattern": {
      if (!trigger.category) return NO("pattern trigger has no category");
      if (!ctx.freshMemoryCategories.has(trigger.category)) {
        return NO(`no fresh memory in "${trigger.category}"`);
      }
      return {
        fires: true,
        reason: `fresh memory in ${trigger.category}`,
        fingerprint: computeFingerprint("pattern", [trigger.category]),
      };
    }

    case "composite": {
      const subs = trigger.conditions ?? [];
      if (subs.length === 0) return NO("composite trigger has no conditions");
      const results = subs.map((s) => evaluateTrigger(s, ctx));
      const failed = results.find((r) => !r.fires);
      if (failed) return NO(`composite: ${failed.reason}`);
      return {
        fires: true,
        reason: `all ${subs.length} conditions met`,
        fingerprint: computeFingerprint(
          "composite",
          results.map((r) => r.fingerprint as string),
        ),
      };
    }

    default:
      // LOUD. The absence of this branch is why one rule silently never ran.
      return NO(`unsupported trigger type "${String(trigger.type)}"`);
  }
}

export interface ActionSpec {
  type?: string;
  channel?: string;
  message?: string;
  target?: string;
  deviceId?: string;
  command?: string;
  params?: unknown;
  [k: string]: unknown;
}

export type PlannedAction =
  | { kind: "notify"; message: string }
  | { kind: "device"; deviceId: string; command: string; params: unknown }
  | { kind: "unsupported"; detail: string };

/**
 * Turn a stored action into something executable.
 *
 * The old loop read neither `action.type` nor anything else — it built a
 * DeviceCommand from `action.deviceId`/`action.command` unconditionally. Every
 * stored action is `notify` or `check` and carries neither field, and both
 * columns are NOT NULL with an FK, so every fire threw.
 *
 * `check` maps to a notification on purpose: both stored `check` actions read
 * "Check shop camera activity" and "No device commands in 48 hours" — they ask
 * the operator to look at something, which is a message, not a device command.
 */
export function planAction(action: ActionSpec, ruleName: string): PlannedAction {
  switch (action.type) {
    case "notify":
    case "check": {
      const body = action.message?.trim();
      if (!body) return { kind: "unsupported", detail: `${action.type} action has no message` };
      return { kind: "notify", message: `🤖 <b>${ruleName}</b>\n${body}` };
    }
    case "device_command": {
      if (!action.deviceId || !action.command) {
        return { kind: "unsupported", detail: "device_command missing deviceId or command" };
      }
      return {
        kind: "device",
        deviceId: action.deviceId,
        command: action.command,
        params: action.params ?? null,
      };
    }
    default:
      return { kind: "unsupported", detail: `unsupported action type "${String(action.type)}"` };
  }
}

/**
 * Feature-flag registry contract tests — UNMOCKED on purpose.
 *
 * Regression guard for the 2026-07-10 review finding: NICK_MUTATION_LOCK
 * was read via getFlag() in lib/tools/tool-policy.ts and lib/trpc/trpc.ts
 * but never added to FLAG_REGISTRY. getFlag() returns null for
 * unregistered keys, so `getFlag(...)?.isOn ?? false` made the emergency
 * mutation kill-switch permanently false regardless of the env var.
 * The existing tool-policy tests mocked getFlag, so they could never
 * catch this. These tests hit the REAL registry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { FLAG_REGISTRY, getFlag, getAllFlags } from "@/lib/feature-flags";
import { isCostFirewallOn, isFailoverRescueOn } from "@/lib/ai/provider";
import { isCalibrationEnforcerOn } from "@/lib/ai/chat/calibration-enforcer";
import { isJitSectionsOn } from "@/lib/ai/vnext/jit-sections";
import { isDeepAnthropicCanaryOn } from "@/lib/ai/vnext/effort-policy";
import { isEscalationEnabled } from "@/lib/ai/vnext/escalation";
import { areFollowUpsEnabled } from "@/lib/agent/follow-up";

const KEY = "NICK_MUTATION_LOCK";
const GATEWAY_KEYS = ["NICK_MEMORY_GATEWAY_PHASE1", "NICK_MEMORY_GATEWAY_PHASE2"] as const;

describe("FLAG_REGISTRY contract", () => {
  afterEach(() => {
    delete process.env[KEY];
    for (const key of GATEWAY_KEYS) delete process.env[key];
  });

  it("registers NICK_MUTATION_LOCK (the kill-switch consumers depend on)", () => {
    expect(FLAG_REGISTRY.some((f) => f.key === KEY)).toBe(true);
  });

  it("getFlag(NICK_MUTATION_LOCK) resolves instead of returning null", () => {
    const flag = getFlag(KEY);
    expect(flag).not.toBeNull();
    expect(flag?.isOn).toBe(false); // unset env -> off
  });

  it.each(["true", "1", "on", "TRUE", "ON"])(
    "env %s activates the lock (incident fat-finger tolerance)",
    (val) => {
      process.env[KEY] = val;
      expect(getFlag(KEY)?.isOn).toBe(true);
    },
  );

  it("arbitrary values do NOT activate the lock", () => {
    process.env[KEY] = "yes-please";
    expect(getFlag(KEY)?.isOn).toBe(false);
  });

  it("every registry key is unique", () => {
    const keys = FLAG_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(GATEWAY_KEYS)(
    "%s is visibly read-only because its runtime still reads the raw env var",
    (key) => {
      expect(FLAG_REGISTRY.find((flag) => flag.key === key)?.readOnly).toBe(true);
    },
  );

  it.each(GATEWAY_KEYS)(
    "%s mirrors its raw !== 0 runtime kill-switch exactly",
    (key) => {
      for (const [value, expected] of [[undefined, true], ["0", false], ["1", true], ["true", true], ["false", true], [" 0 ", true]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
        expect(getFlag(key)?.isOn).toBe(expected);
      }
    },
  );
});

/**
 * 2026-09-18 · THE BOARD MUST AGREE WITH THE CODE IT MIRRORS.
 *
 * Seven raw-`process.env` switches were registered as `readOnly` mirrors so
 * the flag board can show them. A mirror that DISAGREES with its runtime is
 * strictly worse than no entry at all: an absent flag reads as "unknown", but
 * a wrong one reads as authoritative. So each entry is pinned here against the
 * exact truth table of the expression it claims to mirror.
 *
 * Two-sided on purpose. Each case asserts the board's `isOn`, AND the suite
 * pins the source expression itself — flip `!== "0"` to `=== "1"` in the
 * runtime and the source pin fails, rather than the board quietly lying.
 *
 * This is not hypothetical: measuring it found one real divergence.
 * `NICK_AGENT_FOLLOWUPS=" 1 "` made lib/agent/follow-up.ts return TRUE (it
 * trims) while the board rendered OFF. Fixed with the opt-in `trimRawValue`
 * rather than by trimming every readOnly flag, which would have broken
 * agreement for the mirrors whose runtimes do NOT trim.
 */
describe("readOnly mirrors agree with the runtime predicates they mirror", () => {
  /**
   * 2026-09-18 · v2, after review (#2429) on two counts.
   *
   * v1 pinned the SOURCE TEXT of each mirrored expression with `toContain`.
   * That is pinning by MENTION: `NICK_CANARY_DEEP_ANTHROPIC` had TWO consumers,
   * so changing one while the other kept the old expression left the assertion
   * green — and a stale comment containing the same text would satisfy it too.
   *
   * v2 CALLS the real predicate. Every mirrored switch now has an exported
   * predicate (four were extracted for this, which also collapsed the
   * two-consumer duplication into one function), so the agreement asserted here
   * is behavioural, not textual. Change a runtime and this goes red.
   *
   * Both board readers are exercised. `getFlag()` and `getAllFlags()` had
   * separate copies of the raw-value logic and had already drifted —
   * `trimRawValue` reached only getFlag, so the OPERATOR BOARD (which renders
   * via getAllFlags) still showed OFF for a padded value while the test passed.
   * They share one resolver now, and both are asserted.
   */
  const PREDICATES: Array<[string, () => boolean, Array<[string | undefined, boolean]>]> = [
    ["NICK_COST_FIREWALL", isCostFirewallOn,
      [[undefined, true], ["0", false], ["1", true], ["yes", true]]],
    ["NICK_CALIBRATION_ENFORCER", isCalibrationEnforcerOn,
      [[undefined, true], ["0", false], ["1", true]]],
    ["NICK_JIT_SECTIONS", isJitSectionsOn,
      [[undefined, true], ["0", false], ["1", true]]],
    ["NICK_FAILOVER_RESCUE", isFailoverRescueOn,
      [[undefined, false], ["1", true], ["0", false]]],
    ["NICK_CANARY_DEEP_ANTHROPIC", isDeepAnthropicCanaryOn,
      [[undefined, false], ["1", true], ["0", false]]],
    // INVERTED NAME: the board key is NICK_ESCALATION_DISABLED, so board isOn
    // is the NEGATION of this predicate. Asserted explicitly below.
    ["NICK_ESCALATION_DISABLED", isEscalationEnabled,
      [[undefined, true], ["1", false], ["0", true]]],
    ["NICK_AGENT_FOLLOWUPS", areFollowUpsEnabled,
      // The padded case is the divergence trimRawValue exists to close.
      [[undefined, false], ["1", true], [" 1 ", true], ["0", false]]],
  ];

  const INVERTED = new Set(["NICK_ESCALATION_DISABLED"]);

  afterEach(() => {
    for (const [key] of PREDICATES) delete process.env[key];
  });

  it("positive control: every mirrored key is registered AND readOnly", () => {
    for (const [key] of PREDICATES) {
      const spec = FLAG_REGISTRY.find((f) => f.key === key);
      expect(spec, `${key} is not in FLAG_REGISTRY`).toBeTruthy();
      expect(spec!.readOnly, `${key} must be readOnly — its runtime reads process.env directly`).toBe(true);
    }
  });

  it("positive control: the predicates are not all constant", () => {
    // If every predicate ignored its env var, the tables below would still
    // pass for whichever value happened to match. Prove at least one flips.
    process.env.NICK_FAILOVER_RESCUE = "1";
    expect(isFailoverRescueOn()).toBe(true);
    process.env.NICK_FAILOVER_RESCUE = "0";
    expect(isFailoverRescueOn()).toBe(false);
  });

  it.each(PREDICATES)("%s · getFlag agrees with the real predicate", (key, predicate, table) => {
    for (const [envValue, predicateExpected] of table) {
      if (envValue === undefined) delete process.env[key];
      else process.env[key] = envValue;

      expect(predicate(), `${key}=${JSON.stringify(envValue)} — runtime predicate changed`).toBe(predicateExpected);

      const boardExpected = INVERTED.has(key) ? !predicateExpected : predicateExpected;
      expect(getFlag(key)?.isOn, `${key}=${JSON.stringify(envValue)} — getFlag disagrees with runtime`).toBe(boardExpected);
    }
  });

  it.each(PREDICATES)("%s · getAllFlags (the OPERATOR BOARD) agrees too", (key, predicate, table) => {
    // The path the operator actually sees. v1 never exercised it, which is how
    // trimRawValue shipped fixing only getFlag.
    for (const [envValue, predicateExpected] of table) {
      if (envValue === undefined) delete process.env[key];
      else process.env[key] = envValue;

      const onBoard = getAllFlags().find((f) => f.key === key);
      expect(onBoard, `${key} missing from getAllFlags()`).toBeTruthy();
      const boardExpected = INVERTED.has(key) ? !predicate() : predicate();
      expect(onBoard!.isOn, `${key}=${JSON.stringify(envValue)} — the BOARD disagrees with runtime`).toBe(boardExpected);
    }
  });
});

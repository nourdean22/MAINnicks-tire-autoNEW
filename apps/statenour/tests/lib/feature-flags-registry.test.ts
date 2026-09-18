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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAG_REGISTRY, getFlag } from "@/lib/feature-flags";

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
describe("readOnly mirrors agree with the expressions they mirror", () => {
  const SRC_ROOT = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(SRC_ROOT, p), "utf8");

  /** [key, sourceFile, substring that must still be present, [env, expectedIsOn][]] */
  const MIRRORS: Array<[string, string, string, Array<[string | undefined, boolean]>]> = [
    ["NICK_COST_FIREWALL", "lib/ai/provider.ts", 'process.env.NICK_COST_FIREWALL !== "0"',
      [[undefined, true], ["0", false], ["1", true], ["yes", true]]],
    ["NICK_CALIBRATION_ENFORCER", "lib/ai/chat/calibration-enforcer.ts", 'process.env.NICK_CALIBRATION_ENFORCER !== "0"',
      [[undefined, true], ["0", false], ["1", true]]],
    ["NICK_JIT_SECTIONS", "lib/ai/vnext/jit-sections.ts", 'process.env.NICK_JIT_SECTIONS === "0"',
      [[undefined, true], ["0", false], ["1", true]]],
    ["NICK_FAILOVER_RESCUE", "lib/ai/provider.ts", 'process.env.NICK_FAILOVER_RESCUE === "1"',
      [[undefined, false], ["1", true], ["0", false]]],
    ["NICK_CANARY_DEEP_ANTHROPIC", "lib/ai/vnext/effort-policy.ts", 'process.env.NICK_CANARY_DEEP_ANTHROPIC === "1"',
      [[undefined, false], ["1", true], ["0", false]]],
    ["NICK_ESCALATION_DISABLED", "app/api/ai/chat/route.ts", 'process.env.NICK_ESCALATION_DISABLED !== "1"',
      // INVERTED NAME: isOn means "escalation is disabled".
      [[undefined, false], ["1", true], ["0", false]]],
    ["NICK_AGENT_FOLLOWUPS", "lib/agent/follow-up.ts", '.trim() === "1"',
      // The trim case is the divergence trimRawValue exists to close.
      [[undefined, false], ["1", true], [" 1 ", true], ["0", false]]],
  ];

  afterEach(() => {
    for (const [key] of MIRRORS) delete process.env[key];
  });

  it("positive control: every mirrored key is actually registered and readOnly", () => {
    for (const [key] of MIRRORS) {
      const spec = FLAG_REGISTRY.find((f) => f.key === key);
      expect(spec, `${key} is not in FLAG_REGISTRY`).toBeTruthy();
      expect(spec!.readOnly, `${key} must be readOnly — its runtime reads process.env directly`).toBe(true);
    }
  });

  it.each(MIRRORS)("%s · the source expression still reads as this entry claims", (key, file, needle) => {
    expect(read(file), `${key}: the mirrored expression changed in ${file} — re-derive the registry entry`).toContain(needle);
  });

  it.each(MIRRORS)("%s · board isOn matches the runtime truth table", (key, _file, _needle, table) => {
    for (const [envValue, expected] of table) {
      if (envValue === undefined) delete process.env[key];
      else process.env[key] = envValue;
      expect(getFlag(key)?.isOn, `${key}=${JSON.stringify(envValue)} — board disagrees with runtime`).toBe(expected);
    }
  });
});

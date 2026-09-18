/**
 * tests/repo/flag-board-visibility-ratchet.test.ts · 2026-09-18
 *
 * A switch read straight off `process.env` and never added to FLAG_REGISTRY is
 * INVISIBLE: it does not appear on the flag board, so nobody can see whether
 * it is on, and nothing can be given a shadow review before it flips.
 *
 * This is a repeat defect, not a hypothesis. CURRENT-TRUTH.md records the same
 * shape being fixed once already on 2026-08-19: "Both were LIVE-by-default via
 * raw `process.env.X !== '0'` reads in memory-manager.ts and appeared NOWHERE
 * on the flag board — the two most consequential memory switches were
 * invisible." Registering those two did not stop the next one:
 * NICK_MEMORY_SUPERSESSION was still a raw read at memory-manager.ts:461 when
 * this test was written, and the measurement below found NINE more.
 *
 * ★ Worth naming: NICK_FAILOVER_RESCUE is one of them, and CURRENT-TRUTH.md
 * says the operator ENABLED it in production on 2026-08-15. A live production
 * switch that the flag board cannot show is exactly the failure this guards.
 *
 * RATCHET, not a wall. Ten keys are unregistered today; failing on all of them
 * would make this red on arrival and get it routed around. It freezes the
 * known set and fails on anything NEW — the same shape as
 * `pnpm check:scripts` (`.scripts-tsc-baseline.json`) and the brain plan's
 * direct-writer ratchet. The list may only SHRINK: registering a key and
 * leaving it here also fails, so the baseline cannot rot into a permanent
 * excuse.
 *
 * Numeric tuning knobs (NICK_CALIBRATION_K, NICK_TOOL_BUDGET,
 * NICK_TOOL_TIMEOUT_MS, NICK_ESCALATION_DAILY_CAP) are in the baseline too.
 * They are values, not switches, and forcing them onto a board built for
 * on/off state would be worse than leaving them — but they still may not
 * multiply unnoticed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Unregistered as of 2026-09-18. May only shrink — see the header. */
const KNOWN_UNREGISTERED = [
  "NICK_AGENT_FOLLOWUPS",
  "NICK_CALIBRATION_ENFORCER",
  "NICK_CALIBRATION_K",
  "NICK_CANARY_DEEP_ANTHROPIC",
  "NICK_COST_FIREWALL",
  "NICK_ESCALATION_DAILY_CAP",
  "NICK_FAILOVER_RESCUE",
  "NICK_JIT_SECTIONS",
  "NICK_TOOL_BUDGET",
  "NICK_TOOL_TIMEOUT_MS",
].sort();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function rawEnvSwitches(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of walk(join(APP_ROOT, "lib"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env\.(NICK_[A-Z0-9_]+)/g)) {
      const rel = f.slice(APP_ROOT.length + 1).replace(/\\/g, "/");
      const list = found.get(m[1]) ?? [];
      if (!list.includes(rel)) list.push(rel);
      found.set(m[1], list);
    }
  }
  return found;
}

function registeredKeys(): Set<string> {
  const src = readFileSync(join(APP_ROOT, "lib/feature-flags.ts"), "utf8");
  return new Set([...src.matchAll(/key:\s*"(NICK_[A-Z0-9_]+)"/g)].map((m) => m[1]));
}

describe("flag board visibility · a switch nobody can see cannot be reviewed", () => {
  it("positive control: the scanner actually finds raw env reads and registry keys", () => {
    // A zero from either side would make every assertion below vacuously pass.
    const reads = rawEnvSwitches();
    expect(reads.size, "found no process.env.NICK_* reads — scanner is broken").toBeGreaterThan(5);
    expect(registeredKeys().size, "found no FLAG_REGISTRY keys — scanner is broken").toBeGreaterThan(10);
  });

  it("no NEW unregistered NICK_ switch (the ratchet)", () => {
    const registered = registeredKeys();
    const unregistered = [...rawEnvSwitches()]
      .filter(([k]) => !registered.has(k))
      .map(([k, files]) => `${k}  (${files.join(", ")})`)
      .sort();
    const newlyUnregistered = unregistered.filter(
      (line) => !KNOWN_UNREGISTERED.some((k) => line.startsWith(k + " ")),
    );
    expect(
      newlyUnregistered,
      "a new switch is read from process.env but missing from FLAG_REGISTRY — add it to lib/feature-flags.ts so the flag board can show it",
    ).toEqual([]);
  });

  it("the baseline may only SHRINK — a registered key must leave the list", () => {
    const registered = registeredKeys();
    const staleBaseline = KNOWN_UNREGISTERED.filter((k) => registered.has(k));
    expect(
      staleBaseline,
      "these are registered now; delete them from KNOWN_UNREGISTERED so the ratchet keeps tightening",
    ).toEqual([]);
  });

  it("NICK_MEMORY_SUPERSESSION specifically is on the board (2026-09-18 regression)", () => {
    // The switch this test was written for: Wave 2's supersession half cannot
    // be given its shadow week while it is invisible.
    expect(registeredKeys().has("NICK_MEMORY_SUPERSESSION")).toBe(true);
  });
});

/**
 * A score component that reads a key no engine returns is not wrong — it is
 * ABSENT, and it says so in a voice that sounds like data.
 *
 * `masterIntelligence` pulls every number out of its 28 engines through
 * `num(engineResult, ...keys)`, which returns **0** when it finds none of them.
 * Zero is a legitimate answer for most of these signals, so a misspelled key is
 * indistinguishable from a real measurement. Nothing throws, nothing logs, and
 * the Business Health Score reports with full confidence on inputs it never
 * read.
 *
 * FOUND BY SWEEPING, NOT BY READING
 * A per-call sweep found FIVE live broken calls. The audit that prompted this
 * had reported one:
 *
 *   num(bayUtil,    "utilizationPct", "averageUtilization")   -> avgOccupancyRate
 *   num(leadResp,   "avgResponseMinutes", "averageResponseMinutes") -> avgMinutes
 *   num(leadResp,   "averageMinutes", "avgResponseMinutes")   -> avgMinutes
 *   num(valueTrend, "trendPct", "growthPct")     -> computed from growing[]/shrinking[]
 *   num(reviewVel,  "weeklyRate")                -> thisMonth (the engine is monthly)
 *
 * A sixth candidate, num(capacity, "currentUtilization", "utilization"), was a
 * FALSE POSITIVE: it lives inside a comment explaining why that block was
 * already deleted. The first sweep did not strip comments and reported a bug
 * that does not exist — which is why this file strips them before parsing.
 *
 * The two worst were not score components but SUMMARY lines. reviewVel's dead
 * key made `rate === 0` permanently true, so "Zero new reviews this week —
 * reputation stalling" was pushed as a risk on every single run regardless of
 * actual reviews, and the good-news branch could never fire.
 *
 * `num()` is deliberately left returning 0. Making it throw would turn every
 * genuinely-absent engine result into a 500 on the master report; the fix for a
 * silent default is a test that catches the typo, not a louder runtime.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), ".");
const SERVICES = join(HERE, "services");

/**
 * COMMENTS STRIPPED FIRST. The file documents removed calls in prose — the
 * capacity block carries `num(capacity, "currentUtilization", "utilization")`
 * inside a comment explaining why it was deleted. An earlier version of this
 * sweep counted that as a live read and reported a broken call that does not
 * exist. A removed call documented in prose is the OPPOSITE of a bug.
 */
const MASTER_RAW = readFileSync(join(SERVICES, "masterIntelligence.ts"), "utf8");
const MASTER = MASTER_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every source an engine result can come from. Wider = fewer false alarms. */
const ENGINE_SOURCES = (() => {
  const dir = join(SERVICES, "engines");
  const parts = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(dir, f), "utf8"));
  for (const extra of ["intelligenceEngines.ts"]) {
    try { parts.push(readFileSync(join(SERVICES, extra), "utf8")); } catch { /* optional */ }
  }
  return parts.join("\n");
})();

interface Call { fn: string; engine: string; keys: string[] }

/** Every `num(x, "a", "b")` / `arr(x, "a")` call in the master report. */
const CALLS: Call[] = [...MASTER.matchAll(/\b(num|arr)\(\s*([A-Za-z_$][\w$]*)\s*,\s*([^)]+)\)/g)]
  .map((m) => ({
    fn: m[1],
    engine: m[2],
    keys: [...m[3].matchAll(/["']([A-Za-z_$][\w$]*)["']/g)].map((k) => k[1]),
  }))
  .filter((c) => c.keys.length > 0);

const label = (c: Call) => `${c.fn}(${c.engine}, ${c.keys.map((k) => `"${k}"`).join(", ")})`;

/**
 * Calls whose every key is absent, kept ONLY because no correct key exists.
 * Each needs a reason, and the list may only SHRINK — adding an entry means
 * shipping a score component that silently contributes nothing.
 */
const NO_CORRECT_KEY: Record<string, string> = {
  // EMPTY, and it should stay that way. Every live read now resolves against a
  // key its engine actually returns:
  //   leadResp   -> avgMinutes         (was three different invented spellings)
  //   bayUtil    -> avgOccupancyRate
  //   valueTrend -> computed from the growing[]/shrinking[] trends themselves
  //   reviewVel  -> thisMonth          (the engine is monthly; weeklyRate never existed)
  // An entry here means shipping a component that silently contributes nothing.
};

describe("the sweep can actually see what it claims to check", () => {
  it("found the master report and the engine sources", () => {
    expect(MASTER.length).toBeGreaterThan(10_000);
    expect(ENGINE_SOURCES.length).toBeGreaterThan(50_000);
  });

  it("a key that definitely exists is found (guards a vacuous pass)", () => {
    // If this were false, EVERY call would look broken — the exact false
    // result an earlier version of this sweep produced.
    expect(ENGINE_SOURCES.includes("highRisk")).toBe(true);
    expect(ENGINE_SOURCES.includes("avgMinutes")).toBe(true);
  });

  it("parsed a realistic number of engine reads", () => {
    expect(CALLS.length).toBeGreaterThan(20);
  });
});

describe("every score input reads a key some engine returns", () => {
  it("no call has ALL of its keys missing", () => {
    const broken = CALLS.filter((c) => c.keys.every((k) => !ENGINE_SOURCES.includes(k)))
      .map(label)
      .filter((l) => !(l in NO_CORRECT_KEY));

    expect(
      broken,
      "These read key names no engine returns. num() answers 0 for a missing key, " +
      "so the component contributes nothing while reporting like real data — and " +
      "nothing throws or logs. Fix the key, or document it in NO_CORRECT_KEY with " +
      "the reason no correct key exists.",
    ).toEqual([]);
  });

  it("the three renamed reads now resolve", () => {
    // The regressions this file was written for.
    const byLabel = new Map(CALLS.map((c) => [label(c), c]));
    expect([...byLabel.keys()].some((l) => l.includes('num(leadResp, "avgMinutes")'))).toBe(true);
    expect([...byLabel.keys()].some((l) => l.includes('num(bayUtil, "avgOccupancyRate")'))).toBe(true);
    for (const k of ["avgMinutes", "avgOccupancyRate"]) {
      expect(ENGINE_SOURCES.includes(k), `${k} must exist on an engine`).toBe(true);
    }
  });

  it("the dead spellings are gone entirely", () => {
    for (const dead of ["avgResponseMinutes", "averageResponseMinutes", "averageMinutes", "utilizationPct", "averageUtilization"]) {
      expect(CALLS.some((c) => c.keys.includes(dead)), `${dead} is still read somewhere`).toBe(false);
    }
  });
});

describe("the documented exceptions stay honest", () => {
  it("every entry still corresponds to a real all-keys-missing call", () => {
    const brokenNow = new Set(
      CALLS.filter((c) => c.keys.every((k) => !ENGINE_SOURCES.includes(k))).map(label),
    );
    const stale = Object.keys(NO_CORRECT_KEY).filter((l) => !brokenNow.has(l));
    expect(stale, `no longer broken — remove from NO_CORRECT_KEY: ${stale.join(" | ")}`).toEqual([]);
  });

  it("every exception carries a real reason", () => {
    for (const [k, why] of Object.entries(NO_CORRECT_KEY)) {
      expect(why.length, `${k} needs a real reason`).toBeGreaterThan(80);
    }
  });
});

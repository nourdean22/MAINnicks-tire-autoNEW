/**
 * The 11am rhythm is reachable, and stays reachable through DST.
 *
 * WHAT THIS WIRES. `executeRhythm` is a complete operator-facing feature that
 * HAD NEVER RUN. Every mention of the name in the repo was inside its own file
 * — twelve `logError` context strings plus the export. Zero callers, ever. The
 * flag gating it, `autopilot_flags.adhd_operating_rhythm`, reads TRUE in prod:
 * the operator turned it on and nothing ever asked.
 *
 * THE DST TRAP THIS PINS. `getCurrentSlot()` gates on the ET hour (11 ->
 * "mid_morning"). A single fixed UTC cron cannot hold 11am ET across the year:
 * `0 15` is 11am EDT in summer and 10am EST in winter, at which point the gate
 * returns null and the feature silently retires itself every November. That is
 * the exact frame-drift class the clock work removed everywhere else, and it
 * would have been reintroduced by the obvious one-line schedule.
 *
 * So the trigger fires at BOTH candidate hours and the ET-anchored gate picks
 * the real one. Someone "tidying" that to a single hour is the regression this
 * file exists to catch — nothing else in the repo can see it, because a cron
 * that fires at the wrong hour still fires.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FN = () => readFileSync("lib/inngest/functions/operating-rhythm.ts", "utf8");
const INDEX = () => readFileSync("lib/inngest/functions/index.ts", "utf8");
const MANIFEST = () => readFileSync("config/crons.ts", "utf8");

describe("operating-rhythm · reachable, and DST-proof", () => {
  it("the trigger covers BOTH DST candidates for 11am ET", () => {
    // 15:00 UTC is 11am EDT; 16:00 UTC is 11am EST. One of them is always the
    // real 11am, and getCurrentSlot() discards the other.
    const src = FN();
    expect(src).toMatch(/cron:\s*"0 15,16 \* \* \*"/);
  });

  it("REGRESSION GUARD: a single-hour schedule is the silent-November bug", () => {
    // The obvious "simplification". It works for eight months and then stops,
    // with no error anywhere — the cron fires, the gate says "not a slot hour",
    // and the feature is gone until someone notices the messages stopped.
    const src = FN();
    expect(src, "0 15 alone dies in EST").not.toMatch(/cron:\s*"0 15 \* \* \*"/);
    expect(src, "0 16 alone dies in EDT").not.toMatch(/cron:\s*"0 16 \* \* \*"/);
  });

  it("no explicit slot is passed — the ET gate IS the feature", () => {
    // executeRhythm("mid_morning") would bypass getCurrentSlot and send a
    // message headed "11:00 AM" at whatever hour the trigger fired.
    const code = FN()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/executeRhythm\(\)/);
    expect(code).not.toMatch(/executeRhythm\(\s*["']/);
  });

  it("it is SERVED, not merely written — index.ts is what /api/inngest spreads", () => {
    // app/api/inngest/route.ts does `functions: Object.values(functions)` over
    // this index. A function absent from it is registered nowhere and runs
    // never — the built-tested-unwired shape this whole change is undoing.
    expect(INDEX()).toContain("operatingRhythm");
    expect(INDEX()).toContain("./operating-rhythm");
  });

  it("the inngest id EQUALS the manifest name — check:crons enforces both ways", () => {
    // Mismatched, the gate reports the function as unregistered AND the manifest
    // entry as having no function. It caught exactly that on the first run here.
    const id = /id:\s*"([a-z0-9-]+)"/.exec(FN())?.[1];
    expect(id).toBe("operating-rhythm");
    expect(MANIFEST()).toContain('name: "operating-rhythm"');
  });

  it("the manifest marks it inngest-native and active", () => {
    const block = /\{[^{}]*name: "operating-rhythm"[\s\S]*?\},/.exec(MANIFEST())?.[0] ?? "";
    expect(block, "must be found").not.toBe("");
    expect(block).toMatch(/inngest:\s*true/);
    expect(block).toMatch(/mode:\s*"active"/);
    expect(block, "an inngest-native entry must not also claim a route path").not.toMatch(/path:/);
  });
});

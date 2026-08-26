/**
 * The automation engine is armed, and the things that made arming unsafe are gone.
 *
 * It had never run. Arming it before 2026-08-26 would have fired zero useful
 * actions while reading as done — the executor threw on every action, two device
 * rules could never match, one trigger type fell through the switch unlogged,
 * and a standing condition would have alerted hourly forever.
 *
 * This file pins the arming decision, not just the code: hourly evaluation, a
 * served function, and an id the manifest agrees with.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FN = () => readFileSync("lib/inngest/functions/automation-engine.ts", "utf8");
const INDEX = () => readFileSync("lib/inngest/functions/index.ts", "utf8");
const MANIFEST = () => readFileSync("config/crons.ts", "utf8");

describe("automation-engine · armed hourly, and reachable", () => {
  it("evaluates HOURLY, so DST needs no special handling", () => {
    // Every trigger is compared in ET inside the engine. The dispatcher only has
    // to guarantee it LOOKS each hour — which is why this needs no two-candidate
    // schedule, unlike the 11am rhythm pinned to a specific ET hour.
    expect(FN()).toMatch(/cron:\s*"0 \* \* \* \*"/);
  });

  it("it is SERVED — index.ts is what /api/inngest spreads", () => {
    // app/api/inngest/route.ts does Object.values(functions) over this index. A
    // function missing from it runs never, which is the state this whole change
    // is undoing.
    expect(INDEX()).toContain("automationEngineTick");
    expect(INDEX()).toContain("./automation-engine");
  });

  it("the inngest id EQUALS the manifest name — check:crons enforces both ways", () => {
    const id = /id:\s*"([a-z0-9-]+)"/.exec(FN())?.[1];
    expect(id).toBe("automation-engine");
    expect(MANIFEST()).toContain('name: "automation-engine"');
  });

  it("the manifest marks it inngest-native and active, with no route path", () => {
    const block = /\{[^{}]*name: "automation-engine"[\s\S]*?\},/.exec(MANIFEST())?.[0] ?? "";
    expect(block).not.toBe("");
    expect(block).toMatch(/inngest:\s*true/);
    expect(block).toMatch(/mode:\s*"active"/);
    expect(block).not.toMatch(/path:/);
  });

  it("it calls run(), not evaluate() — arming means executing", () => {
    const code = FN()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/automationEngine\.run\(\)/);
  });

  it("every tick is logged, including the empty one", () => {
    // Once fingerprints settle, "nothing fired" is the common and CORRECT
    // outcome. Silence in the log would be indistinguishable from a function
    // that never ran — the exact condition this engine sat in for its whole life.
    const code = FN().replace(/\/\*[\s\S]*?\*\//g, "");
    const at = code.indexOf("log.info");
    const guarded = code.slice(Math.max(0, at - 160), at);
    expect(at, "must log").toBeGreaterThan(-1);
    expect(guarded, "must not be inside an if").not.toMatch(/if\s*\([^)]*\)\s*\{?\s*$/);
  });
});

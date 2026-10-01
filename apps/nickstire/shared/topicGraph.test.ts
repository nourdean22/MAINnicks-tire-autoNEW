/**
 * Topic graph — the assertions that matter are about PATHS and CLAIMS.
 *
 * A graph node pointing at a path the site 301s would feed an internal-link
 * recommender a redirect for months while every unit test stayed green, so
 * every path is checked against the registry AND the redirect table.
 *
 * Positive control (recorded before shipping): with `service("brakes", …,
 * "/brake-repair-cleveland")` (a 301 alias) the registry test fails with
 * `expected false to be true` naming that path; with a symptom key removed from
 * TOPIC_NODES the pattern-bank test fails naming the orphaned key.
 */
import { describe, expect, it } from "vitest";
import { ALL_ROUTES } from "./routes";
import { isRedirectedPath } from "../server/_core/redirects";
import {
  TOPIC_NODES,
  TOPIC_EDGES,
  SYMPTOM_PATTERNS,
  neighbors,
  routesForSymptom,
  symptomForPhrase,
} from "./topicGraph";

const REGISTRY = new Set(ALL_ROUTES.map((r) => r.path));
const SERVICE_GROUP = new Set(ALL_ROUTES.filter((r) => r.group === "service").map((r) => r.path));
const IDS = new Set(TOPIC_NODES.map((n) => n.id));

describe("topic graph — every path is a live registry route", () => {
  it("every node path exists in ALL_ROUTES and is not a 301 alias", () => {
    for (const n of TOPIC_NODES) {
      if (!n.path) continue;
      expect(REGISTRY.has(n.path), `${n.id} → ${n.path} is not in shared/routes.ts`).toBe(true);
      expect(isRedirectedPath(n.path), `${n.id} → ${n.path} is a redirect alias`).toBe(false);
    }
  });

  it("every service node carries a path from the service group", () => {
    const services = TOPIC_NODES.filter((n) => n.kind === "service");
    expect(services.length).toBeGreaterThanOrEqual(15);
    for (const s of services) {
      expect(s.path, `${s.id} has no path`).toBeTruthy();
      expect(SERVICE_GROUP.has(s.path!), `${s.id} → ${s.path} is not group:"service"`).toBe(true);
    }
  });

  it("node ids are unique and seeded at the planned size", () => {
    expect(IDS.size).toBe(TOPIC_NODES.length);
    expect(TOPIC_NODES.length).toBeGreaterThanOrEqual(40);
    expect(TOPIC_EDGES.length).toBeGreaterThanOrEqual(80);
  });

  it("every edge joins two known nodes, carries a why, and is not a self-loop", () => {
    for (const e of TOPIC_EDGES) {
      expect(IDS.has(e.from), `unknown edge source ${e.from}`).toBe(true);
      expect(IDS.has(e.to), `unknown edge target ${e.to}`).toBe(true);
      expect(e.from).not.toBe(e.to);
      expect(e.why.trim().length, `${e.from} → ${e.to} has no why`).toBeGreaterThan(3);
    }
  });

  it("every pattern-bank symptom is a symptom node, and every symptom node reaches a route", () => {
    for (const p of SYMPTOM_PATTERNS) {
      expect(IDS.has(`symptom:${p.symptom}`), `pattern maps to unknown symptom ${p.symptom}`).toBe(true);
      expect(p.re.flags.includes("g"), `${p.symptom} pattern must not carry the g flag`).toBe(false);
    }
    for (const n of TOPIC_NODES.filter((x) => x.kind === "symptom")) {
      expect(routesForSymptom(n.id).length, `${n.id} resolves to no route`).toBeGreaterThan(0);
    }
  });
});

describe("neighbors / routesForSymptom", () => {
  it("steering shake fans out to balance, bent wheel, alignment, suspension and brakes", () => {
    const parts = neighbors("symptom:steering_shake", ["part"]).map((n) => n.id);
    expect(parts).toEqual(expect.arrayContaining(["part:tire_balance", "part:bent_wheel", "part:tie_rod", "part:rotors"]));
    expect(neighbors("symptom:steering_shake", ["service"]).map((n) => n.path)).toContain("/alignment");
  });

  it("neighbors is undirected and filters by kind", () => {
    expect(neighbors("part:brake_lines").map((n) => n.id)).toContain("cleveland:road_salt");
    expect(neighbors("part:brake_lines", ["service"]).every((n) => n.kind === "service")).toBe(true);
  });

  it("routesForSymptom returns the problem page first, then registry service routes only", () => {
    const routes = routesForSymptom("steering_shake");
    expect(routes[0]).toBe("/steering-wheel-shaking");
    expect(routes).toEqual(expect.arrayContaining(["/tires", "/alignment", "/brakes"]));
    for (const r of routes) {
      expect(REGISTRY.has(r)).toBe(true);
      expect(isRedirectedPath(r)).toBe(false);
    }
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("accepts the prefixed id too, and an unknown key yields nothing", () => {
    expect(routesForSymptom("symptom:wont_start")).toEqual(routesForSymptom("wont_start"));
    expect(routesForSymptom("wont_start")).toEqual(expect.arrayContaining(["/car-wont-start", "/battery", "/starter-alternator"]));
    expect(routesForSymptom("no_such_symptom")).toEqual([]);
  });
});

describe("symptomForPhrase — first claim wins, boundaries hold", () => {
  it.each([
    ["my steering wheel shakes at 60", "steering_shake"],
    ["it shakes when I brake", "brake_shake"],
    ["grinding noise when braking", "grinding"],
    ["check engine light flashing", "check_engine_flashing"],
    ["check engine light came on", "check_engine_on"],
    ["won't start but lights work", "wont_start"],
    ["should I plug or patch it", "flat_puncture"],
    ["need all four tires", "needs_tires"],
    ["tire pressure light on", "tpms_light"],
    ["pulls to the right", "pulls_one_side"],
    ["car is overheating", "overheating"],
    ["failed e-check", "echeck_not_ready"],
    ["my car shakes when driving", "shaking_driving"],
  ])("%s → %s", (phrase, symptom) => {
    expect(symptomForPhrase(phrase)).toBe(symptom);
  });

  it("does not read 'the check engine light' as an E-Check, nor 'install' as a stall", () => {
    // Regression for the unbounded `e check` and `stall` patterns.
    expect(symptomForPhrase("the check engine light is on")).toBe("check_engine_on");
    expect(symptomForPhrase("can you install new tires")).not.toBe("rough_running");
    expect(symptomForPhrase("not ready to buy yet")).toBeNull();
  });

  it("returns null for text the bank has no claim on", () => {
    expect(symptomForPhrase("what time do you close on Sunday")).toBeNull();
    expect(symptomForPhrase("")).toBeNull();
  });
});

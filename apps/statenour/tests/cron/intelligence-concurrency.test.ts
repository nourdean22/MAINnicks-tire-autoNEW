import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the fix for the uncapped engine fan-out in
 * /api/cron/intelligence (P2 cron-reliability audit).
 *
 * This route runs as a CHILD of the evening mega fan-out, which throttles
 * children to 6 concurrent (withConcurrency(jobs, dispatch, 6)) precisely
 * to protect the shared AI provider. Running its own 6 engines via an
 * uncapped Promise.all defeated that protection — one child could open 6
 * simultaneous provider calls. The engines MUST run through
 * withConcurrency with a small cap (2).
 */

const CAP = 2;
let active = 0;
let peak = 0;

// Each engine bumps a shared active-count on entry and yields a tick so
// the scheduler can start more workers, then decrements on exit. If the
// route used an uncapped Promise.all, peak would reach 6.
function makeEngine() {
  return vi.fn(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { ok: true };
  });
}

const engines = {
  runPeopleIntelligence: makeEngine(),
  analyzeDecisionPatterns: makeEngine(),
  analyzeTimePatterns: makeEngine(),
  analyzeEmotionalArc: makeEngine(),
  measureLearningVelocity: makeEngine(),
  assessStrategicPlans: makeEngine(),
};

vi.mock("@/lib/brain/people-intelligence", () => ({
  runPeopleIntelligence: engines.runPeopleIntelligence,
}));
vi.mock("@/lib/brain/decision-patterns", () => ({
  analyzeDecisionPatterns: engines.analyzeDecisionPatterns,
}));
vi.mock("@/lib/brain/time-intelligence", () => ({
  analyzeTimePatterns: engines.analyzeTimePatterns,
}));
vi.mock("@/lib/brain/emotional-arc", () => ({
  analyzeEmotionalArc: engines.analyzeEmotionalArc,
}));
vi.mock("@/lib/brain/learning-velocity", () => ({
  measureLearningVelocity: engines.measureLearningVelocity,
}));
vi.mock("@/lib/brain/strategic-plans", () => ({
  assessStrategicPlans: engines.assessStrategicPlans,
}));

import { GET } from "@/app/api/cron/intelligence/route";

const SECRET = "test-secret";

beforeEach(() => {
  vi.clearAllMocks();
  active = 0;
  peak = 0;
  process.env.CRON_SECRET = SECRET;
});

function authedReq() {
  return new NextRequestLike();
}

// Minimal stand-in that satisfies the route's `req.headers.get(...)` use.
class NextRequestLike {
  headers = new Headers({ authorization: `Bearer ${SECRET}` });
}

const invoke = () =>
  (GET as unknown as (r: unknown) => Promise<Response>)(authedReq());

describe("cron/intelligence · capped engine concurrency", () => {
  it("never runs more than the cap engines concurrently", async () => {
    const res = await invoke();
    expect(res.status).toBe(200);
    // All six engines ran…
    for (const fn of Object.values(engines)) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    // …but never more than CAP at once (uncapped Promise.all → peak 6).
    expect(peak).toBeLessThanOrEqual(CAP);
    expect(peak).toBeGreaterThan(1); // proves it isn't fully serialized
  });

  it("rejects an unauthorized request without running engines", async () => {
    const res = await (GET as unknown as (r: unknown) => Promise<Response>)({
      headers: new Headers({ authorization: "Bearer wrong" }),
    });
    expect(res.status).toBe(401);
    for (const fn of Object.values(engines)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

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

// 2026-08-19 · the route converted from a bare GET (hand-rolled Bearer
// compare, no cron_job_logs row ever) to cronHandler. Mock the log/actor
// plumbing the wrapper pulls in so the test still exercises only the
// engine fan-out, and use a REAL Request — apiHandler parses req.url.
vi.mock("@/lib/services/cron-manager", () => ({
  logCronRun: vi.fn(async (_job: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      return { success: true, result, durationMs: 1 };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: 1,
      };
    }
  }),
}));
vi.mock("@/lib/services/cron-control", () => ({
  isCronEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/automation/policy", () => ({
  logPolicyFire: vi.fn(async () => undefined),
}));
// The suite-wide setup (tests/setup/auth-guard-mock.ts) no-ops
// requireCronAuth, which would turn the unauthorized-request test into a
// vacuous 200. Override it here with a real Bearer check so the 401 path
// is still exercised through the wrapper.
vi.mock("@/lib/auth-guard", async () => {
  const { ServiceError } = await import("@/lib/utils/service-error");
  return {
    requireCronAuth: vi.fn((req: Request) => {
      // literal, not `SECRET` — the factory runs while the route module
      // imports, before this file's module-body consts initialize (TDZ)
      if (req.headers.get("authorization") !== "Bearer test-secret") {
        throw new ServiceError("Unauthorized", 401);
      }
    }),
    requireSyncAuth: vi.fn(),
    requireSession: vi.fn().mockResolvedValue({ id: "operator-1" }),
  };
});

import { GET } from "@/app/api/cron/intelligence/route";

const SECRET = "test-secret";

beforeEach(() => {
  vi.clearAllMocks();
  active = 0;
  peak = 0;
  process.env.CRON_SECRET = SECRET;
});

function authedReq(token = SECRET) {
  return new Request("http://localhost/api/cron/intelligence", {
    headers: { authorization: `Bearer ${token}` },
  });
}

const invoke = () =>
  (GET as unknown as (r: unknown, ctx?: unknown) => Promise<Response>)(authedReq());

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
    const res = await (GET as unknown as (r: unknown, ctx?: unknown) => Promise<Response>)(
      authedReq("wrong"),
    );
    expect(res.status).toBe(401);
    for (const fn of Object.values(engines)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

/**
 * Reply Planner + Playbooks tests (ROS-058 arc).
 *
 * The planner is pure, so these tests are the playbook spec: what facts each
 * intent may use, which single question gets asked, and which promised claims
 * force a draft back to the operator.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import {
  buildReplyPlan,
  planViolations,
  renderPlanPrompt,
  type PlannerContext,
} from "./services/smsReplyPlanner";

const emptyCtx: PlannerContext = {
  customerFirstName: null,
  customerVehicle: null,
  activeBooking: null,
  activeEstimate: null,
  lastVapiSummary: null,
};
const noRoute = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };

function planFor(body: string, ctx: PlannerContext = emptyCtx, route = noRoute) {
  return buildReplyPlan(routeInboundSms(body, route), ctx, body);
}

describe("tire inventory playbook", () => {
  it("without a size: asks exactly one question, never claims stock", () => {
    const plan = planFor("do you have used tires in stock?");
    expect(plan.requiredQuestion).toMatch(/sidewall|225\/50R17/);
    expect(plan.missingInformation).toContain("tire size from the sidewall");
    expect(plan.prohibited.map((p) => p.label)).toContain("inventory_claim");
  });

  it("with a size provided: does NOT re-ask for it", () => {
    const plan = planFor("do you have a 225/50R17 in stock?");
    expect(plan.requiredQuestion).toBeNull();
    expect(plan.missingInformation).toHaveLength(0);
    expect(plan.knownFacts.join(" ")).toContain("225/50R17");
  });
});

describe("job status playbook", () => {
  it("with a verified stage: that stage is the only status fact", () => {
    const ctx: PlannerContext = { ...emptyCtx, activeBooking: { service: "Brakes", stage: "in_progress" } };
    const plan = planFor("what time will my car be done?", ctx, { ...noRoute, hasActiveBooking: true });
    expect(plan.knownFacts.join(" ")).toContain('"in_progress"');
    expect(plan.prohibited.map((p) => p.label)).toContain("completion_time_promise");
  });

  it("without verified status: the plan says do not guess", () => {
    const plan = planFor("is my car ready?");
    expect(plan.knownFacts.join(" ")).toMatch(/do not guess/i);
  });
});

describe("complaint and safety playbooks stay conservative", () => {
  it("comeback: no outcome promises, no callbacks, acknowledge + handoff", () => {
    const plan = planFor("brakes still grind after the repair");
    expect(plan.goal).toBe("acknowledge_and_handoff");
    const labels = plan.prohibited.map((p) => p.label);
    expect(labels).toContain("complaint_outcome_promise");
    expect(labels).toContain("callback_promise");
  });

  it("safety: triage goal, stop-driving fact, no completion promises", () => {
    const plan = planFor("the car is overheating with steam coming out");
    expect(plan.goal).toBe("safety_triage");
    expect(plan.knownFacts.join(" ")).toMatch(/stop driving/i);
  });
});

describe("multi-intent plans merge playbooks", () => {
  it("'225/50R17 and can I come today' carries tire facts AND the FCFS visit fact", () => {
    const plan = planFor("do you have a 225/50R17 used tire and can I come today?");
    const facts = plan.knownFacts.join(" ");
    expect(facts).toContain("225/50R17");
    expect(facts).toMatch(/first come, first served/);
    expect(plan.prohibited.map((p) => p.label)).toContain("inventory_claim");
  });
});

describe("every plan forbids FCFS-dishonest and unsafe claims globally", () => {
  it("even a plain financing plan forbids reserved-appointment and drive-safe claims", () => {
    const labels = planFor("do you do financing?").prohibited.map((p) => p.label);
    expect(labels).toContain("reserved_appointment_claim");
    expect(labels).toContain("drive_safe_assurance");
  });
});

describe("planViolations — the executable invariants", () => {
  const inventoryPlan = planFor("do you have tires in stock?");

  it("a stock claim trips the violation", () => {
    expect(planViolations(inventoryPlan, "Yes, we have it in stock — come get it!")).toContain("inventory_claim");
  });

  it("a hold promise trips the violation", () => {
    expect(planViolations(inventoryPlan, "We'll hold it for you until the tow arrives.")).toContain("hold_promise");
  });

  it("honest collect-the-size copy passes clean", () => {
    expect(
      planViolations(inventoryPlan, "Send the tire size from the sidewall, like 225/50R17, and we'll check what's in stock when you come by."),
    ).toHaveLength(0);
  });

  it("a completion-time promise on a status plan trips", () => {
    const statusPlan = planFor("is my car ready?");
    expect(planViolations(statusPlan, "It should be ready by 3pm today!")).toContain("completion_time_promise");
  });

  it("a reserved-appointment claim trips on ANY plan", () => {
    expect(planViolations(planFor("do you do financing?"), "Your appointment is confirmed for 2pm.")).toContain("reserved_appointment_claim");
  });
});

describe("the prompt block and the wiring", () => {
  it("renderPlanPrompt carries goal, facts, the single question and the NEVER list", () => {
    const p = renderPlanPrompt(planFor("do you have used tires in stock?"));
    expect(p).toContain("[REPLY PLAN");
    expect(p).toMatch(/GOAL: collect information/);
    expect(p).toMatch(/ASK EXACTLY ONE QUESTION/);
    expect(p).toMatch(/NEVER: .*inventory claim/);
  });

  it("the drafter injects the plan block when a plan is provided", () => {
    const s = readFileSync(resolve(process.cwd(), "server/services/nickgpt-client.ts"), "utf8");
    expect(s).toMatch(/renderPlanPrompt\(opts\.plan\)/);
  });

  it("the orchestrator builds the plan, passes it, and enforces violations", () => {
    const s = readFileSync(resolve(process.cwd(), "server/services/smsOrchestrator.ts"), "utf8");
    expect(s).toMatch(/buildReplyPlan\(routerDecision/);
    expect(s).toMatch(/plan: replyPlan/);
    expect(s).toMatch(/planViolations\(replyPlan, body\)/);
    expect(s).toMatch(/plan_violation:/);
  });
});

/**
 * The admin drafting path must run the same prohibition check as the AI path.
 *
 * THE BYPASS
 * `smsConversations.suggestDraft` classified intent with a DIFFERENT classifier,
 * called `draftSmsReply`, persisted the text and returned it. The file did not
 * import `smsReplyPlanner` at all — no `routeInboundSms`, no `buildReplyPlan`,
 * no `planViolations`. Meanwhile the inbound orchestrator has run all three
 * since ROS-058.
 *
 * So the shop had two drafting paths and only one could notice a draft that
 * promised stock, a hold, a completion time, a callback, a reserved appointment
 * or "safe to drive". `send` then called `sendSms` directly with no check
 * either.
 *
 * WHY THIS REPORTS RATHER THAN BLOCKS
 * The operator is the gate on this path — unlike the catalog auto-send (#1118),
 * a human reads the draft before it goes. But a gate cannot judge what it is
 * never shown, and an AI draft that reads perfectly well is exactly the one
 * that gets sent. So violations are computed, logged and returned.
 *
 * These tests exercise the planner pair directly with the shapes `suggestDraft`
 * feeds it, rather than booting tRPC — the endpoint's own wiring is asserted by
 * the source checks at the bottom, which is what stops the two from drifting.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import { buildReplyPlan, planViolations } from "./services/smsReplyPlanner";

/** Exactly the context `suggestDraft` builds. */
const check = (inbound: string, draft: string, activeBooking = false) => {
  const decision = routeInboundSms(inbound, {
    hasActiveBooking: activeBooking,
    hasActiveEstimate: false,
    hasActiveLead: false,
  });
  const plan = buildReplyPlan(decision, {
    customerFirstName: null,
    customerVehicle: null,
    activeBooking: activeBooking ? { service: "brakes", stage: "in_progress" } : null,
    activeEstimate: null,
    lastVapiSummary: null,
  }, inbound);
  return { intent: plan.intent, violations: planViolations(plan, draft) };
};

describe("admin drafts are now checked against the same prohibitions", () => {
  it("catches a drive-safe assurance (GLOBAL — applies to every plan)", () => {
    const { violations } = check(
      "my brakes are squeaking, can I still drive it?",
      "Yeah that's usually just the pads — you're safe to drive it until you can come by.",
    );
    expect(violations).toContain("drive_safe_assurance");
  });

  it("catches a reserved-appointment claim (GLOBAL)", () => {
    const { violations } = check(
      "can I come in tomorrow at 9",
      "Your appointment is confirmed for 9am — see you then!",
    );
    expect(violations).toContain("reserved_appointment_claim");
  });

  it("catches an inventory claim on a tire question", () => {
    const { violations } = check(
      "do you have 225/50R17 in stock",
      "Yes we have it in stock — come grab it today.",
    );
    expect(violations).toContain("inventory_claim");
  });

  it("catches a hold promise", () => {
    const { violations } = check(
      "can you hold a 225/50R17 for me",
      "Sure, we'll hold it for you until tomorrow.",
    );
    expect(violations).toContain("hold_promise");
  });

  it("catches a completion-time promise on an active job", () => {
    const { violations } = check("what time will my car be done?", "It'll be ready by 3pm today.", true);
    expect(violations).toContain("completion_time_promise");
  });

  it("passes an honest draft — this must not fire on good copy", () => {
    const { violations } = check(
      "how much for used tires",
      "Used tires start at sixty dollars installed — mount, balance, valve stems and an alignment check. Pull up and we'll check your size.",
    );
    expect(violations).toEqual([]);
  });

  it("passes an honest answer to the drive-safe question", () => {
    const { violations } = check(
      "my brakes are squeaking, can I still drive it?",
      "Squeaking is often still just the pads. We'd want to look before saying either way — free check, price in writing first.",
    );
    expect(violations).toEqual([]);
  });
});

describe("the endpoint actually wires this in", () => {
  // The tests above prove the CHECK works. These prove `suggestDraft` calls it —
  // a green unit test beside an unwired endpoint is the bypass all over again.
  const src = () =>
    import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("./routers/smsConversations.ts", import.meta.url), "utf8"));

  it("imports the planner it previously did not", async () => {
    const s = await src();
    expect(s).toMatch(/from "\.\.\/services\/smsIntentRouter"/);
    expect(s).toMatch(/buildReplyPlan, planViolations/);
  });

  it("calls planViolations against the generated draft", async () => {
    const s = await src();
    expect(s).toMatch(/planViolations\(plan, draftResult\.draft\)/);
  });

  it("returns the violations so an operator can actually see them", async () => {
    const s = await src();
    // Not just computed and discarded — the whole point is surfacing them.
    expect(s).toMatch(/\n\s*violations,/);
  });

  it("does not BLOCK — the operator remains the decision-maker here", async () => {
    const s = await src();
    // A throw on violations would silently break the admin console; the design
    // is advisory. Pinning it prevents a well-meaning "make it strict" change
    // from taking the tool away mid-conversation.
    expect(s).not.toMatch(/violations\.length[^)]*\)\s*\{\s*throw/);
  });
});

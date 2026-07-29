/**
 * Autonomy ladder registry invariants (2026-07-29).
 *
 * The registry is executable policy (voice-kernel doctrine): these tests are
 * what make its declarations binding instead of decorative.
 */
import { describe, it, expect } from "vitest";
import {
  SMS_AUTOMATION_REGISTRY,
  getAutomationPolicy,
  isRolloutModeAllowed,
  maxRolloutModeForLevel,
  summarizeAutonomy,
} from "./services/smsAutonomy";

// The orchestrator's full event-type vocabulary (smsOrchestrator.ts union).
// If an event type is added there without a registry entry, THIS list is the
// tripwire to update — parity keeps `isRolloutModeAllowed`'s unknown-key
// passthrough from silently widening.
const ORCHESTRATOR_EVENT_TYPES = [
  "inbound_sms",
  "vapi_confirmation",
  "vapi_forwarded_call_followup",
  "after_hours_capture",
  "stale_lead_followup",
  "abandoned_form_recovery",
  "booking_reminder",
  "review_request",
  "manual_admin_reply",
  "photo_assess_reply",
];

describe("registry shape", () => {
  it("every entry has a valid level, class, and non-empty policy fields", () => {
    for (const p of SMS_AUTOMATION_REGISTRY) {
      expect([0, 1, 2, 3, 4]).toContain(p.level);
      expect(["customer_marketing", "customer_followup", "customer_confirmation", "internal"]).toContain(p.sendClass);
      expect(p.evidenceRequirement.length).toBeGreaterThan(10);
      expect(p.caps.length).toBeGreaterThan(3);
      expect(p.fallback.length).toBeGreaterThan(3);
    }
  });

  it("keys are unique", () => {
    const keys = SMS_AUTOMATION_REGISTRY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every orchestrator event type has a registry entry (parity)", () => {
    for (const t of ORCHESTRATOR_EVENT_TYPES) {
      expect(getAutomationPolicy(t), `missing registry entry for orchestrator event '${t}'`).toBeDefined();
    }
  });

  it("every customer-classed automation rides the fail-closed opt-out index", () => {
    for (const p of SMS_AUTOMATION_REGISTRY) {
      if (p.sendClass !== "internal") {
        expect(p.optOutBehavior, p.key).toBe("fail_closed_index");
      }
    }
  });

  it("level 4 (campaigns) always requires explicit arming", () => {
    for (const p of SMS_AUTOMATION_REGISTRY) {
      if (p.level === 4) {
        expect(p.armedBy, `${p.key} is level 4 but declares no arming mechanism`).toBeTruthy();
      }
    }
  });

  it("only inbound_sms holds auto-reply (level 2) — initiating automations are 3+, drafters ≤1", () => {
    const inbound = getAutomationPolicy("inbound_sms");
    expect(inbound?.level).toBe(2);
    // no OTHER automation sits at level 2 — the level is specifically
    // "reply to the customer's own text"
    const level2 = SMS_AUTOMATION_REGISTRY.filter((p) => p.level === 2);
    expect(level2.map((p) => p.key)).toEqual(["inbound_sms"]);
  });
});

describe("rollout-mode ceiling", () => {
  it("maps levels to ceilings", () => {
    expect(maxRolloutModeForLevel(0)).toBe("shadow");
    expect(maxRolloutModeForLevel(1)).toBe("draft_only");
    expect(maxRolloutModeForLevel(2)).toBe("live_send");
  });

  it("blocks flipping a draft-only automation to live_send", () => {
    // photo_assess_reply is declared level 1 — live_send exceeds it
    expect(isRolloutModeAllowed("photo_assess_reply", "live_send")).toBe(false);
    expect(isRolloutModeAllowed("photo_assess_reply", "draft_only")).toBe(true);
  });

  it("allows live_send for declared auto-reply / follow-up automations", () => {
    expect(isRolloutModeAllowed("inbound_sms", "live_send")).toBe(true);
    expect(isRolloutModeAllowed("booking_reminder", "live_send")).toBe(true);
  });

  it("unknown keys keep legacy behavior (parity test above is the completeness guard)", () => {
    expect(isRolloutModeAllowed("some_future_event", "live_send")).toBe(true);
  });
});

describe("ops summary", () => {
  it("summarizes every automation with level + arming", () => {
    const s = summarizeAutonomy();
    expect(s.length).toBe(SMS_AUTOMATION_REGISTRY.length);
    for (const row of s) {
      expect(typeof row.key).toBe("string");
      expect([0, 1, 2, 3, 4]).toContain(row.level);
    }
  });
});

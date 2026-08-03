import { describe, it, expect } from "vitest";
import {
  isCustomerFacingFlag,
  isInvertedFlag,
  requiresConfirmation,
  confirmationCopy,
  INVERTED_FLAGS,
} from "./flagPolicy";
import { FLAG_DEFINITIONS } from "../server/services/featureFlags";

describe("flagPolicy · inverted kill switches", () => {
  it("asks for confirmation when RESUMING sending, not when pausing", () => {
    // The whole point. sms_global_pause TRUE = paused. The dangerous direction
    // is OFF. Before this policy the panel confirmed the pause and let the
    // resume through silently.
    expect(requiresConfirmation("sms_global_pause", false)).toBe(true);
    expect(requiresConfirmation("sms_global_pause", true)).toBe(false);

    expect(requiresConfirmation("vapi_forward_followup_paused", false)).toBe(true);
    expect(requiresConfirmation("vapi_forward_followup_paused", true)).toBe(false);
  });

  it("never tells the operator that engaging a kill switch will send messages", () => {
    const copy = confirmationCopy("sms_global_pause", false);
    expect(copy.message).toMatch(/resumes/i);
    expect(copy.message).not.toMatch(/activates customer-contacting/i);
    // "Keep OFF" was the old cancel label and, on an off-switch, OFF is the
    // sending state — the reassuring button was the dangerous one.
    expect(copy.cancelLabel).toBe("Stay paused");
  });

  it("keeps every inverted flag classified as customer-facing", () => {
    // An inverted flag that is not customer-facing would never confirm at all,
    // because requiresConfirmation() short-circuits on that check first.
    for (const key of INVERTED_FLAGS) {
      expect(isCustomerFacingFlag(key), `${key} must be customer-facing`).toBe(true);
      expect(requiresConfirmation(key, false), `${key} must confirm on resume`).toBe(true);
    }
  });
});

describe("flagPolicy · coverage the key regex missed", () => {
  // Each of these can cause an outbound customer touch and did NOT match the
  // legacy /(sms_|email_|...)/ pattern.
  const previouslyUngated = [
    "nickgpt_low_risk_autosend_enabled",
    "weather_triggered_sms",
    "vip_auto_recognition",
    "referral_loop_closer",
    "predictive_maintenance_alerts",
    "photo_assess_enabled",
    "legacy_autopost_live",
    "missed_call_recovery",
  ];

  it.each(previouslyUngated)("classifies %s as customer-facing", (key) => {
    expect(isCustomerFacingFlag(key)).toBe(true);
    expect(requiresConfirmation(key, true)).toBe(true);
  });

  it("catches the trailing-token shape the regex could not", () => {
    // The legacy pattern required `sms_` WITH a trailing underscore, so a key
    // ENDING in the token slipped through. This is the same truncated-stem trap
    // logged in the voice-claim-guard arc — assert the inflected form directly.
    expect(/(sms_)/i.test("weather_triggered_sms")).toBe(false);
    expect(isCustomerFacingFlag("weather_triggered_sms")).toBe(true);
  });
});

describe("flagPolicy · ordinary flags are unchanged", () => {
  it("still confirms ON for a plainly customer-facing flag", () => {
    expect(requiresConfirmation("sms_review_requests", true)).toBe(true);
    expect(requiresConfirmation("sms_review_requests", false)).toBe(false);
    expect(confirmationCopy("sms_review_requests", true).confirmLabel).toBe("Flip ON");
  });

  it("never confirms a flag that cannot reach a customer", () => {
    expect(isCustomerFacingFlag("skill_trend_topics_enabled")).toBe(false);
    expect(requiresConfirmation("skill_trend_topics_enabled", true)).toBe(false);
    expect(requiresConfirmation("skill_trend_topics_enabled", false)).toBe(false);
  });

  it("is monotonic against the legacy regex — classification may only widen", () => {
    // Guards the fallback: no key the old pattern flagged may become unflagged,
    // which is the one way this refactor could silently REMOVE a confirmation.
    const legacy = /(sms_|email_|gbp_|vapi_|drip_|outreach|review_request|retention|cross_sell|win_?back|emergency_)/i;
    for (const { key } of FLAG_DEFINITIONS) {
      if (legacy.test(key)) {
        expect(isCustomerFacingFlag(key), `${key} lost its customer-facing status`).toBe(true);
      }
    }
  });
});

describe("flagPolicy · every listed flag actually exists", () => {
  it("references no flag key that FLAG_DEFINITIONS does not define", () => {
    // A typo'd key here would silently classify nothing — the policy would look
    // applied and do nothing, which is the failure mode this whole PR is about.
    const defined = new Set(FLAG_DEFINITIONS.map((f) => f.key as string));
    for (const key of INVERTED_FLAGS) {
      expect(defined.has(key), `INVERTED_FLAGS references unknown flag "${key}"`).toBe(true);
    }
  });

  it("keeps isInvertedFlag and INVERTED_FLAGS in agreement", () => {
    for (const key of INVERTED_FLAGS) expect(isInvertedFlag(key)).toBe(true);
    expect(isInvertedFlag("sms_review_requests")).toBe(false);
  });
});

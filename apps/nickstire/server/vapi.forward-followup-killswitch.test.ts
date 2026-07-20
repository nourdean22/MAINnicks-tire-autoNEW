/**
 * 2026-07-20 · Off-switch for the forwarded-call follow-up SMS.
 *
 * This is the only ALWAYS-ARMED outbound path in the voice system. Its cron
 * sibling (missedCallRecovery) is feature-flag gated AND shadow gated; this one
 * fires straight off the webhook with nothing but a first-insert guard, so
 * until now there was no way to stop it without a redeploy.
 *
 * THE POLARITY IS THE WHOLE POINT. isEnabled() fails closed — a missing row or
 * any DB error returns false. On a conventional "enable" flag that means the
 * feature dies, so retrofitting one onto this LIVE path would have switched off
 * a working customer touchpoint in prod until someone hand-inserted a row, and
 * re-killed it on every DB blip. The flag is therefore named for the PAUSE:
 * false (the failure value) means "not paused" → keeps sending → current
 * behaviour preserved. The safe state and the failure state are the same state.
 *
 * These tests exist to stop anyone "tidying" that inversion back into a normal
 * enable-flag, which would look neater and silently break the send path.
 */
import { describe, expect, it } from "vitest";
import { shouldSendForwardedFollowup } from "./routes/webhooks/vapi";
import { FLAG_DEFINITIONS } from "./services/featureFlags";

const base = {
  firstLog: true,
  endedReason: "assistant-forwarded-call",
  customerNumber: "+12165551234",
  paused: false,
};

describe("shouldSendForwardedFollowup", () => {
  it("sends on a first-insert forwarded call with a number", () => {
    expect(shouldSendForwardedFollowup(base)).toBe(true);
  });

  it("does NOT send when the operator has paused it", () => {
    expect(shouldSendForwardedFollowup({ ...base, paused: true })).toBe(false);
  });

  // The failure mode that matters: a flag-read failure resolves to false, and
  // false must keep the live behaviour rather than mute the path.
  it("sends when paused is false — the value a flag-read failure produces", () => {
    expect(shouldSendForwardedFollowup({ ...base, paused: false })).toBe(true);
  });

  it("does NOT send on a webhook retry (firstLog false)", () => {
    expect(shouldSendForwardedFollowup({ ...base, firstLog: false })).toBe(false);
  });

  it("does NOT send for a non-forwarded ended reason", () => {
    expect(shouldSendForwardedFollowup({ ...base, endedReason: "customer-ended-call" })).toBe(false);
  });

  it.each([null, undefined, "", "   "])("does NOT send without a usable number (%j)", (num) => {
    expect(shouldSendForwardedFollowup({ ...base, customerNumber: num })).toBe(false);
  });

  it("pause beats every other condition", () => {
    expect(shouldSendForwardedFollowup({ ...base, paused: true, firstLog: true })).toBe(false);
  });
});

describe("vapi_forward_followup_paused flag contract", () => {
  const flag = FLAG_DEFINITIONS.find((f) => f.key === "vapi_forward_followup_paused");

  it("is registered, so it appears in the admin flags UI and is togglable without a redeploy", () => {
    expect(flag).toBeDefined();
  });

  // If someone renames this to an enable-flag (…_enabled), the fail-closed
  // default silently stops the SMS in prod. The name encodes the polarity.
  it("is named as a PAUSE, not an enable — fail-closed false must mean 'keep sending'", () => {
    expect(flag?.key).toContain("paused");
    expect(flag?.key).not.toContain("enabled");
  });

  it("documents the inverted polarity for whoever reads the flags UI", () => {
    const desc = (flag?.description ?? "").toLowerCase();
    expect(desc).toContain("off-switch");
    expect(desc).toContain("inverted");
  });
});

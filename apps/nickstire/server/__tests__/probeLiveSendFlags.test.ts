/**
 * scripts/probe-live-send-flags.mjs calls a flag ARMED only when the value is
 * exactly what the code compares against. It used a shared TRUTHY set, so
 * ENABLE_CUSTOMER_CONFIRMATIONS=1 read ARMED while sendCustomerMessage needs
 * exactly "true", and FEATURE_*=true read ARMED while the crons need "1".
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no type declarations
import { SIDE_EFFECT_FLAGS, armedState } from "../../scripts/probe-live-send-flags.mjs";
import { SEND_PAUSE_LANES } from "../services/sendPause";

describe("probe-live-send-flags · exact comparison per flag", () => {
  it("ENABLE_CUSTOMER_CONFIRMATIONS is ARMED only at exactly 'true'", () => {
    expect(armedState("ENABLE_CUSTOMER_CONFIRMATIONS", "true")).toBe("ARMED");
    expect(armedState("ENABLE_CUSTOMER_CONFIRMATIONS", "1")).toBe("off");
    expect(armedState("ENABLE_CUSTOMER_CONFIRMATIONS", "yes")).toBe("off");
  });

  it("the '1' flags are ARMED only at exactly '1'", () => {
    for (const f of ["FEATURE_DECLINED_RECOVERY", "FEATURE_VOICE_RECOVERY", "FEATURE_CONFIRMATION_CALLS", "FEATURE_FOLLOWUP_CADENCE", "WEATHER_SMS_SEND", "MISSED_CALL_RECOVERY_SEND"]) {
      expect(armedState(f, "1"), f).toBe("ARMED");
      expect(armedState(f, "true"), f).toBe("off");
    }
  });

  it("the reel flags are ARMED only at exactly 'true', and the FB crosspost is probed", () => {
    for (const f of ["REEL_PUBLISH_ENABLED", "REEL_AUTOPOST_ENABLED", "REEL_COMMENT_RESPONDER_ENABLED", "REEL_FB_CROSSPOST_ENABLED"]) {
      expect(armedState(f, "true"), f).toBe("ARMED");
      expect(armedState(f, "1"), f).toBe("off");
    }
  });

  it("unset is its own state, never off", () => {
    expect(armedState("FEATURE_VOICE_RECOVERY", undefined)).toBe("unset — read the guard");
  });

  it("agrees with sendPause's envArmed table for every send lane flag", () => {
    for (const def of Object.values(SEND_PAUSE_LANES)) {
      for (const [flag, value] of def.envFlags) expect(SIDE_EFFECT_FLAGS[flag]?.armedWhen, flag).toBe(value);
    }
  });
});

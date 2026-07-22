/**
 * Authority-kernel control parsing (privateMode / posture / actionPermission).
 * Pure — locks the safe-default contract: anything absent or malformed
 * degrades to today's behavior (no private, auto posture, draft permission).
 */
import { describe, it, expect } from "vitest";
import { parseChatControls } from "@/lib/ai/chat/gate";

describe("parseChatControls", () => {
  it("defaults: empty body = today's behavior", () => {
    expect(parseChatControls({})).toEqual({
      privateMode: false,
      posture: "auto",
      actionPermission: "draft",
    });
  });

  it("accepts valid values", () => {
    expect(parseChatControls({ privateMode: true, posture: "execute", actionPermission: "read" })).toEqual({
      privateMode: true,
      posture: "execute",
      actionPermission: "read",
    });
    expect(parseChatControls({ posture: "spar" }).posture).toBe("spar");
    expect(parseChatControls({ posture: "counsel" }).posture).toBe("counsel");
    expect(parseChatControls({ actionPermission: "execute" }).actionPermission).toBe("execute");
  });

  it("rejects malformed values to safe defaults (never throws)", () => {
    expect(parseChatControls({ privateMode: "yes" }).privateMode).toBe(false); // truthy string ≠ true
    expect(parseChatControls({ privateMode: 1 }).privateMode).toBe(false);
    expect(parseChatControls({ posture: "aggressive" }).posture).toBe("auto");
    expect(parseChatControls({ posture: 42 }).posture).toBe("auto");
    expect(parseChatControls({ actionPermission: "root" }).actionPermission).toBe("draft");
    expect(parseChatControls({ actionPermission: null }).actionPermission).toBe("draft");
  });
});

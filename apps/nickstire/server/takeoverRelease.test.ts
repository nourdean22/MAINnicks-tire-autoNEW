/**
 * Takeover release (Autopilot Wave 6, 2026-07-29).
 *
 * The blueprint always said "unless the employee releases it" — the release
 * half now exists. Pinned: most-recent-signal-wins between the manual-send
 * hold and the explicit release row, and the documented fail-open direction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let holdAt: string | null = null;
let releaseAt: string | null = null;
let throwOnRead = false;

vi.mock("./db", () => ({
  getDb: async () => {
    if (throwOnRead) throw new Error("down");
    return {
      execute: async () => [[{ lastHold: holdAt, lastRelease: releaseAt }]],
    };
  },
}));

beforeEach(() => {
  vi.resetModules();
  holdAt = null;
  releaseAt = null;
  throwOnRead = false;
});

async function held(): Promise<boolean> {
  const { isConversationHumanHeld } = await import("./services/humanTakeover");
  return isConversationHumanHeld(42);
}

describe("isConversationHumanHeld — release-aware", () => {
  it("manual reply in window, no release → HELD", async () => {
    holdAt = "2026-07-29 12:00:00";
    expect(await held()).toBe(true);
  });

  it("release AFTER the manual reply → NOT held (operator handed the thread back)", async () => {
    holdAt = "2026-07-29 12:00:00";
    releaseAt = "2026-07-29 12:05:00";
    expect(await held()).toBe(false);
  });

  it("manual reply AFTER a release → HELD again (most-recent signal wins)", async () => {
    releaseAt = "2026-07-29 12:00:00";
    holdAt = "2026-07-29 12:10:00";
    expect(await held()).toBe(true);
  });

  it("no signals in window → not held", async () => {
    expect(await held()).toBe(false);
  });

  it("read failure → fail-open not-held (documented policy)", async () => {
    throwOnRead = true;
    expect(await held()).toBe(false);
  });
});

describe("releaseTakeover wiring pin", () => {
  it("smsOps writes the release row FAIL-LOUD (direct insert, never the swallowing audit helper)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(process.cwd(), "server", "routers", "smsOps.ts"), "utf8");
    expect(src).toContain("releaseTakeover");
    expect(src).toContain("customer.sms_takeover_released");
    // the release mechanism must not ride logAdminAction (which swallows
    // failures by design) — pin the direct insert + loud unavailability
    const releaseBlock = src.slice(src.indexOf("releaseTakeover"), src.indexOf("setPause"));
    expect(releaseBlock).toContain("db.insert(auditLog)");
    expect(releaseBlock).toContain("hold NOT released");
    expect(releaseBlock).not.toContain("logAdminAction(");
  });
});

/**
 * 2026-07-20 · "The AI must not invent shop state" contract.
 *
 * WHY THIS FILE EXISTS. Three voice tools each returned a confident figure
 * that no data supported, and the AI repeated them to callers as fact:
 *
 *   - getCurrentWaitTime  counted `bookings` rows from the trailing 24h against
 *                         a hardcoded 6-bay assumption and returned
 *                         open|busy|loaded + estimatedWaitMinutes. Nick's is
 *                         walk-in, so booking volume is not the workload.
 *   - capacityCheck       returned a FLAT `estimatedWaitMinutes: 30` and three
 *                         invented "windows" plus `slotsRemainingToday: 3` on
 *                         every call, for a shop with no appointment slots.
 *   - checkTireStock      wrote a lead row and told the caller the front desk
 *                         would walk the rack and follow up — a promise with
 *                         no completion path anywhere in the codebase.
 *
 * The same fabricated load also drove an unprompted greeting line ("we're
 * super slammed today with about an hour wait in the bays") in vapi-bdi.ts.
 *
 * Operator decision (2026-07-20): a live person answers "how busy are you"
 * and physically checks the rack. The AI never estimates either.
 *
 * These tools are now DB-free, so unlike voiceAgent.test.ts — which is
 * `skipIf(!HAS_DB)` and therefore dark in CI and on any machine without a
 * prod DATABASE_URL — this file ALWAYS runs. That is deliberate: the old
 * checkTireStock test never executed once, which is why the promise shipped.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

const caller = () => appRouter.createCaller(createVoiceContext()).voiceAgent;

/** Any of these in a tool response means the AI was handed a wait figure. */
const WAIT_ESTIMATE_KEYS = ["estimatedWaitMinutes", "waitMinutes", "load", "slotsRemainingToday", "activeBookings"];

/** Spoken claims the AI must never be fed about how busy the shop is. */
const BUSYNESS_CLAIMS = ["slammed", "hour wait", "minute wait", "30-min", "60+ min", "expect a wait"];

describe("voice tools must not fabricate shop state", () => {
  describe("getCurrentWaitTime", () => {
    it("returns NO wait estimate and no busy/loaded judgement", async () => {
      const res = (await caller().getCurrentWaitTime()) as Record<string, unknown>;
      for (const key of WAIT_ESTIMATE_KEYS) {
        expect(res).not.toHaveProperty(key);
      }
    });

    it("instructs the AI to hand off rather than guess", async () => {
      const res = (await caller().getCurrentWaitTime()) as Record<string, unknown>;
      expect(res.handOffToHuman).toBe(true);
      expect(String(res.aiHint).toLowerCase()).toContain("do not estimate");
    });
  });

  describe("capacityCheck", () => {
    it("returns NO wait estimate and no invented slot capacity", async () => {
      const res = (await caller().capacityCheck({})) as Record<string, unknown>;
      for (const key of WAIT_ESTIMATE_KEYS) {
        expect(res).not.toHaveProperty(key);
      }
    });

    it("never puts a busyness claim in the caller-facing message", async () => {
      const res = (await caller().capacityCheck({})) as Record<string, unknown>;
      const spoken = String(res.message ?? "").toLowerCase();
      for (const claim of BUSYNESS_CLAIMS) {
        expect(spoken).not.toContain(claim);
      }
    });

    it("still confirms walk-in + hours, so the tool remains useful", async () => {
      const res = (await caller().capacityCheck({})) as Record<string, unknown>;
      expect(res.walkIn).toBe(true);
      expect(String(res.message).toLowerCase()).toContain("first come");
    });

    // A malformed day string used to flow into toLocaleDateString and render
    // "Invalid Date" straight into the AI's mouth.
    it("survives a garbage day string without emitting Invalid Date", async () => {
      const res = (await caller().capacityCheck({ day: "not-a-date" })) as Record<string, unknown>;
      expect(String(res.message)).not.toContain("Invalid Date");
    });
  });

  describe("checkTireStock", () => {
    it("hands off to a human instead of capturing a lead", async () => {
      const res = (await caller().checkTireStock({ tireSize: "215/55R16" })) as Record<string, unknown>;
      expect(res.handOffToHuman).toBe(true);
    });

    // The exact defect: the old return put caller-facing copy in `message`
    // saying the front desk would "follow up as soon as they can" — a promise
    // with nothing tracking it. Guidance now lives in `aiHint` (an instruction
    // to the model) and there must be NO speakable field at all, so a hint
    // like "do NOT promise a callback" can never be read aloud as a promise.
    it("exposes no caller-facing message the AI could speak verbatim", async () => {
      const res = (await caller().checkTireStock({ tireSize: "215/55R16" })) as Record<string, unknown>;
      expect(res).not.toHaveProperty("message");
    });

    it("instructs the model not to promise a callback or claim stock", async () => {
      const res = (await caller().checkTireStock({ tireSize: "215/55R16" })) as Record<string, unknown>;
      const hint = String(res.aiHint).toLowerCase();
      expect(hint).toContain("do not promise");
      expect(hint).toContain("cannot see the rack");
    });

    // Requiring name+phone just to hand off lengthened every rack-check call.
    it("works with no arguments at all", async () => {
      const res = (await caller().checkTireStock({})) as Record<string, unknown>;
      expect(res.handOffToHuman).toBe(true);
    });
  });
});

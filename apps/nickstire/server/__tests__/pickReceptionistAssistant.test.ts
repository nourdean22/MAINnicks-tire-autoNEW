/**
 * Which VAPI assistant does an operator edit land on?
 *
 * This resolver had NO tests, and it decides where "Push Latest Config", the
 * transfer-destination card, and the transfer editor all write. Getting it
 * wrong is the wave-113b defect: edits went to the outbound assistant while the
 * inbound receptionist kept stale numbers, and nothing said which was chosen.
 *
 * WHY NOW. The live panel on 2026-09-18 listed TWO assistants both named
 * "Nick's Tire & Auto Receptionist" plus a separately-named follow-up. With two
 * name matches the old code returned whichever VAPI listed first — an order it
 * does not control and VAPI does not promise — and said nothing. The env pin
 * was set, so the real push was correct (production logged
 * `Updated Vapi assistant id=150fe622…`, POST 200); the danger is every path
 * where the pin is absent or stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickReceptionistAssistantId } from "../services/vapi";

const RECEPTIONIST_A = { id: "afcad79e-ec3", name: "Nick's Tire & Auto Receptionist" };
const RECEPTIONIST_B = { id: "150fe622-0b9", name: "Nick's Tire & Auto Receptionist" };
const FOLLOW_UP = { id: "0daaf7dc-139", name: "Nick's Tire Follow-Up Caller" };

const ORIGINAL_PIN = process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;

beforeEach(() => {
  delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
});

afterEach(() => {
  // `if (orig) env.X = orig` leaks when orig was undefined, and assigning
  // undefined stores the literal string "undefined" — so delete, then restore.
  delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
  if (ORIGINAL_PIN !== undefined) process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = ORIGINAL_PIN;
  vi.restoreAllMocks();
});

describe("the env pin wins, and it is the only deterministic answer", () => {
  it("picks the pinned id even when another assistant also matches by name", () => {
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = RECEPTIONIST_B.id;
    const picked = pickReceptionistAssistantId([RECEPTIONIST_A, RECEPTIONIST_B, FOLLOW_UP]);
    expect(picked).toEqual({ id: RECEPTIONIST_B.id, reason: "env" });
  });

  it("picks the pinned id regardless of list order", () => {
    // This is the whole point of pinning: VAPI's ordering must not matter.
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = RECEPTIONIST_B.id;
    const reversed = pickReceptionistAssistantId([FOLLOW_UP, RECEPTIONIST_B, RECEPTIONIST_A]);
    expect(reversed?.id).toBe(RECEPTIONIST_B.id);
  });

  it("falls through when the pin names an assistant that no longer exists", () => {
    // A deleted or renumbered assistant must not strand the resolver.
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = "deleted-assistant-id";
    const picked = pickReceptionistAssistantId([RECEPTIONIST_B, FOLLOW_UP]);
    expect(picked).toEqual({ id: RECEPTIONIST_B.id, reason: "name-match" });
  });
});

describe("a duplicate name is announced, never resolved silently", () => {
  it("reports name-match-ambiguous when two assistants match", () => {
    const picked = pickReceptionistAssistantId([RECEPTIONIST_A, RECEPTIONIST_B, FOLLOW_UP]);
    expect(picked?.reason).toBe("name-match-ambiguous");
  });

  it("a SINGLE match is not ambiguous and keeps the plain reason", () => {
    // Without this, marking everything ambiguous would satisfy the test above
    // and make the warning meaningless.
    const picked = pickReceptionistAssistantId([RECEPTIONIST_B, FOLLOW_UP]);
    expect(picked).toEqual({ id: RECEPTIONIST_B.id, reason: "name-match" });
  });

  it("the ambiguous pick still returns a usable id rather than null", () => {
    // Degrading to null would break the admin card entirely. Guessing loudly
    // beats failing closed here, because the caller can still act.
    const picked = pickReceptionistAssistantId([RECEPTIONIST_A, RECEPTIONIST_B]);
    expect(picked?.id).toBe(RECEPTIONIST_A.id);
  });
});

describe("the remaining ladder still works", () => {
  it("excludes an obvious follow-up when nothing matches by name", () => {
    const picked = pickReceptionistAssistantId([
      FOLLOW_UP,
      { id: "inbound-1", name: "Main Line" },
    ]);
    expect(picked).toEqual({ id: "inbound-1", reason: "name-exclude" });
  });

  it("falls back to the first only when every candidate looks outbound", () => {
    const picked = pickReceptionistAssistantId([
      { id: "out-1", name: "Outbound Caller" },
      { id: "out-2", name: "Follow Up Bot" },
    ]);
    expect(picked).toEqual({ id: "out-1", reason: "fallback-first" });
  });

  it("returns null for an empty list — never a fabricated id", () => {
    expect(pickReceptionistAssistantId([])).toBeNull();
  });

  it("tolerates assistants with no name at all", () => {
    const picked = pickReceptionistAssistantId([{ id: "nameless" }]);
    expect(picked?.id).toBe("nameless");
  });
});

describe("POSITIVE CONTROL: the resolver actually discriminates", () => {
  it("every rung of the ladder is reachable, not one constant", () => {
    // A function hardcoded to any single reason would satisfy a subset of the
    // cases above. This asserts all five outcomes are live.
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = RECEPTIONIST_B.id;
    const env = pickReceptionistAssistantId([RECEPTIONIST_B, FOLLOW_UP])?.reason;
    delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;

    const reasons = new Set([
      env,
      pickReceptionistAssistantId([RECEPTIONIST_B, FOLLOW_UP])?.reason,
      pickReceptionistAssistantId([RECEPTIONIST_A, RECEPTIONIST_B])?.reason,
      pickReceptionistAssistantId([FOLLOW_UP, { id: "x", name: "Main Line" }])?.reason,
      pickReceptionistAssistantId([{ id: "y", name: "Outbound Caller" }])?.reason,
    ]);
    expect([...reasons].sort()).toEqual([
      "env",
      "fallback-first",
      "name-exclude",
      "name-match",
      "name-match-ambiguous",
    ]);
  });
});

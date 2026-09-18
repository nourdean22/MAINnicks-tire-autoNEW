/**
 * A retired assistant must be unreachable, whatever still points at it.
 *
 * WHY. The VAPI account carries a THIRD assistant, `afcad79e`, with the same
 * display name as the live inbound receptionist. Verified against production
 * 2026-09-18: the inbound line answers with `150fe622`, and the dedicated
 * outbound caller is the separately-named `0daaf7dc`. `afcad79e` is an
 * orphaned older copy, and the duplicate NAME is what made it dangerous —
 * every name-match fallback could select it, and the operator's own notes
 * record this confusion biting twice before.
 *
 * The unhook is code-side and reversible: the assistant still exists in VAPI.
 * These tests pin that nothing can dispatch to it — including the three call
 * sites that read `VAPI_FOLLOWUP_ASSISTANT_ID` directly and hand it to VAPI
 * without checking it still resolves.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RETIRED_ASSISTANT_IDS,
  followUpAssistantIdOrNull,
  isRetiredAssistant,
  pickFollowUpAssistantId,
  pickReceptionistAssistantId,
} from "../services/vapi";

const RETIRED = "afcad79e-ec33-4156-98fe-7eb325c1222a";
const INBOUND = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const OUTBOUND = "0daaf7dc-1394-4731-908f-5c91788c2d3d";

/** The account exactly as production lists it. */
const LIVE_ACCOUNT = [
  { id: OUTBOUND, name: "Nick's Tire Follow-Up Caller" },
  { id: RETIRED, name: "Nick's Tire & Auto Receptionist" },
  { id: INBOUND, name: "Nick's Tire & Auto Receptionist" },
];

const ORIG_RECEPTIONIST = process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
const ORIG_FOLLOWUP = process.env.VAPI_FOLLOWUP_ASSISTANT_ID;

beforeEach(() => {
  delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
  delete process.env.VAPI_FOLLOWUP_ASSISTANT_ID;
});

afterEach(() => {
  // Delete then restore — `if (orig) env.X = orig` leaks when orig was
  // undefined, and assigning undefined stores the string "undefined".
  delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
  delete process.env.VAPI_FOLLOWUP_ASSISTANT_ID;
  if (ORIG_RECEPTIONIST !== undefined) process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = ORIG_RECEPTIONIST;
  if (ORIG_FOLLOWUP !== undefined) process.env.VAPI_FOLLOWUP_ASSISTANT_ID = ORIG_FOLLOWUP;
});

describe("the retired id is named, and only that one", () => {
  it("the duplicate receptionist is retired", () => {
    expect(RETIRED_ASSISTANT_IDS).toContain(RETIRED);
    expect(isRetiredAssistant(RETIRED)).toBe(true);
  });

  it("POSITIVE CONTROL: the two LIVE assistants are NOT retired", () => {
    // Without this, a predicate returning true for everything would satisfy
    // every assertion below and silently disable the whole voice system.
    expect(isRetiredAssistant(INBOUND)).toBe(false);
    expect(isRetiredAssistant(OUTBOUND)).toBe(false);
  });

  it("null, undefined and blank are not retired", () => {
    expect(isRetiredAssistant(null)).toBe(false);
    expect(isRetiredAssistant(undefined)).toBe(false);
    expect(isRetiredAssistant("")).toBe(false);
  });

  it("matches on the trimmed id — a padded env value is still retired", () => {
    // `NICK_AGENT_FOLLOWUPS=" 1 "` is prior art for a padded env value in this
    // repo; a padded pin must not slip past the guard.
    expect(isRetiredAssistant(`  ${RETIRED}  `)).toBe(true);
  });
});

describe("no rung of the receptionist picker can reach it", () => {
  it("name-match cannot select the retired duplicate", () => {
    // Both are literally named "Nick's Tire & Auto Receptionist". Before the
    // guard this resolved by VAPI list order, and the retired one is listed
    // FIRST in the live account — so this is the real failing case.
    const picked = pickReceptionistAssistantId(LIVE_ACCOUNT);
    expect(picked?.id).toBe(INBOUND);
    expect(picked?.id).not.toBe(RETIRED);
  });

  it("the duplicate no longer makes the name-match AMBIGUOUS", () => {
    // Retiring it leaves exactly one receptionist, so the pick is clean again.
    expect(pickReceptionistAssistantId(LIVE_ACCOUNT)?.reason).toBe("name-match");
  });

  it("an env pin naming the retired id is IGNORED, not obeyed", () => {
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = RETIRED;
    const picked = pickReceptionistAssistantId(LIVE_ACCOUNT);
    expect(picked?.id).toBe(INBOUND);
    expect(picked?.reason).not.toBe("env");
  });

  it("fallback-first cannot reach it either", () => {
    // Every remaining candidate looks outbound, so the last rung fires — and
    // must still skip the retired entry rather than grabbing index 0.
    const picked = pickReceptionistAssistantId([
      { id: RETIRED, name: "Outbound Caller" },
      { id: "live-1", name: "Outbound Caller" },
    ]);
    expect(picked?.id).toBe("live-1");
  });

  it("an account containing ONLY the retired assistant resolves to null", () => {
    // Null is correct: there is genuinely no assistant to use. Returning the
    // retired one "because it is all we have" is how an unhook gets undone.
    expect(pickReceptionistAssistantId([{ id: RETIRED, name: "Receptionist" }])).toBeNull();
  });
});

describe("the outbound chokepoint", () => {
  it("a healthy pin passes through untouched", () => {
    process.env.VAPI_FOLLOWUP_ASSISTANT_ID = OUTBOUND;
    expect(followUpAssistantIdOrNull()).toBe(OUTBOUND);
  });

  it("a RETIRED pin yields null, so callers skip instead of misdialling", () => {
    // This is the load-bearing one. Three call sites hand this value straight
    // to VAPI to place real outbound calls.
    process.env.VAPI_FOLLOWUP_ASSISTANT_ID = RETIRED;
    expect(followUpAssistantIdOrNull()).toBeNull();
  });

  it("an unset pin yields null", () => {
    expect(followUpAssistantIdOrNull()).toBeNull();
  });

  it("the follow-up picker falls through a retired pin to the real caller", () => {
    process.env.VAPI_FOLLOWUP_ASSISTANT_ID = RETIRED;
    const picked = pickFollowUpAssistantId(LIVE_ACCOUNT);
    expect(picked?.id).toBe(OUTBOUND);
    expect(picked?.reason).toBe("name-match");
  });

  it("the follow-up picker never name-matches the retired id", () => {
    // Guards the rename hazard: if the retired assistant were renamed in VAPI
    // to something containing "follow-up", the name rung would otherwise grab
    // it. The guard is by ID, so a rename cannot reintroduce it.
    const picked = pickFollowUpAssistantId([
      { id: RETIRED, name: "Old Follow-Up Caller" },
      { id: OUTBOUND, name: "Nick's Tire Follow-Up Caller" },
    ]);
    expect(picked?.id).toBe(OUTBOUND);
  });
});

describe("the live system still works — the unhook is surgical", () => {
  it("POSITIVE CONTROL: the real account still resolves BOTH assistants", () => {
    // The whole risk of a denylist is over-blocking. This asserts the two
    // assistants that must keep working still do, from the exact live fixture.
    process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = INBOUND;
    process.env.VAPI_FOLLOWUP_ASSISTANT_ID = OUTBOUND;
    expect(pickReceptionistAssistantId(LIVE_ACCOUNT)).toEqual({ id: INBOUND, reason: "env" });
    expect(pickFollowUpAssistantId(LIVE_ACCOUNT)).toEqual({ id: OUTBOUND, reason: "env" });
  });
});

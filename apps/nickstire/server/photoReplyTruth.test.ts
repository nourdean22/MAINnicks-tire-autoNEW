/**
 * The photo path builds its replies from hardcoded strings instead of going
 * through buildReplyPlan, so it sat outside every prohibition the SMS planner
 * enforces. That is how it came to tell customers, from one photo, that a tire
 * "needs replacement", that "we have your size in stock most days", that "we can
 * patch that", and that the job takes "usually 20 min" — claims a photo cannot
 * establish and, in the inventory case, one the planner explicitly forbids
 * everywhere else.
 *
 * These tests pin the whole template table, so a NEW reply added later is
 * checked automatically rather than relying on a reviewer to remember.
 */
import { describe, it, expect } from "vitest";
import { photoReplyViolations, DEFAULT_REPLIES_FOR_TEST } from "./services/photo-assess-pipeline";

describe("photoReplyViolations — the detector itself", () => {
  it.each([
    ["remote replacement verdict", "Got the photo · looks like the tire needs replacement.", "remote_replacement_verdict"],
    ["remote repairability", "Got the photo · we can patch that if it's in the tread.", "remote_repairability_verdict"],
    ["inventory claim", "We have your size in stock most days.", "inventory_claim"],
    ["completion promise", "Bring it by — usually 20 min.", "completion_time_promise"],
    ["free without free-check", "Free 15-min inspection.", "free_without_free_check"],
  ])("catches a %s", (_label, reply, expected) => {
    expect(photoReplyViolations(reply)).toContain(expected);
  });

  it("catches every retired claim in the original tire-repair copy at once", () => {
    const retired = "Got the photo · we can patch that if it's in the tread. Bring it by — usually 20 min. No charge if it's not patchable. (216) 862-0005.";
    const v = photoReplyViolations(retired);
    expect(v).toContain("remote_repairability_verdict");
    expect(v).toContain("completion_time_promise");
  });

  it("does not fire on honest observe-then-check copy", () => {
    const honest =
      "Got the photo · there's real wear showing, but how much tread is left needs measuring in person. Bring it by for a free check and we'll tell you where it stands before anything is charged.";
    expect(photoReplyViolations(honest)).toEqual([]);
  });
});

describe("every shipped photo reply is claim-clean", () => {
  const entries = Object.entries(DEFAULT_REPLIES_FOR_TEST);

  it("has templates to check", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s makes no unsupported claim", (_key, reply) => {
    expect(photoReplyViolations(reply as string)).toEqual([]);
  });

  it.each(entries)("%s separates what is visible from the next step", (_key, reply) => {
    // Every reply must leave the customer with a concrete way forward — the
    // point of the rewrite was not just removing claims but keeping the
    // conversation moving.
    expect(reply as string).toMatch(/bring it by|send one wider|free check/i);
  });

  it.each(entries)("%s uses 'check', never 'inspection'", (_key, reply) => {
    // Customers say check; the brand-voice lint and the send preflight both
    // key on that literal.
    expect(reply as string).not.toMatch(/\binspection\b/i);
  });
});

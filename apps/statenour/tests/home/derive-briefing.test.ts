/**
 * The home card's selector — every arm, plus the two #1897-review fixes.
 *
 * WHY THIS FILE EXISTS. The chain lived inline in a component behind five tRPC
 * hooks, so no test had ever run it — and running it against LIVE data during
 * the #1897 review rendered "ACTIVE ENGAGEMENT: [Drink water — 6+ bottles] …
 * Do not context switch until completion." as the page's dominant element. The
 * chain is now pure (derive-briefing.ts); these arms pin the two fixes and the
 * pre-existing honesty rules so neither can silently regress.
 *
 * THE WATER TEST is written with the literal live row that motivated it: a
 * DAILY loop titled "Drink water — 6+ bottles" in the DOING slot. If someone
 * removes the habit guard, the first assertion that fails names hydration.
 */
import { describe, it, expect } from "vitest";

import { deriveBriefing, type BriefingInputs } from "@/lib/home/derive-briefing";

/** A board with nothing on it — arms override what they test. */
const base: BriefingInputs = {
  loading: false,
  unreadable: false,
  doingTask: null,
  resumeTask: null,
  pendingDecisions: 0,
  findingsCount: 0,
  inboxCount: 0,
  criticalFew: [],
};

const WATER = { title: "Drink water — 6+ bottles", loopKind: "DAILY" };

describe("the habit guard — fix 1", () => {
  it("a DAILY habit in DOING does NOT claim ACTIVE ENGAGEMENT", () => {
    const b = deriveBriefing({ ...base, doingTask: WATER });
    expect(b.title).not.toBe("ACTIVE ENGAGEMENT");
    expect(b.message, "the do-not-context-switch imperative must never wrap a habit").not.toContain(
      "Do not context switch",
    );
  });

  it("the habit falls THROUGH — a waiting decision wins the card over it", () => {
    const b = deriveBriefing({ ...base, doingTask: WATER, pendingDecisions: 3 });
    expect(b.status).toBe("decide");
  });

  it("a WEEKLY habit cannot demand RESUME either", () => {
    const b = deriveBriefing({
      ...base,
      resumeTask: { title: "Work out 3x this week (incl. 1 run)", loopKind: "WEEKLY" },
    });
    expect(b.status, "a weekly loop is not an open loop worth the page").not.toBe("resume");
  });

  it("a real task in DOING still gets the imperative card — the guard is not a blanket", () => {
    const b = deriveBriefing({ ...base, doingTask: { title: "install new pool pump", loopKind: "ONCE" } });
    expect(b.title).toBe("ACTIVE ENGAGEMENT");
    expect(b.message).toContain("install new pool pump");
  });

  it("a real interrupted task still gets RESUME", () => {
    const b = deriveBriefing({ ...base, resumeTask: { title: "drop off signs", loopKind: "ONCE" } });
    expect(b.status).toBe("resume");
    expect(b.message).toContain("drop off signs");
  });

  it("loopKind null/undefined is NOT treated as a habit — unknown kind keeps the old behavior", () => {
    expect(deriveBriefing({ ...base, doingTask: { title: "untyped task" } }).title).toBe("ACTIVE ENGAGEMENT");
    expect(deriveBriefing({ ...base, doingTask: { title: "untyped task", loopKind: null } }).title).toBe(
      "ACTIVE ENGAGEMENT",
    );
  });
});

describe("the decide arm — fix 3, the candidate the design promised and the code lacked", () => {
  it("fires when approvals wait and nothing is executing", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: 2 });
    expect(b.status).toBe("decide");
    expect(b.actionType).toBe("decide");
    expect(b.message).toContain("2 approvals are");
  });

  it("singular copy for one approval", () => {
    expect(deriveBriefing({ ...base, pendingDecisions: 1 }).message).toContain("1 approval is");
  });

  it("sits BELOW active/resume and ABOVE the warnings — the design's stated order", () => {
    // active task > decision
    expect(
      deriveBriefing({
        ...base,
        doingTask: { title: "real work", loopKind: "ONCE" },
        pendingDecisions: 5,
      }).status,
    ).toBe("executing");
    // decision > hygiene warning
    expect(deriveBriefing({ ...base, pendingDecisions: 1, findingsCount: 9 }).status).toBe("decide");
    // decision > best next move
    expect(
      deriveBriefing({ ...base, pendingDecisions: 1, criticalFew: [{ title: "t", roiScore: 70 }] }).status,
    ).toBe("decide");
  });
});

describe("unknown is not zero — decision edition", () => {
  it("null decisions never fire the decide arm", () => {
    expect(deriveBriefing({ ...base, pendingDecisions: null }).status).not.toBe("decide");
  });

  it("the idle arm refuses to claim a clear board over an unmeasured decision queue", () => {
    const b = deriveBriefing({ ...base, pendingDecisions: null });
    expect(b.status).toBe("idle");
    expect(b.message).toContain("FAILED");
    expect(b.message).toContain("unknown, not empty");
    // The measured-zero idle copy must NOT appear — that sentence is the claim
    // this arm exists to withhold.
    expect(b.message).not.toContain("Nothing is waiting and no immediate targets");
  });

  it("measured-zero idle keeps the plain honest copy", () => {
    const b = deriveBriefing({ ...base });
    expect(b.status).toBe("idle");
    expect(b.message).toContain("Nothing is waiting");
    expect(b.message).not.toContain("FAILED");
  });
});

describe("the pre-existing arms survive the extraction unchanged", () => {
  it("loading first", () => {
    expect(deriveBriefing({ ...base, loading: true, pendingDecisions: 9 }).status).toBe("loading");
  });

  it("BOARD UNREADABLE outranks everything measured", () => {
    const b = deriveBriefing({
      ...base,
      unreadable: true,
      doingTask: { title: "x", loopKind: "ONCE" },
      pendingDecisions: 9,
    });
    expect(b.title).toBe("BOARD UNREADABLE");
    expect(b.message).toContain("instrument fault");
  });

  it("hygiene at >=3, inbox at >=7, and the thresholds still hold underneath", () => {
    expect(deriveBriefing({ ...base, findingsCount: 3 }).actionType).toBe("hygiene");
    expect(deriveBriefing({ ...base, findingsCount: 2 }).actionType).not.toBe("hygiene");
    expect(deriveBriefing({ ...base, inboxCount: 7 }).actionType).toBe("triage");
    expect(deriveBriefing({ ...base, inboxCount: 6 }).actionType).not.toBe("triage");
  });

  it("SYSTEMS NOMINAL names criticalFew[0] and keeps the unverified-hypothesis disclaimer", () => {
    const b = deriveBriefing({ ...base, criticalFew: [{ title: "collect customer reviews", roiScore: 50 }] });
    expect(b.status).toBe("nominal");
    expect(b.message).toContain("collect customer reviews");
    expect(b.message).toContain("unverified hypothesis");
  });
});

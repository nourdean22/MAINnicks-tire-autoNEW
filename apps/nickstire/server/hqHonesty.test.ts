/**
 * HQ is the front door. Four things on it stated more than they knew.
 *
 *   Top Archetype (30d)      defaulted to the literal string "proof" — a
 *                            hardcoded guess, returned as a 30-day performance
 *                            finding, on an account that has published 8 things
 *                            in its life (so the default is almost certainly all
 *                            it has ever shown)
 *   Optimal Posting Window   rendered NOTHING when it could not be computed — a
 *                            blank line under a confident label — while the
 *                            server was already returning a basis string that
 *                            explained why, which the UI threw away
 *   Topics to Avoid          a red DESTRUCTIVE alert that fired on every single
 *                            load with an empty list inside it. topicsToAvoid is
 *                            hardcoded to [] server-side. An alarm that is always
 *                            on is one the operator learns to look past
 *   Recent Winners           getTopPosts applies no date filter, so these were
 *                            ALL-TIME posts under the word "recent" — and a
 *                            captionless post rendered as the literal "..."
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Source with comments removed.
 *
 * NEGATIVE assertions must run on CODE, not prose. A good docblock explains the
 * defect it replaced by QUOTING it, so a whole-file `not.toMatch` on the old
 * expression fails against the very comment that documents the fix. This bit me
 * twice in one session before I stopped patching instances and fixed the helper.
 */
const codeOnly = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const server = read("server/routers/instagramAdmin.ts");
const hq = read("client/src/pages/admin/instagram/HQ.tsx");

describe("the archetype is a finding or it is nothing", () => {
  it("no longer defaults to the literal string 'proof'", () => {
    expect(codeOnly("server/routers/instagramAdmin.ts")).not.toMatch(/let topArchetype = "proof"/);
    expect(server).toMatch(/let topArchetype: string \| null = null/);
  });

  it("carries a basis, like the posting window beside it already did", () => {
    expect(server).toMatch(/topArchetypeBasis/);
    // A failed read must change the basis, not leave a stale finding standing.
    expect(server).toMatch(/could not be computed \(analytics unavailable\)/);
  });

  it("HQ renders the absence instead of a confident blank", () => {
    expect(hq).toMatch(/topArchetypeLast30Days \?\? "Not enough data"/);
    expect(hq).toMatch(/optimalPostingWindow \?\? "Not enough data"/);
  });

  it("HQ shows the basis it was already being sent", () => {
    expect(hq).toMatch(/brief\.postingWindowBasis/);
    expect(hq).toMatch(/brief\.topArchetypeBasis/);
  });
});

describe("an always-on alarm is not an alarm", () => {
  it("the destructive Topics-to-Avoid alert only renders when there ARE topics", () => {
    expect(hq).toMatch(/brief\.topicsToAvoid\.length > 0 \?/);
  });

  it("and says why it is empty rather than showing an empty red box", () => {
    expect(hq).toMatch(/topicsToAvoidBasis/);
  });
});

describe("top posts are labelled from the query that produced them", () => {
  it("says all-time, because getTopPosts has no date filter", () => {
    expect(server).toMatch(/recentWinnersBasis/);
    expect(server).toMatch(/all-time top posts by engagement rate/);
  });

  it("appends an ellipsis only when something was actually cut", () => {
    // `caption?.substring(0, 50) + "..."` rendered a captionless post as the
    // literal string "..." and a 40-character caption as one that looked cut.
    expect(codeOnly("server/routers/instagramAdmin.ts")).not.toMatch(/caption\?\.substring\(0, 50\)/);
    expect(server).toMatch(/caption\.length > 50 \? "\.\.\." : ""/);
    expect(server).toMatch(/No caption recorded/);
  });
});

describe("the run trail finally has a reader", () => {
  const ac = read("client/src/pages/admin/instagram/ActionCenter.tsx");
  const content = read("server/routers/content.ts");

  it("recentContentRuns has a client caller at last", () => {
    expect(ac).toMatch(/recentContentRuns\.useQuery/);
  });

  it("shows BUILT and PROVEN separately — the whole point of the two-state model", () => {
    expect(ac).toMatch(/built: \{r\.implementationState\}/);
    expect(ac).toMatch(/isProvenPublished/);
  });

  it("distinguishes an unreadable trail from an empty one", () => {
    expect(ac).toMatch(/unknown, not empty/);
    // ...and the server stopped manufacturing the empty case.
    expect(content).toMatch(/the run trail is unknown, not empty/);
  });
});

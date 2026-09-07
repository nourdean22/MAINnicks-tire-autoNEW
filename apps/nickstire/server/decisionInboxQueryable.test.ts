/**
 * "Unknown is not empty", across BOTH queue reads.
 *
 * HISTORY. #1340 added `queryable: boolean` to topDecisions() precisely so an
 * unconsultable queue would stop reading as a clear one, and wired it to the
 * cron, the LLM query route and the admin Decision Inbox panel.
 *
 * WHAT THIS FILE NOW COVERS. On 2026-09-07 the Decision Inbox was retired from
 * the admin home and the queue moved to a staff Opportunities tab, which is the
 * first UI consumer of `opportunityQueue.list`. Auditing that mount found the
 * fix had only ever been applied to ONE of the two reads: `listOpportunities`
 * returned a bare `[]` on BOTH failure exits (no database handle, and
 * `revenue_opportunities` missing), so "we could not read the queue" would have
 * rendered as "you have no opportunities" — the same defect #1340 closed, sitting
 * one function to the left the whole time.
 *
 * That is the recurring shape worth naming: a fix applied to an INSTANCE rather
 * than to the SUBJECT. So this file now asserts the property for every read that
 * reaches a human, not just the one that had the bug.
 *
 * Source-text assertions in the deadEndClosure style, because the defect is a
 * missing BRANCH — there is no value to assert, only the absence of a guard.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const service = read("server/services/opportunityQueue.ts");
const router = read("server/routers/opportunityQueue.ts");
const opportunitiesTab = read("client/src/pages/admin/OpportunitiesSection.tsx");

describe("both queue reads distinguish unreadable from empty", () => {
  it("topDecisions still reports queryable on every failure path", () => {
    expect(service).toMatch(/queryable:\s*false/);
    expect(service).toMatch(/queryable:\s*true/);
    const falses = service.match(/queryable:\s*false/g) ?? [];
    // topDecisions has 2 (no-db, missing-table); listOpportunities adds 2 more.
    expect(falses.length).toBeGreaterThanOrEqual(4);
  });

  it("listOpportunities returns a shape that CANNOT be mistaken for a list", () => {
    // The regression guard. A future edit reverting this to `return []` makes
    // `.items` a type error at four call sites rather than a silent zero — but
    // only if the object shape survives, which is what this asserts.
    expect(service).toMatch(/listOpportunities\([\s\S]{0,200}?Promise<\{\s*items:\s*OpportunityRow\[\];\s*queryable:\s*boolean\s*\}>/);
    expect(service).toMatch(/return\s*\{\s*items:\s*\[\],\s*queryable:\s*false\s*\}/);
  });

  it("the send path refuses to act on an unreadable queue", () => {
    // sendOpportunityDraft TEXTS A CUSTOMER. An unreadable queue must not be
    // reported as "opportunity not found", which reads as "the row is gone".
    const draft = read("server/services/opportunityDraft.ts");
    expect(draft).toMatch(/if\s*\(!queryable\)/);
    expect(draft).toMatch(/refusing to send against an unknown queue/);
  });

  it("the list procedure forwards the flag verbatim, so it is on the wire", () => {
    expect(router).toMatch(/list:\s*adminProcedure[\s\S]{0,400}listOpportunities\(/);
  });
});

describe("the Opportunities tab renders unknown as unknown", () => {
  it("branches on queryable === false", () => {
    expect(opportunitiesTab).toMatch(/queryable === false/);
  });

  it("says UNKNOWN, not clear", () => {
    expect(opportunitiesTab).toMatch(/UNKNOWN, not clear/);
  });

  /**
   * The regression that matters, inherited from the retired panel's test: the
   * empty state must not render when the queue was unreadable, or the banner
   * and the "genuinely clear" sentence print together — worse than either alone.
   */
  it("only claims 'clear' when the queue was actually read", () => {
    const emptyBranch = opportunitiesTab.match(/queryable === true && items\.length === 0/);
    expect(emptyBranch, "the empty-state branch changed shape").not.toBeNull();
  });
});

describe("the retired panel stays retired", () => {
  it("DecisionInboxPanel is gone and not mounted on the admin home", () => {
    const overview = read("client/src/pages/admin/OverviewSection.tsx");
    expect(overview).not.toMatch(/DecisionInboxPanel/);
    expect(() => read("client/src/pages/admin/DecisionInboxPanel.tsx")).toThrow();
  });
});
